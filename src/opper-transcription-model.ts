import type {
  TranscriptionModelV3,
  TranscriptionModelV3CallOptions,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  convertUint8ArrayToBase64,
  createJsonResponseHandler,
  postJsonToApi,
} from "@ai-sdk/provider-utils";
import { z } from "zod";
import type { OpperFunctionModelConfig } from "./opper-function-config.js";
import { opperFailedResponseHandler } from "./opper-error.js";

const transcriptionResponseSchema = z.object({
  data: z.object({
    text: z.string(),
    segments: z
      .array(
        z.object({
          text: z.string(),
          start: z.number(),
          end: z.number(),
        })
      )
      .optional(),
    language: z.string().optional(),
    duration: z.number().optional(),
  }),
});

export class OpperTranscriptionModel implements TranscriptionModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "opper.transcription";
  readonly modelId: string;

  constructor(
    modelId: string,
    private readonly config: OpperFunctionModelConfig
  ) {
    this.modelId = modelId;
  }

  async doGenerate(options: TranscriptionModelV3CallOptions) {
    const { audio, mediaType, abortSignal, providerOptions, headers: callHeaders } =
      options;

    const audioBase64 =
      typeof audio === "string"
        ? audio
        : convertUint8ArrayToBase64(audio);

    const body = {
      input_schema: {
        type: "object",
        properties: {
          audio: { type: "string" },
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
      input: { audio: audioBase64, media_type: mediaType },
      hints: {
        model: this.modelId !== "default" ? this.modelId : undefined,
      },
    };

    const functionName = resolveFunctionName(
      providerOptions,
      "ai-sdk-transcription"
    );

    const { value } = await postJsonToApi({
      url: `${this.config.baseURL}/v3/functions/${encodeURIComponent(functionName)}/call`,
      headers: combineHeaders(
        this.config.headers(),
        { "X-Opper-Name": functionName },
        callHeaders as Record<string, string | undefined>
      ),
      body,
      failedResponseHandler: opperFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        transcriptionResponseSchema
      ),
      abortSignal,
      fetch: this.config.fetch,
    });

    const d = value.data;
    return {
      text: d.text,
      segments: (d.segments ?? []).map((s) => ({
        text: s.text,
        startSecond: s.start,
        endSecond: s.end,
      })),
      language: d.language,
      durationInSeconds: d.duration,
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
