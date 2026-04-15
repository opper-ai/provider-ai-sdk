/**
 * Map an Opper/OpenAI finish_reason to LanguageModelV3FinishReason.
 */
import type { LanguageModelV3FinishReason } from "@ai-sdk/provider";

export function mapFinishReason(
  raw: string | null | undefined
): LanguageModelV3FinishReason {
  switch (raw) {
    case "stop":
      return { unified: "stop", raw };
    case "length":
    case "model_length":
      return { unified: "length", raw };
    case "tool_calls":
      return { unified: "tool-calls", raw };
    case "content_filter":
      return { unified: "content-filter", raw };
    default:
      return { unified: "other", raw: raw ?? undefined };
  }
}
