// @opper/ai-sdk-provider
// AI SDK provider for Opper Task API

import { createTaskProvider, type TaskProvider } from "./task-provider.js";

/**
 * Default Opper Task API provider instance.
 *
 * @example
 * ```typescript
 * import { opper } from '@opper/ai-sdk-provider';
 * import { generateText, generateImage, generateSpeech, transcribe } from 'ai';
 *
 * // Text generation
 * const text = await generateText({
 *   model: opper('default'),
 *   prompt: 'Hello, world!'
 * });
 *
 * // Image generation
 * const image = await generateImage({
 *   model: opper.image('default'),
 *   prompt: 'A sunset over mountains'
 * });
 *
 * // Text-to-speech
 * const audio = await generateSpeech({
 *   model: opper.speech('default'),
 *   text: 'Hello!'
 * });
 *
 * // Transcription
 * const transcript = await transcribe({
 *   model: opper.transcription('default'),
 *   audio: audioBuffer
 * });
 * ```
 */
export const opper = createTaskProvider();

export { createTaskProvider, type TaskProvider } from "./task-provider.js";
export { TaskLanguageModel } from "./task-language-model.js";
export { TaskImageModel } from "./task-image-model.js";
export { TaskSpeechModel } from "./task-speech-model.js";
export { TaskTranscriptionModel } from "./task-transcription-model.js";
export { createTracingMiddleware } from "./tracing-middleware.js";
export type { TracingMiddlewareOptions } from "./tracing-middleware.js";
export type {
  TaskProviderOptions,
  TaskModelConfig,
  TaskModelOptions,
  TaskMessage,
  TaskTool,
  TaskToolCall,
  TaskChatRequest,
  TaskChatResponse,
  CreateSpanPayload,
  UpdateSpanPayload,
  SpanResponse,
} from "./types.js";
