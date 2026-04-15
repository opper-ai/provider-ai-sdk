// @opper/ai-sdk-provider
// AI SDK provider for Opper — use any model through the Vercel AI SDK.

export {
  opper,
  createOpper,
  type OpperProvider,
  type OpperProviderSettings,
} from "./opper-provider.js";
export { OpperLanguageModel, type OpperLanguageModelConfig } from "./opper-language-model.js";
export { OpperImageModel } from "./opper-image-model.js";
export { OpperSpeechModel } from "./opper-speech-model.js";
export { OpperTranscriptionModel } from "./opper-transcription-model.js";
export { createTracingMiddleware, type TracingMiddlewareOptions } from "./tracing-middleware.js";
export type { OpperFunctionModelConfig } from "./opper-function-config.js";
