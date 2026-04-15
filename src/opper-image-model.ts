import type { ImageModelV3, ImageModelV3CallOptions, SharedV3Warning } from "@ai-sdk/provider";
import {
  combineHeaders,
  createJsonResponseHandler,
  postJsonToApi,
} from "@ai-sdk/provider-utils";
import { z } from "zod";
import type { OpperFunctionModelConfig } from "./opper-function-config.js";
import { opperFailedResponseHandler } from "./opper-error.js";

const imageResponseSchema = z.object({
  data: z.object({
    images: z.array(z.string()),
  }),
});

export class OpperImageModel implements ImageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "opper.image";
  readonly maxImagesPerCall = 4;
  readonly modelId: string;

  constructor(
    modelId: string,
    private readonly config: OpperFunctionModelConfig
  ) {
    this.modelId = modelId;
  }

  async doGenerate(options: ImageModelV3CallOptions) {
    const {
      prompt,
      n,
      size,
      aspectRatio,
      seed,
      abortSignal,
      providerOptions,
      headers: callHeaders,
    } = options;

    const warnings: SharedV3Warning[] = [];

    const body = {
      input_schema: {
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
      output_schema: {
        type: "object",
        properties: {
          images: { type: "array", items: { type: "string" } },
        },
        required: ["images"],
      },
      input: {
        prompt,
        n: n ?? 1,
        ...(size && { size }),
        ...(aspectRatio && { aspect_ratio: aspectRatio }),
        ...(seed !== undefined && { seed }),
      },
      hints: {
        model: this.modelId !== "default" ? this.modelId : undefined,
      },
    };

    const functionName = resolveFunctionName(providerOptions, "ai-sdk-image");

    const { value, responseHeaders } = await postJsonToApi({
      url: `${this.config.baseURL}/v3/functions/${encodeURIComponent(functionName)}/call`,
      headers: combineHeaders(
        this.config.headers(),
        { "X-Opper-Name": functionName },
        callHeaders as Record<string, string | undefined>
      ),
      body,
      failedResponseHandler: opperFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(imageResponseSchema),
      abortSignal,
      fetch: this.config.fetch,
    });

    return {
      images: value.data.images,
      warnings,
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders,
      },
    };
  }
}

function resolveFunctionName(
  providerOptions: Record<string, unknown> | undefined,
  defaultName: string
): string {
  const opts = providerOptions?.opper as { name?: string } | undefined;
  return opts?.name ?? defaultName;
}
