import type {
  LanguageModelV3Middleware,
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

// ── Span client (inlined — no external dependency) ───────────────────────────

interface CreateSpanPayload {
  name: string;
  type?: string;
  input?: unknown;
  output?: unknown;
  start_time?: string;
  end_time?: string;
  parent_id?: string;
  trace_id?: string;
  meta?: Record<string, unknown>;
}

interface UpdateSpanPayload {
  end_time?: string;
  output?: unknown;
  meta?: Record<string, unknown>;
}

interface SpanResponse {
  id: string;
  trace_id: string;
}

const DEFAULT_BASE_URL = "https://api.opper.ai";

class OpperSpanClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: { apiKey: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async createSpan(payload: CreateSpanPayload): Promise<SpanResponse | null> {
    try {
      const response = await fetch(`${this.baseUrl}/v2/spans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) return null;
      return (await response.json()) as SpanResponse;
    } catch {
      return null;
    }
  }

  async updateSpan(spanId: string, payload: UpdateSpanPayload): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/v2/spans/${spanId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // fire-and-forget — tracing errors should never surface to callers
    }
  }
}


export interface TracingMiddlewareOptions {
  apiKey: string;
  baseUrl?: string;
  parentSpanId?: string;
}

interface PendingToolCall {
  toolCallId: string;
  toolName: string;
  input: string;
}

export function createTracingMiddleware(
  options: TracingMiddlewareOptions
): LanguageModelV3Middleware {
  const client = new OpperSpanClient({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  // Closure state for tracking tool calls across generate steps
  let pendingToolCalls: PendingToolCall[] = [];
  let lastGenerateEndTime: string | null = null;
  let currentTraceId: string | null = null;
  let currentParentSpanId: string | null = options.parentSpanId ?? null;

  async function createToolSpansFromPending(
    params: LanguageModelV3CallOptions
  ): Promise<void> {
    if (pendingToolCalls.length === 0 || !lastGenerateEndTime) return;

    const now = new Date().toISOString();

    // Extract tool results from the current prompt's tool messages
    const toolResultMap = new Map<string, string>();
    for (const msg of params.prompt) {
      if (msg.role === "tool") {
        for (const part of msg.content) {
          if (part.type === "tool-result") {
            const output =
              typeof part.output === "string"
                ? part.output
                : JSON.stringify(part.output);
            toolResultMap.set(part.toolCallId, truncate(output, 500));
          }
        }
      }
    }

    for (const tc of pendingToolCalls) {
      const toolOutput = toolResultMap.get(tc.toolCallId);
      console.log(`[opper-tracing] Creating tool span: ${tc.toolName}`);
      // Fire-and-forget tool execution spans
      client.createSpan({
        name: `tool:${tc.toolName}`,
        type: "tool",
        start_time: lastGenerateEndTime,
        end_time: now,
        input: truncate(tc.input, 500),
        output: toolOutput,
        parent_id: currentParentSpanId ?? undefined,
        trace_id: currentTraceId ?? undefined,
      });
    }

    pendingToolCalls = [];
  }

  return {
    specificationVersion: "v3",

    async wrapGenerate({ doGenerate, params, model }) {
      // Create tool spans from previous step's pending tool calls
      await createToolSpansFromPending(params);

      const startTime = new Date().toISOString();
      const promptSummary = summarizePrompt(params.prompt);

      console.log(`[opper-tracing] Creating generation span for ${model.modelId}...`);

      // Create generation span (awaited to get ID for parent tracking)
      const span = await client.createSpan({
        name: `generation:${model.modelId}`,
        type: "generation",
        start_time: startTime,
        input: promptSummary,
        parent_id: currentParentSpanId ?? undefined,
        trace_id: currentTraceId ?? undefined,
      });

      if (span) {
        console.log(`[opper-tracing] Span created: ${span.id} (trace: ${span.trace_id})`);
        // Use trace from first span for all subsequent spans
        if (!currentTraceId) {
          currentTraceId = span.trace_id;
        }
        // This generation span becomes the parent for tool spans
        currentParentSpanId = span.id;
      } else {
        console.log(`[opper-tracing] Failed to create span (check API key)`);
      }

      console.log(`[opper-tracing] Calling model...`);
      const result = await doGenerate();

      const endTime = new Date().toISOString();
      lastGenerateEndTime = endTime;

      // Record pending tool calls if finish reason is tool-calls
      if (result.finishReason.unified === "tool-calls") {
        pendingToolCalls = result.content
          .filter(
            (c): c is { type: "tool-call"; toolCallId: string; toolName: string; input: string } =>
              c.type === "tool-call"
          )
          .map((tc) => ({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: truncate(tc.input, 500),
          }));
      }

      console.log(`[opper-tracing] Model returned: finishReason=${result.finishReason.unified}, tokens=${result.usage.inputTokens.total}/${result.usage.outputTokens.total}`);

      // Update span with output (fire-and-forget)
      if (span) {
        const outputSummary = summarizeContent(result.content);
        console.log(`[opper-tracing] Updating span ${span.id} with output`);
        client.updateSpan(span.id, {
          end_time: endTime,
          output: outputSummary,
          meta: {
            finish_reason: result.finishReason.unified,
            input_tokens: result.usage.inputTokens.total,
            output_tokens: result.usage.outputTokens.total,
            model_id: model.modelId,
          },
        });
      }

      return result;
    },

    async wrapStream({ doStream, params, model }) {
      // Create tool spans from previous step's pending tool calls
      await createToolSpansFromPending(params);

      const startTime = new Date().toISOString();
      const promptSummary = summarizePrompt(params.prompt);

      console.log(`[opper-tracing] Creating stream span for ${model.modelId}...`);

      // Create generation span (awaited to get ID)
      const span = await client.createSpan({
        name: `generation:${model.modelId}`,
        type: "generation",
        start_time: startTime,
        input: promptSummary,
        parent_id: currentParentSpanId ?? undefined,
        trace_id: currentTraceId ?? undefined,
      });

      if (span) {
        console.log(`[opper-tracing] Stream span created: ${span.id} (trace: ${span.trace_id})`);
        if (!currentTraceId) {
          currentTraceId = span.trace_id;
        }
        currentParentSpanId = span.id;
      }

      console.log(`[opper-tracing] Starting stream...`);
      const result = await doStream();

      // Wrap the stream to capture finish event
      const collectedToolCalls: PendingToolCall[] = [];
      let collectedText = "";
      let finishData: {
        finishReason: string;
        inputTokens: number;
        outputTokens: number;
      } | null = null;

      const transformedStream = result.stream.pipeThrough(
        new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          transform(chunk, controller) {
            // Pass through all chunks
            controller.enqueue(chunk);

            if (chunk.type === "text-delta") {
              collectedText += chunk.delta;
            } else if (chunk.type === "tool-call") {
              collectedToolCalls.push({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: truncate(chunk.input, 500),
              });
            } else if (chunk.type === "finish") {
              finishData = {
                finishReason: chunk.finishReason.unified,
                inputTokens: chunk.usage.inputTokens.total ?? 0,
                outputTokens: chunk.usage.outputTokens.total ?? 0,
              };
            }
          },
          flush() {
            const endTime = new Date().toISOString();
            lastGenerateEndTime = endTime;

            console.log(`[opper-tracing] Stream finished: ${collectedText.length} chars, ${collectedToolCalls.length} tool calls`);

            if (collectedToolCalls.length > 0) {
              pendingToolCalls = collectedToolCalls;
            }

            if (span) {
              const output = collectedText
                ? truncate(collectedText, 500)
                : collectedToolCalls.length > 0
                  ? `[tool calls: ${collectedToolCalls.map((tc) => tc.toolName).join(", ")}]`
                  : undefined;

              client.updateSpan(span.id, {
                end_time: endTime,
                output,
                meta: {
                  finish_reason: finishData?.finishReason,
                  input_tokens: finishData?.inputTokens,
                  output_tokens: finishData?.outputTokens,
                  model_id: model.modelId,
                  streamed: true,
                },
              });
            }
          },
        })
      );

      return { ...result, stream: transformedStream };
    },
  };
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function summarizePrompt(prompt: LanguageModelV3Prompt): string {
  const parts: string[] = [];
  for (const msg of prompt) {
    if (msg.role === "system") {
      parts.push(`[system] ${truncate(msg.content, 200)}`);
    } else if (msg.role === "user") {
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push(`[user] ${truncate(part.text, 300)}`);
        } else if (part.type === "file") {
          parts.push(`[user] [file: ${part.mediaType}]`);
        }
      }
    } else if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          parts.push(`[assistant] ${truncate(part.text, 200)}`);
        } else if (part.type === "tool-call") {
          parts.push(`[assistant] [tool-call: ${part.toolName}]`);
        }
      }
    } else if (msg.role === "tool") {
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          const output =
            typeof part.output === "string"
              ? truncate(part.output, 100)
              : "[object]";
          parts.push(`[tool-result: ${part.toolName}] ${output}`);
        }
      }
    }
  }
  return truncate(parts.join("\n"), 500);
}

function summarizeContent(
  content: Array<{ type: string; text?: string; toolName?: string; input?: string }>
): string {
  const parts: string[] = [];
  for (const c of content) {
    if (c.type === "text" && c.text) {
      parts.push(truncate(c.text, 300));
    } else if (c.type === "tool-call" && c.toolName) {
      parts.push(`[tool-call: ${c.toolName}(${truncate(c.input ?? "", 100)})]`);
    }
  }
  return truncate(parts.join("\n"), 500);
}
