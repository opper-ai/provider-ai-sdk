/**
 * Opper language model — implements LanguageModelV3 using the OpenAI SDK
 * pointed at Opper's OpenAI-compatible endpoint (/v1/compat/chat/completions).
 *
 * Uses the OpenAI npm package rather than raw fetch + manual SSE parsing,
 * for the same reason the pi provider does: SSE parsing is deceptively complex
 * and the OpenAI SDK handles all the edge cases (chunked streams, keep-alives,
 * reconnect events, retry-after headers, browser/Node compat).
 */

import OpenAI from "openai";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolChoice,
} from "@ai-sdk/provider";
import type { OpperModelConfig } from "./types.js";
import { convertMessages } from "./convert-messages.js";

const DEFAULT_BASE_URL = "https://api.opper.ai";

export class OpperLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "opper";
  readonly supportedUrls: Record<string, RegExp[]> = {};

  readonly modelId: string;

  private readonly client: OpenAI;
  private readonly timeoutMs: number;
  private readonly functionName?: string;
  private readonly parentSpanId?: string;

  constructor(config: OpperModelConfig) {
    this.modelId = config.modelId;
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.functionName = config.modelName ?? config.name;
    this.parentSpanId = config.modelParentSpanId ?? config.parentSpanId;

    const baseURL = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "");

    this.client = new OpenAI({
      apiKey: config.apiKey ?? (typeof process !== "undefined" ? process.env.OPPER_API_KEY : undefined) ?? "",
      baseURL: `${baseURL}/v1/compat`,
      timeout: this.timeoutMs,
      dangerouslyAllowBrowser: true,
      defaultHeaders: buildOpperHeaders(
        config.modelName ?? config.name,
        config.modelParentSpanId ?? config.parentSpanId
      ),
    });
  }

  private resolveOpperHeaders(
    providerOptions: Record<string, unknown> | undefined
  ): Record<string, string> {
    const opts = providerOptions?.opper as
      | { name?: string; parentSpanId?: string }
      | undefined;
    return buildOpperHeaders(
      opts?.name ?? this.functionName,
      opts?.parentSpanId ?? this.parentSpanId
    );
  }

  private buildTools(
    tools: LanguageModelV3CallOptions["tools"]
  ): OpenAI.ChatCompletionTool[] | undefined {
    const fnTools = tools?.filter((t) => t.type === "function");
    if (!fnTools || fnTools.length === 0) return undefined;
    return fnTools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
        strict: false,
      },
    }));
  }

  async doGenerate(
    options: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3GenerateResult> {
    const {
      prompt,
      tools,
      toolChoice,
      maxOutputTokens,
      temperature,
      providerOptions,
      abortSignal,
    } = options;

    const messages = convertMessages(prompt);
    const opperTools = this.buildTools(tools);
    const extraHeaders = this.resolveOpperHeaders(providerOptions);

    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.modelId,
          messages,
          ...(opperTools && { tools: opperTools }),
          ...mapToolChoice(toolChoice),
          ...(maxOutputTokens !== undefined && { max_tokens: maxOutputTokens }),
          ...(temperature !== undefined && { temperature }),
        },
        { signal: abortSignal, headers: extraHeaders }
      );

      const choice = response.choices[0];
      const message = choice?.message;

      const content: LanguageModelV3GenerateResult["content"] = [];

      if (message?.content) {
        content.push({ type: "text", text: message.content });
      }

      for (const tc of message?.tool_calls ?? []) {
        content.push({
          type: "tool-call",
          toolCallId: tc.id,
          toolName: tc.function.name,
          input: tc.function.arguments,
        });
      }

      if (content.length === 0) {
        content.push({ type: "text", text: "" });
      }

      return {
        content,
        finishReason: mapFinishReason(choice?.finish_reason) as any,
        usage: {
          inputTokens: {
            total: response.usage?.prompt_tokens ?? 0,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: response.usage?.completion_tokens ?? 0,
            text: undefined,
            reasoning: undefined,
          },
        },
        warnings: [],
        response: { modelId: response.model ?? this.modelId },
      };
    } catch (error) {
      // Encode errors into the result — never throw naked from doGenerate
      const msg = errorMessage(error);
      return {
        content: [{ type: "text", text: "" }],
        finishReason: "error" as any,
        usage: emptyUsage(),
        warnings: [{ type: "other", message: msg }],
        response: { modelId: this.modelId },
      };
    }
  }

  async doStream(
    options: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3StreamResult> {
    const {
      prompt,
      tools,
      toolChoice,
      maxOutputTokens,
      temperature,
      providerOptions,
      abortSignal,
    } = options;

    const messages = convertMessages(prompt);
    const opperTools = this.buildTools(tools);
    const extraHeaders = this.resolveOpperHeaders(providerOptions);

    // If the initial request itself fails, encode the error into a stream
    // rather than letting it propagate as a thrown exception.
    let openaiStream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      openaiStream = (await this.client.chat.completions.create(
        {
          model: this.modelId,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(opperTools && { tools: opperTools }),
          ...mapToolChoice(toolChoice),
          ...(maxOutputTokens !== undefined && { max_tokens: maxOutputTokens }),
          ...(temperature !== undefined && { temperature }),
        },
        { signal: abortSignal, headers: extraHeaders }
      )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    } catch (error) {
      return { stream: errorStream(errorMessage(error)) };
    }

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        const textId = "text-0";
        let textStartEmitted = false;
        // Accumulate streaming tool calls by index (OpenAI streams them incrementally)
        const pendingToolCalls = new Map<
          number,
          { id: string; name: string; args: string }
        >();
        let usageData: { prompt_tokens?: number; completion_tokens?: number } =
          {};
        let streamFinishReason: string | null = null;
        let sawToolCalls = false;

        try {
          for await (const chunk of openaiStream) {
            // Usage-only chunk (comes after [DONE] with stream_options.include_usage)
            if (chunk.usage) {
              usageData = {
                prompt_tokens: chunk.usage.prompt_tokens ?? undefined,
                completion_tokens: chunk.usage.completion_tokens ?? undefined,
              };
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            // ── Text delta ──────────────────────────────────────────────────
            if (delta?.content) {
              if (!textStartEmitted) {
                controller.enqueue({ type: "text-start", id: textId });
                textStartEmitted = true;
              }
              controller.enqueue({
                type: "text-delta",
                id: textId,
                delta: delta.content,
              });
            }

            // ── Tool call deltas ────────────────────────────────────────────
            if (delta?.tool_calls) {
              sawToolCalls = true;
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!pendingToolCalls.has(idx)) {
                  pendingToolCalls.set(idx, {
                    id: tc.id ?? `tool-${idx}`,
                    name: tc.function?.name ?? "",
                    args: tc.function?.arguments ?? "",
                  });
                } else {
                  const pending = pendingToolCalls.get(idx)!;
                  if (tc.id) pending.id = tc.id;
                  if (tc.function?.name) pending.name = tc.function.name;
                  if (tc.function?.arguments) pending.args += tc.function.arguments;
                }
              }
            }

            // ── Finish reason ───────────────────────────────────────────────
            if (choice.finish_reason) {
              streamFinishReason = choice.finish_reason;
              if (textStartEmitted) {
                controller.enqueue({ type: "text-end", id: textId });
                textStartEmitted = false;
              }
              for (const [, tc] of pendingToolCalls) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: tc.id,
                  toolName: tc.name,
                  input: tc.args || "{}",
                });
              }
              pendingToolCalls.clear();
            }
          }
        } catch (error) {
          // Encode stream errors as a finish event rather than throwing
          controller.enqueue({
            type: "finish",
            finishReason: "error" as any,
            usage: emptyUsage(),
          });
          controller.close();
          return;
        }

        // Flush any text / tool calls that didn't get a finish_reason chunk
        if (textStartEmitted) {
          controller.enqueue({ type: "text-end", id: textId });
        }
        for (const [, tc] of pendingToolCalls) {
          controller.enqueue({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.args || "{}",
          });
        }

        const reason =
          sawToolCalls || streamFinishReason === "tool_calls"
            ? "tool-calls"
            : streamFinishReason === "length"
              ? "length"
              : "stop";

        controller.enqueue({
          type: "finish",
          finishReason: reason as any,
          usage: {
            inputTokens: {
              total: usageData.prompt_tokens ?? 0,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: usageData.completion_tokens ?? 0,
              text: undefined,
              reasoning: undefined,
            },
          },
        });

        controller.close();
      },
    });

    return { stream };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildOpperHeaders(
  name?: string,
  parentSpanId?: string
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (name) headers["X-Opper-Name"] = name;
  if (parentSpanId) headers["X-Opper-Parent-Span-Id"] = parentSpanId;
  return headers;
}

function mapToolChoice(
  toolChoice: LanguageModelV3ToolChoice | undefined
): Partial<Pick<OpenAI.ChatCompletionCreateParams, "tool_choice">> {
  if (!toolChoice) return {};
  switch (toolChoice.type) {
    case "none":
      return { tool_choice: "none" };
    case "auto":
      return { tool_choice: "auto" };
    case "required":
      return { tool_choice: "required" };
    case "tool":
      return {
        tool_choice: {
          type: "function",
          function: { name: toolChoice.toolName },
        },
      };
    default:
      return {};
  }
}

function mapFinishReason(reason?: string | null): string {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool-calls";
    case "content_filter":
      return "content-filter";
    default:
      return "other";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function emptyUsage() {
  return {
    inputTokens: {
      total: 0,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 0, text: undefined, reasoning: undefined },
  };
}

function errorStream(
  _message: string
): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({
        type: "finish",
        finishReason: "error" as any,
        usage: emptyUsage(),
      });
      controller.close();
    },
  });
}
