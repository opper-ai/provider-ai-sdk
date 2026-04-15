import type {
  TranscriptionModelV3,
  TranscriptionModelV3CallOptions,
} from "@ai-sdk/provider";
import type { OpperModelConfig } from "./types.js";
import { callOpperFunction } from "./opper-function-client.js";

export class OpperTranscriptionModel implements TranscriptionModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "opper";
  readonly modelId: string;

  constructor(private readonly config: OpperModelConfig) {
    this.modelId = config.modelId;
  }

  async doGenerate(options: TranscriptionModelV3CallOptions) {
    const { audio, mediaType, abortSignal, providerOptions } = options;

    const audioBase64 =
      typeof audio === "string"
        ? audio
        : Buffer.from(audio).toString("base64");

    try {
      const { data } = await callOpperFunction(
        this.config,
        { audio: audioBase64, media_type: mediaType },
        {
          type: "object",
          properties: {
            audio: { type: "string" },
            media_type: { type: "string" },
          },
          required: ["audio", "media_type"],
        },
        {
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
        { model: this.modelId !== "default" ? this.modelId : undefined },
        { abortSignal, providerOptions }
      );

      type Segment = { text: string; start: number; end: number };

      return {
        text: (data.text as string) ?? "",
        segments:
          ((data.segments as Segment[] | undefined) ?? []).map((s) => ({
            text: s.text,
            startSecond: s.start,
            endSecond: s.end,
          })),
        language: data.language as string | undefined,
        durationInSeconds: data.duration as number | undefined,
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId: this.modelId,
          headers: undefined,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Opper transcription failed: ${msg}`);
    }
  }
}
