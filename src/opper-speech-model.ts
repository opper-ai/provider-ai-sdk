import type { SpeechModelV3, SpeechModelV3CallOptions } from "@ai-sdk/provider";
import {
  combineHeaders,
  createJsonResponseHandler,
  postJsonToApi,
} from "@ai-sdk/provider-utils";
import { z } from "zod";
import type { OpperFunctionModelConfig } from "./opper-function-config.js";
import { opperFailedResponseHandler } from "./opper-error.js";

const speechResponseSchema = z.object({
  data: z.object({
    audio: z.string(), // base64-encoded audio
  }),
});

export class OpperSpeechModel implements SpeechModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "opper.speech";
  readonly modelId: string;

  constructor(
    modelId: string,
    private readonly config: OpperFunctionModelConfig
  ) {
    this.modelId = modelId;
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
      headers: callHeaders,
    } = options;

    const body = {
      input_schema: {
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
      output_schema: {
        type: "object",
        properties: { audio: { type: "string" } },
        required: ["audio"],
      },
      input: {
        text,
        ...(voice && { voice }),
        ...(outputFormat && { output_format: outputFormat }),
        ...(instructions && { instructions }),
        ...(speed !== undefined && { speed }),
        ...(language && { language }),
      },
      hints: {
        model: this.modelId !== "default" ? this.modelId : undefined,
      },
    };

    const functionName = resolveFunctionName(providerOptions, "ai-sdk-speech");

    const { value } = await postJsonToApi({
      url: `${this.config.baseURL}/v3/functions/${encodeURIComponent(functionName)}/call`,
      headers: combineHeaders(
        this.config.headers(),
        { "X-Opper-Name": functionName },
        callHeaders as Record<string, string | undefined>
      ),
      body,
      failedResponseHandler: opperFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(speechResponseSchema),
      abortSignal,
      fetch: this.config.fetch,
    });

    return {
      audio: value.data.audio,
      warnings: [],
      response: { timestamp: new Date(), modelId: this.modelId },
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
