import {
  OpenAICompatibleChatLanguageModel,
  OpenAICompatibleEmbeddingModel,
} from '@ai-sdk/openai-compatible';
import type {
  LanguageModelV3,
  EmbeddingModelV3,
} from '@ai-sdk/provider';
import {
  FetchFunction,
  loadApiKey,
  withoutTrailingSlash,
} from '@ai-sdk/provider-utils';

const DEFAULT_BASE_URL = 'https://api.opper.ai/v3/compat';

export interface OpperProviderSettings {
  /**
   * Opper API key. Defaults to the OPPER_API_KEY environment variable.
   */
  apiKey?: string;

  /**
   * Base URL for Opper API calls.
   * Defaults to https://api.opper.ai/v3/compat.
   */
  baseURL?: string;

  /**
   * Custom headers included in every request.
   */
  headers?: Record<string, string>;

  /**
   * Custom fetch implementation — useful for proxies or testing.
   */
  fetch?: FetchFunction;
}

export interface OpperProvider {
  /**
   * Creates a language model for the given Opper model ID.
   * Accepts any Opper model string, e.g. "openai/gpt-4o" or "anthropic/claude-sonnet-4-5".
   */
  (modelId: string): LanguageModelV3;

  languageModel(modelId: string): LanguageModelV3;
  chatModel(modelId: string): LanguageModelV3;
  embeddingModel(modelId: string): EmbeddingModelV3;
}

export function createOpper(
  options: OpperProviderSettings = {},
): OpperProvider {
  const baseURL =
    withoutTrailingSlash(options.baseURL) ?? DEFAULT_BASE_URL;

  const getHeaders = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: 'OPPER_API_KEY',
      description: 'Opper',
    })}`,
    ...options.headers,
  });

  const getModelConfig = (modelType: string) => ({
    provider: `opper.${modelType}`,
    url: ({ path }: { path: string }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: options.fetch,
    includeUsage: true,
  });

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, getModelConfig('chat'));

  const createEmbeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, getModelConfig('embedding'));

  const provider = (modelId: string) => createChatModel(modelId);

  provider.languageModel = createChatModel;
  provider.chatModel = createChatModel;
  provider.embeddingModel = createEmbeddingModel;

  return provider as OpperProvider;
}

/**
 * Default Opper provider instance — reads OPPER_API_KEY from env.
 */
export const opper = createOpper();
