import type {
  LanguageModelV3,
  ImageModelV3,
  SpeechModelV3,
  TranscriptionModelV3,
  EmbeddingModelV3,
  NoSuchModelError,
} from "@ai-sdk/provider";
import {
  FetchFunction,
  loadApiKey,
  withoutTrailingSlash,
} from "@ai-sdk/provider-utils";
import { OpperLanguageModel } from "./opper-language-model.js";
import { OpperImageModel } from "./opper-image-model.js";
import { OpperSpeechModel } from "./opper-speech-model.js";
import { OpperTranscriptionModel } from "./opper-transcription-model.js";

export interface OpperProvider {
  readonly specificationVersion: "v3";

  /**
   * Creates a language model. `modelId` accepts any Opper model string:
   * `"default"`, `"anthropic/claude-sonnet-4-5-20250514"`, `"openai/gpt-4o"`, etc.
   */
  (modelId: string): LanguageModelV3;
  languageModel(modelId: string): LanguageModelV3;

  // ProviderV3 required methods
  embeddingModel(modelId: string): EmbeddingModelV3;
  imageModel(modelId: string): ImageModelV3;
  transcriptionModel(modelId?: string): TranscriptionModelV3;
  speechModel(modelId?: string): SpeechModelV3;

  /** Shorthand for imageModel. */
  image(modelId: string): ImageModelV3;
  /** Shorthand for speechModel. */
  speech(modelId: string): SpeechModelV3;
  /** Shorthand for transcriptionModel. */
  transcription(modelId: string): TranscriptionModelV3;
}

export interface OpperProviderSettings {
  /**
   * Opper API key.
   * Defaults to `OPPER_API_KEY` environment variable.
   */
  apiKey?: string;

  /**
   * Base URL for the Opper API.
   * Defaults to `https://api.opper.ai`.
   */
  baseURL?: string;

  /**
   * Custom headers included in every request.
   */
  headers?: Record<string, string>;

  /**
   * Custom fetch implementation — useful for proxies, testing, or middleware.
   */
  fetch?: FetchFunction;
}

const DEFAULT_BASE_URL = "https://api.opper.ai";

/**
 * Create an Opper AI SDK provider instance.
 *
 * @example
 * ```ts
 * import { createOpper } from "@opper/ai-sdk-provider";
 * import { generateText } from "ai";
 *
 * const opper = createOpper({ apiKey: process.env.OPPER_API_KEY });
 *
 * const { text } = await generateText({
 *   model: opper("anthropic/claude-sonnet-4-5-20250514"),
 *   prompt: "Hello!",
 * });
 * ```
 */
export function createOpper(
  options: OpperProviderSettings = {}
): OpperProvider {
  const baseURL =
    withoutTrailingSlash(options.baseURL) ?? DEFAULT_BASE_URL;

  const getHeaders = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: "OPPER_API_KEY",
      description: "Opper",
    })}`,
    ...options.headers,
  });

  const functionConfig = {
    baseURL,
    headers: getHeaders,
    fetch: options.fetch,
  };

  const createLanguageModel = (modelId: string): LanguageModelV3 =>
    new OpperLanguageModel(modelId, {
      provider: "opper.language",
      baseURL: `${baseURL}/v3/compat`,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const createImageModel = (modelId: string): ImageModelV3 =>
    new OpperImageModel(modelId, functionConfig);

  const createSpeechModel = (modelId: string): SpeechModelV3 =>
    new OpperSpeechModel(modelId, functionConfig);

  const createTranscriptionModel = (modelId: string): TranscriptionModelV3 =>
    new OpperTranscriptionModel(modelId, functionConfig);

  const noEmbeddingModel = (modelId: string): EmbeddingModelV3 => {
    const { NoSuchModelError: E } = require("@ai-sdk/provider") as typeof import("@ai-sdk/provider");
    throw new E({ modelId, modelType: "embeddingModel" });
  };

  const provider = function (modelId: string) {
    if (new.target) {
      throw new Error(
        "The Opper provider function cannot be called with the new keyword."
      );
    }
    return createLanguageModel(modelId);
  } as unknown as OpperProvider;

  (provider as any).specificationVersion = "v3";
  (provider as any).languageModel = createLanguageModel;
  (provider as any).embeddingModel = noEmbeddingModel;
  (provider as any).imageModel = createImageModel;
  (provider as any).image = createImageModel;
  (provider as any).speechModel = createSpeechModel;
  (provider as any).speech = createSpeechModel;
  (provider as any).transcriptionModel = createTranscriptionModel;
  (provider as any).transcription = createTranscriptionModel;

  return provider;
}

/** Default Opper provider instance — reads `OPPER_API_KEY` from env. */
export const opper = createOpper();
