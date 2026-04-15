/**
 * Map Opper/OpenAI usage to LanguageModelV3Usage.
 */
import type { LanguageModelV3Usage } from "@ai-sdk/provider";

export function mapUsage(raw: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
} | null | undefined): LanguageModelV3Usage {
  const inputTokens = raw?.prompt_tokens ?? undefined;
  const outputTokens = raw?.completion_tokens ?? undefined;
  return {
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens,
      reasoning: undefined,
    },
    raw: raw ?? undefined,
  };
}
