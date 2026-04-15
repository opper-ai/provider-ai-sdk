// @opper/ai-sdk-provider
// AI SDK provider for Opper — use any model through the Vercel AI SDK.

export { opper, createOpper, type OpperProvider } from "./opper-provider.js";
export { OpperLanguageModel } from "./opper-language-model.js";
export { OpperImageModel } from "./opper-image-model.js";
export { OpperSpeechModel } from "./opper-speech-model.js";
export { OpperTranscriptionModel } from "./opper-transcription-model.js";
export { createTracingMiddleware, type TracingMiddlewareOptions } from "./tracing-middleware.js";
export type {
  OpperProviderOptions,
  OpperModelOptions,
  OpperModelConfig,
  CreateSpanPayload,
  UpdateSpanPayload,
  SpanResponse,
} from "./types.js";
