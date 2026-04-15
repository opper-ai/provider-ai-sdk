/**
 * Opper language model — implements LanguageModelV3.
 *
 * Uses @ai-sdk/provider-utils (postJsonToApi, createJsonResponseHandler,
 * createEventSourceResponseHandler) — the same approach used by all
 * first-party AI SDK providers. This gives us:
 *  - Proper error handling via createJsonErrorResponseHandler
 *  - Zod-validated responses
 *  - Standardized SSE parsing via createEventSourceResponseHandler
 *  - Consistent request/response telemetry fields
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  SharedV3Warning,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  FetchFunction,
  generateId,
  ParseResult,
  postJsonToApi,
} from "@ai-sdk/provider-utils";
import { z } from "zod";
import { convertMessages } from "./convert-messages.js";
import { mapFinishReason } from "./map-finish-reason.js";
import { mapUsage } from "./map-usage.js";
import { opperFailedResponseHandler } from "./opper-error.js";
import {
  opperChatResponseSchema,
  opperChatChunkSchema,
  type OpperChatChunk,
} from "./opper-chat-schemas.js";

export type OpperLanguageModelConfig = {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string | undefined>;
  fetch?: FetchFunction;
  generateId?: () => string;
};

export class OpperLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  readonly modelId: string;

  private readonly config: OpperLanguageModelConfig;
  private readonly _generateId: () => string;

  constructor(modelId: string, config: OpperLanguageModelConfig) {
    this.modelId = modelId;
    this.config = config;
    this._generateId = config.generateId ?? generateId;
  }

  get provider(): string {
    return this.config.provider;
  }

  private getArgs(options: LanguageModelV3CallOptions) {
    const warnings: SharedV3Warning[] = [];

    const {
      prompt,
      tools,
      toolChoice,
      maxOutputTokens,
      temperature,
      topP,
      topK,
      frequencyPenalty,
      presencePenalty,
      seed,
      responseFormat,
      stopSequences,
      headers: callHeaders,
    } = options;

    // Warn about unsupported standard params
    if (topK != null) warnings.push({ type: "unsupported", feature: "topK" });
    if (stopSequences != null)
      warnings.push({ type: "unsupported", feature: "stopSequences" });

    const messages = convertMessages(prompt);

    // Tools
    const opperTools =
      tools
        ?.filter((t) => t.type === "function")
        .map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })) ?? undefined;

    const opperToolChoice = mapToolChoice(toolChoice);

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages,
      ...(opperTools && opperTools.length > 0 && { tools: opperTools }),
      ...(opperToolChoice && { tool_choice: opperToolChoice }),
      ...(maxOutputTokens != null && { max_tokens: maxOutputTokens }),
      ...(temperature != null && { temperature }),
      ...(topP != null && { top_p: topP }),
      ...(frequencyPenalty != null && { frequency_penalty: frequencyPenalty }),
      ...(presencePenalty != null && { presence_penalty: presencePenalty }),
      ...(seed != null && { seed }),
    };

    const headers = combineHeaders(
      this.config.headers(),
      callHeaders as Record<string, string | undefined>
    );

    return { body, headers, warnings };
  }

  async doGenerate(
    options: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3GenerateResult> {
    const { body, headers, warnings } = this.getArgs(options);

    const {
      value: response,
      responseHeaders,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers,
      body,
      failedResponseHandler: opperFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        opperChatResponseSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const choice = response.choices[0];
    const message = choice?.message;
    const content: LanguageModelV3Content[] = [];

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

    return {
      content,
      finishReason: mapFinishReason(choice?.finish_reason),
      usage: mapUsage(response.usage),
      warnings,
      request: { body },
      response: {
        id: response.id,
        modelId: response.model ?? this.modelId,
        headers: responseHeaders,
        body: rawResponse,
      },
    };
  }

  async doStream(
    options: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3StreamResult> {
    const { body: baseBody, headers, warnings } = this.getArgs(options);
    const body = { ...baseBody, stream: true, stream_options: { include_usage: true } };

    const { value: stream, responseHeaders } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers,
      body,
      failedResponseHandler: opperFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        opperChatChunkSchema
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    let finishReason: LanguageModelV3FinishReason = {
      unified: "other",
      raw: undefined,
    };
    let usage = mapUsage(undefined);
    let isFirstChunk = true;

    // Track incremental tool call assembly (OpenAI streams tool calls by index)
    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; args: string }
    >();

    return {
      stream: stream.pipeThrough(
        new TransformStream<
          ParseResult<z.infer<typeof opperChatChunkSchema>>,
          LanguageModelV3StreamPart
        >({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings });
          },

          transform(chunk, controller) {
            // Surface parse errors as stream error events
            if (!chunk.success) {
              controller.enqueue({ type: "error", error: chunk.error });
              return;
            }

            const value = chunk.value;

            // First chunk: emit response-metadata
            if (isFirstChunk) {
              isFirstChunk = false;
              if (value.id || value.model) {
                controller.enqueue({
                  type: "response-metadata",
                  id: value.id,
                  modelId: value.model,
                });
              }
            }

            // Usage-only chunk (sent after [DONE] with stream_options.include_usage)
            if (value.usage) {
              usage = mapUsage(value.usage);
            }

            const choice = value.choices?.[0];
            if (!choice) return;

            const delta = choice.delta;

            // Text content
            if (delta.content) {
              controller.enqueue({ type: "text-start", id: "text-0" });
              controller.enqueue({
                type: "text-delta",
                id: "text-0",
                delta: delta.content,
              });
              controller.enqueue({ type: "text-end", id: "text-0" });
            }

            // Incremental tool call assembly
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;

                if (!pendingToolCalls.has(idx)) {
                  const id = tc.id ?? `tool-${idx}`;
                  pendingToolCalls.set(idx, {
                    id,
                    name: tc.function?.name ?? "",
                    args: tc.function?.arguments ?? "",
                  });
                  // Emit tool-input-start for streaming UX
                  controller.enqueue({
                    type: "tool-input-start",
                    id,
                    toolName: tc.function?.name ?? "",
                  });
                } else {
                  const pending = pendingToolCalls.get(idx)!;
                  if (tc.id) pending.id = tc.id;
                  if (tc.function?.name) pending.name = tc.function.name;
                  if (tc.function?.arguments) {
                    controller.enqueue({
                      type: "tool-input-delta",
                      id: pending.id,
                      delta: tc.function.arguments,
                    });
                    pending.args += tc.function.arguments;
                  }
                }
              }
            }

            if (choice.finish_reason) {
              finishReason = mapFinishReason(choice.finish_reason);
            }
          },

          flush(controller) {
            // Emit completed tool calls
            for (const [, tc] of pendingToolCalls) {
              controller.enqueue({ type: "tool-input-end", id: tc.id });
              controller.enqueue({
                type: "tool-call",
                toolCallId: tc.id,
                toolName: tc.name,
                input: tc.args || "{}",
              });
            }

            controller.enqueue({
              type: "finish",
              finishReason,
              usage,
            });
          },
        })
      ),
      request: { body },
      response: { headers: responseHeaders },
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapToolChoice(
  toolChoice: LanguageModelV3CallOptions["toolChoice"]
): string | { type: "function"; function: { name: string } } | undefined {
  if (!toolChoice) return undefined;
  switch (toolChoice.type) {
    case "none":
      return "none";
    case "auto":
      return "auto";
    case "required":
      return "required";
    case "tool":
      return { type: "function", function: { name: toolChoice.toolName } };
    default:
      return undefined;
  }
}
