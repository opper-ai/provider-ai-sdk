import {
  OpenAICompatibleChatLanguageModel,
  OpenAICompatibleEmbeddingModel,
} from '@ai-sdk/openai-compatible';
import {
  NoSuchModelError,
  type EmbeddingModelV4,
  type ImageModelV4,
  type LanguageModelV4,
  type ProviderV4,
} from '@ai-sdk/provider';
import {
  loadApiKey,
  withoutTrailingSlash,
  withUserAgentSuffix,
  type FetchFunction,
} from '@ai-sdk/provider-utils';
import { OpperChatLanguageModel, OpperEmbeddingModel } from './opper-models.js';
import { VERSION } from './version.js';

const DEFAULT_BASE_URL = 'https://api.opper.ai/v3/compat';

export interface OpperProviderSettings {
  /**
   * Opper API key. Defaults to the `OPPER_API_KEY` environment variable.
   */
  apiKey?: string;

  /**
   * Base URL for Opper API calls. Defaults to `https://api.opper.ai/v3/compat`.
   */
  baseURL?: string;

  /**
   * Custom headers to include in every request.
   */
  headers?: Record<string, string>;

  /**
   * Custom fetch implementation, e.g. for proxies or testing.
   */
  fetch?: FetchFunction;
}

export interface OpperProvider extends ProviderV4 {
  /**
   * Creates a chat model for the given Opper model id: a pool name such as
   * `claude-sonnet-4-6`, or a `provider/model` id such as
   * `anthropic/claude-sonnet-4-6` that pins one route.
   */
  (modelId: string): LanguageModelV4;

  /**
   * Creates a chat model for the given Opper model id.
   */
  languageModel(modelId: string): LanguageModelV4;

  /**
   * Creates a chat model for the given Opper model id.
   */
  chatModel(modelId: string): LanguageModelV4;

  /**
   * Creates an embedding model for the given Opper model id.
   */
  embeddingModel(modelId: string): EmbeddingModelV4;

  /**
   * @deprecated Use `embeddingModel` instead.
   */
  textEmbeddingModel(modelId: string): EmbeddingModelV4;

  /**
   * Not supported: throws `NoSuchModelError`.
   */
  imageModel(modelId: string): ImageModelV4;
}

export function createOpper(options: OpperProviderSettings = {}): OpperProvider {
  const baseURL = withoutTrailingSlash(options.baseURL ?? DEFAULT_BASE_URL);

  const getHeaders = () =>
    withUserAgentSuffix(
      {
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: 'OPPER_API_KEY',
          description: 'Opper',
        })}`,
        ...options.headers,
      },
      `ai-sdk-opper/${VERSION}`,
    );

  const getCommonModelConfig = (modelType: string) => ({
    provider: `opper.${modelType}`,
    url: ({ path }: { path: string }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: options.fetch,
  });

  const createChatModel = (modelId: string) =>
    new OpperChatLanguageModel(
      new OpenAICompatibleChatLanguageModel(modelId, {
        ...getCommonModelConfig('chat'),
        includeUsage: true,
        supportsStructuredOutputs: true,
      }),
    );

  const createEmbeddingModel = (modelId: string) =>
    new OpperEmbeddingModel(
      new OpenAICompatibleEmbeddingModel(
        modelId,
        getCommonModelConfig('embedding'),
      ),
    );

  const provider = (modelId: string) => createChatModel(modelId);

  provider.specificationVersion = 'v4' as const;
  provider.languageModel = createChatModel;
  provider.chatModel = createChatModel;
  provider.embeddingModel = createEmbeddingModel;
  provider.textEmbeddingModel = createEmbeddingModel;
  provider.imageModel = (modelId: string): ImageModelV4 => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' });
  };

  return provider as OpperProvider;
}

/**
 * Default Opper provider instance. Reads the API key from the
 * `OPPER_API_KEY` environment variable.
 */
export const opper = createOpper();
