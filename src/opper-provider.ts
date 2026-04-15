import type {
  LanguageModelV3,
  ImageModelV2,
  SpeechModelV3,
  TranscriptionModelV3,
} from "@ai-sdk/provider";
import { OpperLanguageModel } from "./opper-language-model.js";
import { OpperImageModel } from "./opper-image-model.js";
import { OpperSpeechModel } from "./opper-speech-model.js";
import { OpperTranscriptionModel } from "./opper-transcription-model.js";
import type { OpperProviderOptions, OpperModelOptions } from "./types.js";

export interface OpperProvider {
  /**
   * Create a language model. `modelId` is the Opper model string,
   * e.g. `"default"`, `"anthropic/claude-sonnet-4-5-20250514"`, `"openai/gpt-4o"`.
   */
  (modelId: string, options?: OpperModelOptions): LanguageModelV3;
  languageModel(modelId: string, options?: OpperModelOptions): LanguageModelV3;

  /** Create an image generation model. */
  image(modelId: string, options?: OpperModelOptions): ImageModelV2;
  imageModel(modelId: string, options?: OpperModelOptions): ImageModelV2;

  /** Create a text-to-speech model. */
  speech(modelId: string, options?: OpperModelOptions): SpeechModelV3;
  speechModel(modelId: string, options?: OpperModelOptions): SpeechModelV3;

  /** Create a speech-to-text model. */
  transcription(
    modelId: string,
    options?: OpperModelOptions
  ): TranscriptionModelV3;
  transcriptionModel(
    modelId: string,
    options?: OpperModelOptions
  ): TranscriptionModelV3;
}

/**
 * Create an Opper provider instance.
 *
 * @example
 * ```ts
 * import { createOpper } from "@opper/ai-sdk-provider";
 *
 * const opper = createOpper({ apiKey: process.env.OPPER_API_KEY });
 *
 * // Text generation
 * const model = opper("anthropic/claude-sonnet-4-5-20250514");
 *
 * // Image generation
 * const imageModel = opper.image("openai/dall-e-3");
 * ```
 */
export function createOpper(
  providerOptions: OpperProviderOptions = {}
): OpperProvider {
  function makeConfig(modelId: string, modelOptions?: OpperModelOptions) {
    return {
      ...providerOptions,
      modelId,
      modelName: modelOptions?.name,
      modelParentSpanId: modelOptions?.parentSpanId,
    };
  }

  const languageModel = (
    modelId: string,
    options?: OpperModelOptions
  ): LanguageModelV3 => new OpperLanguageModel(makeConfig(modelId, options));

  const imageModel = (
    modelId: string,
    options?: OpperModelOptions
  ): ImageModelV2 => new OpperImageModel(makeConfig(modelId, options));

  const speechModel = (
    modelId: string,
    options?: OpperModelOptions
  ): SpeechModelV3 => new OpperSpeechModel(makeConfig(modelId, options));

  const transcriptionModel = (
    modelId: string,
    options?: OpperModelOptions
  ): TranscriptionModelV3 =>
    new OpperTranscriptionModel(makeConfig(modelId, options));

  const provider = ((modelId: string, options?: OpperModelOptions) =>
    languageModel(modelId, options)) as OpperProvider;

  provider.languageModel = languageModel;
  provider.image = imageModel;
  provider.imageModel = imageModel;
  provider.speech = speechModel;
  provider.speechModel = speechModel;
  provider.transcription = transcriptionModel;
  provider.transcriptionModel = transcriptionModel;

  return provider;
}

/** Default provider instance — reads OPPER_API_KEY from env. */
export const opper = createOpper();
