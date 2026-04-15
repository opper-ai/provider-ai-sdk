import type {
  LanguageModelV3,
  ImageModelV2,
  SpeechModelV3,
  TranscriptionModelV3,
} from "@ai-sdk/provider";
import { TaskLanguageModel } from "./task-language-model.js";
import { TaskImageModel } from "./task-image-model.js";
import { TaskSpeechModel } from "./task-speech-model.js";
import { TaskTranscriptionModel } from "./task-transcription-model.js";
import type { TaskProviderOptions, TaskModelOptions } from "./types.js";

export interface TaskProvider {
  /**
   * Creates a language model for the given model ID.
   * @param modelId - The model ID (e.g., "default", "anthropic/claude-sonnet-4-5", "openai/gpt-5")
   * @param options - Optional model-specific options (e.g., { name: "my-task" })
   */
  languageModel(modelId: string, options?: TaskModelOptions): LanguageModelV3;

  /**
   * Creates an image generation model.
   * @param modelId - The model ID (e.g., "default", "openai/dall-e-3")
   * @param options - Optional model-specific options (e.g., { name: "my-task" })
   */
  imageModel(modelId: string, options?: TaskModelOptions): ImageModelV2;

  /**
   * Creates a text-to-speech model.
   * @param modelId - The model ID (e.g., "default", "openai/tts-1")
   * @param options - Optional model-specific options (e.g., { name: "my-task" })
   */
  speechModel(modelId: string, options?: TaskModelOptions): SpeechModelV3;

  /**
   * Creates an audio transcription model.
   * @param modelId - The model ID (e.g., "default", "openai/whisper-1")
   * @param options - Optional model-specific options (e.g., { name: "my-task" })
   */
  transcriptionModel(modelId: string, options?: TaskModelOptions): TranscriptionModelV3;

  /**
   * Shorthand for languageModel - call provider directly as a function.
   * @param options - Optional model-specific options (e.g., { name: "my-task" })
   */
  (modelId: string, options?: TaskModelOptions): LanguageModelV3;

  /**
   * Shorthand for imageModel.
   * @param options - Optional model-specific options (e.g., { name: "my-task" })
   */
  image(modelId: string, options?: TaskModelOptions): ImageModelV2;

  /**
   * Shorthand for speechModel.
   * @param options - Optional model-specific options (e.g., { name: "my-task" })
   */
  speech(modelId: string, options?: TaskModelOptions): SpeechModelV3;

  /**
   * Shorthand for transcriptionModel.
   * @param options - Optional model-specific options (e.g., { name: "my-task" })
   */
  transcription(modelId: string, options?: TaskModelOptions): TranscriptionModelV3;
}

/**
 * Creates a Task API provider for use with the AI SDK.
 *
 * @example
 * ```typescript
 * import { createTaskProvider } from '@opper/ai-sdk-provider';
 * import { generateText, generateImage, generateSpeech, transcribe } from 'ai';
 *
 * const task = createTaskProvider();
 *
 * // Text generation
 * const text = await generateText({
 *   model: task('default'),
 *   prompt: 'Hello, world!'
 * });
 *
 * // Image generation
 * const image = await generateImage({
 *   model: task.image('default'),
 *   prompt: 'A sunset over mountains'
 * });
 *
 * // Text-to-speech
 * const audio = await generateSpeech({
 *   model: task.speech('default'),
 *   text: 'Hello, world!'
 * });
 *
 * // Transcription
 * const transcript = await transcribe({
 *   model: task.transcription('default'),
 *   audio: audioBuffer
 * });
 * ```
 */
export function createTaskProvider(
  options: TaskProviderOptions = {}
): TaskProvider {
  // Normalize baseURL (OpenCode convention) to baseUrl
  if (options.baseURL && !options.baseUrl) {
    options.baseUrl = options.baseURL;
  }

  const createLanguageModel = (modelId: string, modelOptions?: TaskModelOptions): LanguageModelV3 => {
    return new TaskLanguageModel({
      ...options,
      modelId,
      modelName: modelOptions?.name,
      modelParentSpanId: modelOptions?.parentSpanId,
    });
  };

  const createImageModel = (modelId: string, modelOptions?: TaskModelOptions): ImageModelV2 => {
    return new TaskImageModel({
      ...options,
      modelId,
      modelName: modelOptions?.name,
      modelParentSpanId: modelOptions?.parentSpanId,
    });
  };

  const createSpeechModel = (modelId: string, modelOptions?: TaskModelOptions): SpeechModelV3 => {
    return new TaskSpeechModel({
      ...options,
      modelId,
      modelName: modelOptions?.name,
      modelParentSpanId: modelOptions?.parentSpanId,
    });
  };

  const createTranscriptionModel = (modelId: string, modelOptions?: TaskModelOptions): TranscriptionModelV3 => {
    return new TaskTranscriptionModel({
      ...options,
      modelId,
      modelName: modelOptions?.name,
      modelParentSpanId: modelOptions?.parentSpanId,
    });
  };

  // Create provider function that can be called directly
  const provider = ((modelId: string, modelOptions?: TaskModelOptions) =>
    createLanguageModel(modelId, modelOptions)) as TaskProvider;

  // Add model methods
  provider.languageModel = createLanguageModel;
  provider.imageModel = createImageModel;
  provider.speechModel = createSpeechModel;
  provider.transcriptionModel = createTranscriptionModel;

  // Add shorthand methods
  provider.image = createImageModel;
  provider.speech = createSpeechModel;
  provider.transcription = createTranscriptionModel;

  return provider;
}

// Default export for convenience
export default createTaskProvider;
