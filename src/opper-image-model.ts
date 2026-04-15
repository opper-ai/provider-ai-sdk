import type { ImageModelV2, ImageModelV2CallOptions } from "@ai-sdk/provider";
import type { OpperModelConfig } from "./types.js";
import { callOpperFunction } from "./opper-function-client.js";

export class OpperImageModel implements ImageModelV2 {
  readonly specificationVersion = "v2" as const;
  readonly provider = "opper";
  readonly maxImagesPerCall = 4;
  readonly modelId: string;

  constructor(private readonly config: OpperModelConfig) {
    this.modelId = config.modelId;
  }

  async doGenerate(options: ImageModelV2CallOptions) {
    const { prompt, n, size, aspectRatio, seed, abortSignal, providerOptions } = options;

    try {
      const { data } = await callOpperFunction(
        this.config,
        {
          prompt,
          n: n ?? 1,
          ...(size && { size }),
          ...(aspectRatio && { aspect_ratio: aspectRatio }),
          ...(seed !== undefined && { seed }),
        },
        {
          type: "object",
          properties: {
            prompt: { type: "string" },
            n: { type: "integer" },
            size: { type: "string" },
            aspect_ratio: { type: "string" },
            seed: { type: "integer" },
          },
          required: ["prompt"],
        },
        {
          type: "object",
          properties: {
            images: { type: "array", items: { type: "string" } },
          },
          required: ["images"],
        },
        { model: this.modelId !== "default" ? this.modelId : undefined },
        { abortSignal, providerOptions }
      );

      const images: string[] = (data.images as string[] | undefined) ?? [];

      return {
        images,
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId: this.modelId,
          headers: undefined,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Opper image generation failed: ${msg}`);
    }
  }
}
