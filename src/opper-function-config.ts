/**
 * Shared config for Opper function API models (image, speech, transcription).
 * Uses the same pattern as the language model config — headers as a lazy
 * getter function, optional fetch override.
 */
import type { FetchFunction } from "@ai-sdk/provider-utils";

export type OpperFunctionModelConfig = {
  baseURL: string;
  headers: () => Record<string, string | undefined>;
  fetch?: FetchFunction;
};
