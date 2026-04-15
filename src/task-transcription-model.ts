import type { TranscriptionModelV3, TranscriptionModelV3CallOptions } from "@ai-sdk/provider";
import type { TaskModelConfig } from "./types.js";

export class TaskTranscriptionModel implements TranscriptionModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider: string;
  readonly modelId: string;

  private readonly baseUrl: string;
  private readonly providerName?: string;
  private readonly modelName?: string;
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
    functionName: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    headers["X-Opper-Name"] = functionName;
    const parentSpanId = this.resolveParentSpanId(providerOptions);
    if (parentSpanId) {
      headers["X-Opper-Parent-Span-Id"] = parentSpanId;
    }
    return headers;
  }

  async doGenerate(options: TranscriptionModelV3CallOptions) {
    const { audio, mediaType, abortSignal, providerOptions } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const signal = abortSignal
      ? AbortSignal.any([abortSignal, controller.signal])
      : controller.signal;

    // Convert audio to base64 if it's a Uint8Array
    const audioBase64 =
      typeof audio === "string"
        ? audio
        : Buffer.from(audio).toString("base64");

    try {
      const functionName = this.resolveName(providerOptions, "ai-sdk-transcription");
      const response = await fetch(
        `${this.baseUrl}/v3/functions/${functionName}/call`,
        {
          method: "POST",
          headers: this.buildHeaders(providerOptions, functionName),
          body: JSON.stringify({
            input_schema: {
              type: "object",
              properties: {
                audio: { type: "string" }, // base64 encoded
                media_type: { type: "string" },
              },
              required: ["audio", "media_type"],
            },
            output_schema: {
              type: "object",
              properties: {
                text: { type: "string" },
                segments: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string" },
                      start: { type: "number" },
                      end: { type: "number" },
                    },
                  },
                },
                language: { type: "string" },
                duration: { type: "number" },
              },
              required: ["text"],
            },
            input: {
              audio: audioBase64,
              media_type: mediaType,
            },
            hints: {
              model: this.modelId !== "default" ? this.modelId : undefined,
            },
          }),
          signal,
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          `Task API error: ${error.error?.message ?? response.statusText}`
        );
      }

      const result = await response.json();
      const output = result.data ?? {};

      return {
        text: output.text ?? "",
        segments:
          output.segments?.map((s: { text: string; start: number; end: number }) => ({
            text: s.text,
            startSecond: s.start,
            endSecond: s.end,
          })) ?? [],
        language: output.language,
        durationInSeconds: output.duration,
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId: this.modelId,
          headers: undefined,
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
