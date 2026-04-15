import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3Prompt,
  LanguageModelV3Content,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import type {
  TaskModelConfig,
  TaskMessage,
  TaskChatResponse,
  TaskRunRequest,
} from "./types.js";

// Simple input schema for object generation mode
const ObjectGenerationInputSchema = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    system: { type: "string" },
  },
  required: ["prompt"],
};

export class TaskLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private readonly baseUrl: string;
  private readonly providerName?: string;
  private readonly modelName?: string;
  private readonly prefer?: "fast" | "cheap" | "quality" | "balanced";
  private readonly timeoutMs: number;
  private readonly apiKey?: string;
  private readonly modelParentSpanId?: string;
  private readonly providerParentSpanId?: string;

  constructor(config: TaskModelConfig) {
    this.provider = "task-api";
    this.modelId = config.modelId;
    this.baseUrl = config.baseUrl ?? "https://api.opper.ai";
    this.providerName = config.name;
    this.modelName = config.modelName;
    this.prefer = config.prefer;
    this.timeoutMs = config.timeoutMs ?? 120000;
    this.apiKey = config.apiKey;
    this.modelParentSpanId = config.modelParentSpanId;
    this.providerParentSpanId = config.parentSpanId;
  }

  /**
   * Resolve the function name with priority:
   * 1. providerOptions.opper.name (per-call)
   * 2. modelName (per-model creation)
   * 3. providerName (provider-level default)
   * 4. defaultName fallback
   */
  private resolveName(
    providerOptions: Record<string, unknown> | undefined,
    defaultName: string
  ): string {
    const opperOpts = providerOptions?.opper as { name?: string } | undefined;
    return opperOpts?.name ?? this.modelName ?? this.providerName ?? defaultName;
  }

  private resolveParentSpanId(
    providerOptions: Record<string, unknown> | undefined
  ): string | undefined {
    const opperOpts = providerOptions?.opper as { parentSpanId?: string } | undefined;
    return opperOpts?.parentSpanId ?? this.modelParentSpanId ?? this.providerParentSpanId;
  }

  private buildHeaders(
    providerOptions: Record<string, unknown> | undefined,
    functionName?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    if (functionName) {
      headers["X-Opper-Name"] = functionName;
    }
    const parentSpanId = this.resolveParentSpanId(providerOptions);
    if (parentSpanId) {
      headers["X-Opper-Parent-Span-Id"] = parentSpanId;
    }
    return headers;
  }

  async doGenerate(
    options: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3GenerateResult> {
    const { prompt, tools, maxOutputTokens, temperature, responseFormat } = options;

    // Check if this is a JSON/object generation request
    const isObjectGeneration = responseFormat?.type === "json" && responseFormat.schema;

    if (isObjectGeneration) {
      return this.doGenerateObject(options);
    }

    return this.doGenerateChat(options);
  }

  /**
   * Handle generateObject requests - uses Task API's schema enforcement
   */
  private async doGenerateObject(
    options: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3GenerateResult> {
    const { prompt, responseFormat, providerOptions } = options;

    // Type guard - we know responseFormat is json type here
    const jsonFormat = responseFormat as {
      type: "json";
      schema?: Record<string, unknown>;
      name?: string;
      description?: string;
    };

    // Extract the prompt text from messages
    const { systemPrompt, userPrompt } = this.extractPromptsFromMessages(prompt);

    // Build instructions from schema metadata
    const schemaDescription = jsonFormat.description || jsonFormat.name;
    const instructions = schemaDescription
      ? `Generate a JSON object. ${schemaDescription}`
      : undefined;

    // Build request with user's output schema
    const runRequest: TaskRunRequest = {
      input_schema: ObjectGenerationInputSchema,
      output_schema: jsonFormat.schema as Record<string, unknown>,
      input: {
        prompt: userPrompt,
        ...(systemPrompt && { system: systemPrompt }),
      },
      hints: {
        prefer: this.prefer,
        model: this.modelId !== "default" ? this.modelId : undefined,
        instructions,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const functionName = this.resolveName(providerOptions, "ai-sdk-object");
      const response = await fetch(
        `${this.baseUrl}/v3/functions/${functionName}/call`,
        {
          method: "POST",
          headers: this.buildHeaders(providerOptions, functionName),
          body: JSON.stringify(runRequest),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          `Task API error: ${error.error?.message ?? response.statusText}`
        );
      }

      const result = await response.json();

      // Task API returns the object directly in result.data
      // AI SDK expects the JSON as a text string that it will parse
      const jsonText = JSON.stringify(result.data);

      return {
        content: [{ type: "text", text: jsonText }],
        finishReason: "stop" as any,
        usage: {
          inputTokens: {
            total: result.meta?.input_tokens ?? 0,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: result.meta?.output_tokens ?? 0,
            text: undefined,
            reasoning: undefined,
          },
        },
        warnings: [],
        response: {
          modelId: result.meta?.models_used?.[0] ?? this.modelId,
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handle generateText requests - chat completion mode via compat endpoint
   */
  private async doGenerateChat(
    options: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3GenerateResult> {
    const { prompt, tools, maxOutputTokens, temperature, providerOptions } = options;

    const messages = this.convertPromptToMessages(prompt);
    const compatTools = this.buildCompatTools(tools);

    // Build OpenAI-format request for compat endpoint
    const requestBody: Record<string, unknown> = {
      model: this.modelId,
      messages,
      ...(compatTools && { tools: compatTools }),
      ...(temperature !== undefined && { temperature }),
      ...(maxOutputTokens !== undefined && { max_tokens: maxOutputTokens }),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(
        `${this.baseUrl}/v1/compat/chat/completions`,
        {
          method: "POST",
          headers: this.buildHeaders(providerOptions),
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          `Task API error: ${error.error?.message ?? response.statusText}`
        );
      }

      const result: TaskChatResponse = await response.json();
      const choice = result.choices[0];
      const message = choice?.message;

      // Convert response to AI SDK format
      const content: LanguageModelV3Content[] = [];

      if (message?.content) {
        content.push({ type: "text", text: message.content });
      }

      if (message?.tool_calls) {
        for (const tc of message.tool_calls) {
          // Compat endpoint uses OpenAI format: function.name, function.arguments
          const name = tc.function?.name ?? tc.name ?? "";
          const args = tc.function?.arguments ?? (tc.arguments ? JSON.stringify(tc.arguments) : "{}");

          const part: LanguageModelV3Content = {
            type: "tool-call",
            toolCallId: tc.id,
            toolName: name,
            input: args,
          };

          // Attach thought_signature for round-tripping
          if (tc.thought_signature) {
            (part as Record<string, unknown>).providerMetadata = {
              opper: { thoughtSignature: tc.thought_signature },
            };
          }

          content.push(part);
        }
      }

      if (content.length === 0) {
        content.push({ type: "text", text: "" });
      }

      const finishReason = this.mapFinishReason(choice?.finish_reason);
      const inputTokens = result.usage?.prompt_tokens ?? 0;
      const outputTokens = result.usage?.completion_tokens ?? 0;

      return {
        content,
        finishReason: finishReason as any,
        usage: {
          inputTokens: {
            total: inputTokens,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: outputTokens,
            text: undefined,
            reasoning: undefined,
          },
        },
        warnings: [],
        response: {
          modelId: result.model ?? this.modelId,
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Build OpenAI-format tools array from AI SDK tool definitions.
   */
  private buildCompatTools(
    tools: LanguageModelV3CallOptions["tools"]
  ): Array<{ type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } }> | undefined {
    const filtered = tools?.filter((t) => t.type === "function");
    if (!filtered || filtered.length === 0) return undefined;
    return filtered.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          ...(t.inputSchema as Record<string, unknown>),
        },
      },
    }));
  }

  async doStream(
    options: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3StreamResult> {
    const { prompt, tools, maxOutputTokens, temperature, providerOptions } = options;

    const messages = this.convertPromptToMessages(prompt);
    const compatTools = this.buildCompatTools(tools);

    // Build OpenAI-format request for compat endpoint
    const requestBody: Record<string, unknown> = {
      model: this.modelId,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(compatTools && { tools: compatTools }),
      ...(temperature !== undefined && { temperature }),
      ...(maxOutputTokens !== undefined && { max_tokens: maxOutputTokens }),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const response = await fetch(
      `${this.baseUrl}/v1/compat/chat/completions`,
      {
        method: "POST",
        headers: this.buildHeaders(providerOptions),
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      clearTimeout(timeoutId);
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Task API error: ${error.error?.message ?? response.statusText}`
      );
    }

    if (!response.body) {
      clearTimeout(timeoutId);
      throw new Error("No response body for streaming");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const textId = "text-0";
    let textStartEmitted = false;
    let finished = false;

    // Track pending tool calls (OpenAI streams tool calls incrementally)
    const pendingToolCalls = new Map<number, {
      toolCallId: string;
      toolName: string;
      args: string;
      thoughtSignature?: string;
    }>();

    let lineBuffer = "";
    let usageData: { prompt_tokens?: number; completion_tokens?: number } = {};
    let sawToolCalls = false;
    let streamFinishReason: string | null = null;

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                if (!finished) {
                  // Flush any remaining buffered data
                  if (lineBuffer.trim().startsWith("data: ") && !lineBuffer.trim().startsWith("data: [DONE]")) {
                    try {
                      const data = JSON.parse(lineBuffer.trim().slice(6));
                      processChunk(data, controller);
                    } catch { /* ignore */ }
                  }
                  finishStream(controller);
                }
                controller.close();
                clearTimeout(timeoutId);
                return;
              }

              const text = decoder.decode(value, { stream: true });
              const parts = (lineBuffer + text).split("\n");
              lineBuffer = parts.pop() || "";

              for (const line of parts) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data: ")) continue;

                const payload = trimmed.slice(6);
                if (payload === "[DONE]") {
                  if (!finished) {
                    finishStream(controller);
                  }
                  continue;
                }

                try {
                  const data = JSON.parse(payload);
                  processChunk(data, controller);
                } catch { /* ignore parse errors */ }
              }
            }
          } catch (error) {
            clearTimeout(timeoutId);
            controller.error(error);
          }
        })();
      },
      cancel() {
        clearTimeout(timeoutId);
        reader.cancel();
      },
    });

    // Process a single OpenAI SSE chunk
    function processChunk(
      data: Record<string, unknown>,
      ctrl: ReadableStreamDefaultController<LanguageModelV3StreamPart>
    ) {
      if (finished) return;

      // Usage-only chunk (sent after finish_reason with stream_options.include_usage)
      if (data.usage) {
        const usage = data.usage as Record<string, number>;
        usageData = {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
        };
      }

      const choices = data.choices as Array<{
        index: number;
        delta: {
          role?: string;
          content?: string;
          tool_calls?: Array<{
            index: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
            thought_signature?: string;
          }>;
        };
        finish_reason?: string | null;
      }> | undefined;

      if (!choices || choices.length === 0) return;

      const choice = choices[0];
      const delta = choice.delta;

      // Text content delta
      if (delta?.content) {
        if (!textStartEmitted) {
          ctrl.enqueue({ type: "text-start", id: textId });
          textStartEmitted = true;
        }
        ctrl.enqueue({ type: "text-delta", id: textId, delta: delta.content });
      }

      // Tool call deltas (OpenAI streams these incrementally)
      if (delta?.tool_calls) {
        sawToolCalls = true;
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!pendingToolCalls.has(idx)) {
            // First chunk for this tool call - has id, type, function.name
            pendingToolCalls.set(idx, {
              toolCallId: tc.id || `tool-call-${idx}`,
              toolName: tc.function?.name || "",
              args: tc.function?.arguments || "",
              thoughtSignature: tc.thought_signature,
            });
          } else {
            // Subsequent chunks - accumulate arguments
            const pending = pendingToolCalls.get(idx)!;
            if (tc.function?.arguments) {
              pending.args += tc.function.arguments;
            }
            if (tc.thought_signature && !pending.thoughtSignature) {
              pending.thoughtSignature = tc.thought_signature;
            }
          }
        }
      }

      // Finish reason present - emit tool calls but wait for usage/[DONE]
      if (choice.finish_reason) {
        streamFinishReason = choice.finish_reason;
        if (textStartEmitted) {
          ctrl.enqueue({ type: "text-end", id: textId });
          textStartEmitted = false;
        }
        emitPendingToolCalls(ctrl);
      }
    }

    function emitPendingToolCalls(
      ctrl: ReadableStreamDefaultController<LanguageModelV3StreamPart>
    ) {
      for (const [, tc] of pendingToolCalls) {
        const part: LanguageModelV3StreamPart = {
          type: "tool-call",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.args || "{}",
        };
        // Attach thought_signature via providerMetadata for round-tripping
        if (tc.thoughtSignature) {
          (part as Record<string, unknown>).providerMetadata = {
            opper: { thoughtSignature: tc.thoughtSignature },
          };
        }
        ctrl.enqueue(part);
      }
      pendingToolCalls.clear();
    }

    function finishStream(
      ctrl: ReadableStreamDefaultController<LanguageModelV3StreamPart>
    ) {
      if (finished) return;
      if (textStartEmitted) {
        ctrl.enqueue({ type: "text-end", id: textId });
        textStartEmitted = false;
      }
      emitPendingToolCalls(ctrl);
      // Use plain string finishReason for compatibility with OpenCode
      // (OpenCode expects string, not v3 { unified, raw } object)
      const reason = sawToolCalls || streamFinishReason === "tool_calls"
        ? "tool-calls"
        : "stop";
      ctrl.enqueue({
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
      finished = true;
    }

    return {
      stream,
    };
  }

  /**
   * Extract system and user prompts from AI SDK message format
   */
  private extractPromptsFromMessages(
    prompt: LanguageModelV3Prompt
  ): { systemPrompt?: string; userPrompt: string } {
    let systemPrompt: string | undefined;
    const userParts: string[] = [];

    for (const msg of prompt) {
      if (msg.role === "system") {
        systemPrompt = msg.content;
      } else if (msg.role === "user") {
        for (const part of msg.content) {
          if (part.type === "text") {
            userParts.push(part.text);
          }
        }
      } else if (msg.role === "assistant") {
        // Include assistant messages in context
        for (const part of msg.content) {
          if (part.type === "text" && part.text) {
            userParts.push(`Assistant: ${part.text}`);
          }
        }
      }
    }

    return {
      systemPrompt,
      userPrompt: userParts.join("\n"),
    };
  }

  private convertPromptToMessages(
    prompt: LanguageModelV3Prompt
  ): TaskMessage[] {
    const messages: TaskMessage[] = [];

    for (const msg of prompt) {
      if (msg.role === "system") {
        messages.push({ role: "system", content: msg.content });
      } else if (msg.role === "user") {
        const parts = msg.content.map((part) => {
          if (part.type === "text") {
            return { type: "text" as const, text: part.text };
          } else if (part.type === "file") {
            const data =
              part.data instanceof URL
                ? part.data.toString()
                : typeof part.data === "string"
                  ? part.data
                  : this.uint8ArrayToBase64(part.data);

            if (part.mediaType.startsWith("image/")) {
              return { type: "image" as const, image: data };
            } else if (part.mediaType === "application/pdf") {
              return { type: "pdf" as const, pdf: data };
            } else if (part.mediaType.startsWith("audio/")) {
              return { type: "audio" as const, audio: data };
            } else if (part.mediaType.startsWith("video/")) {
              return { type: "video" as const, video: data };
            }
            return { type: "text" as const, text: `[file: ${part.mediaType}]` };
          }
          return { type: "text" as const, text: "" };
        });

        messages.push({ role: "user", content: parts });
      } else if (msg.role === "assistant") {
        const textParts = msg.content
          .filter(
            (p): p is { type: "text"; text: string } => p.type === "text"
          )
          .map((p) => p.text);

        const toolCalls = msg.content
          .filter((p) => p.type === "tool-call")
          .map((tc) => {
            // tc is LanguageModelV3ToolCallPart after filter
            const toolCall = tc as { type: "tool-call"; toolCallId: string; toolName: string; input: unknown; providerOptions?: Record<string, Record<string, unknown>> };
            const argsString = typeof toolCall.input === "string"
              ? toolCall.input
              : JSON.stringify(toolCall.input);
            // Extract thought_signature from providerOptions for round-tripping
            const opperOpts = toolCall.providerOptions?.opper as { thoughtSignature?: string } | undefined;
            const thoughtSignature = opperOpts?.thoughtSignature;
            return {
              id: toolCall.toolCallId,
              type: "function" as const,
              function: {
                name: toolCall.toolName,
                arguments: argsString,
              },
              ...(thoughtSignature && { thought_signature: thoughtSignature }),
            };
          });

        messages.push({
          role: "assistant",
          content: textParts.join("\n") || "",
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        });
      } else if (msg.role === "tool") {
        for (const part of msg.content) {
          if (part.type === "tool-result") {
            const resultText =
              typeof part.output === "string"
                ? part.output
                : JSON.stringify(this.sanitizeToolResult(part.output));
            messages.push({
              role: "tool",
              content: resultText,
              tool_call_id: part.toolCallId,
              name: part.toolName,
            });
          }
        }
      }
    }

    return messages;
  }

  private uint8ArrayToBase64(data: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
  }

  // Returns plain string for compatibility with OpenCode (expects string, not v3 { unified, raw })
  private mapFinishReason(reason?: string): string {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "tool_calls":
        return "tool-calls";
      default:
        return "other";
    }
  }

  /**
   * Sanitize tool results to remove large binary data (base64 images, audio, etc.)
   * before sending back to the LLM. This prevents token limit issues.
   */
  private sanitizeToolResult(output: unknown): unknown {
    if (output === null || typeof output !== "object") {
      return output;
    }

    const obj = output as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Check if this looks like a base64 data URL
      if (
        key === "url" &&
        typeof value === "string" &&
        value.startsWith("data:")
      ) {
        // Replace with a placeholder - the actual data is already displayed in the UI
        sanitized[key] = "[base64 data - displayed in UI]";
      } else if (Array.isArray(value)) {
        // Recursively sanitize arrays
        sanitized[key] = value.map((item) => this.sanitizeToolResult(item));
      } else if (typeof value === "object" && value !== null) {
        // Recursively sanitize nested objects
        sanitized[key] = this.sanitizeToolResult(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
