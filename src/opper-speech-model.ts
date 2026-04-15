import type { SpeechModelV3, SpeechModelV3CallOptions } from "@ai-sdk/provider";
import type { OpperModelConfig } from "./types.js";
import { callOpperFunction } from "./opper-function-client.js";

export class OpperSpeechModel implements SpeechModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "opper";
  readonly modelId: string;

  constructor(private readonly config: OpperModelConfig) {
    this.modelId = config.modelId;
  }

  async doGenerate(options: SpeechModelV3CallOptions) {
    const {
      text,
      voice,
      outputFormat,
      instructions,
      speed,
      language,
      abortSignal,
      providerOptions,
    } = options;

    try {
      const { data } = await callOpperFunction(
        this.config,
        {
          text,
          ...(voice && { voice }),
          ...(outputFormat && { output_format: outputFormat }),
          ...(instructions && { instructions }),
          ...(speed !== undefined && { speed }),
          ...(language && { language }),
        },
        {
          type: "object",
          properties: {
            text: { type: "string" },
            voice: { type: "string" },
            output_format: { type: "string" },
            instructions: { type: "string" },
            speed: { type: "number" },
            language: { type: "string" },
          },
          required: ["text"],
        },
        {
          type: "object",
          properties: {
            audio: { type: "string" }, // base64-encoded audio
          },
          required: ["audio"],
        },
        { model: this.modelId !== "default" ? this.modelId : undefined },
        { abortSignal, providerOptions }
      );

      return {
        audio: (data.audio as string) ?? "",
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId: this.modelId,
          headers: undefined,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Opper speech generation failed: ${msg}`);
    }
  }
}
