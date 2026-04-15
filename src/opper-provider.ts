import {
  OpenAICompatibleChatLanguageModel,
  OpenAICompatibleEmbeddingModel,
} from '@ai-sdk/openai-compatible';
import type { LanguageModelV3, EmbeddingModelV3 } from '@ai-sdk/provider';
import {
  FetchFunction,
  loadApiKey,
  withoutTrailingSlash,
} from '@ai-sdk/provider-utils';

const DEFAULT_BASE_URL = 'https://api.opper.ai/v3/compat';

// Internal marker used to smuggle per-call Opper headers through the body
// before the custom fetch wrapper extracts them and converts to real headers.
const OPPER_HEADERS_FIELD = '__opper__';

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
   *
   * Accepts any Opper model string, e.g. `"openai/gpt-4o"` or
   * `"anthropic/claude-sonnet-4-5"`.
   *
   * Opper-specific options (tracing, guardrails) can be set per-call via
   * `providerOptions`:
   *
   * ```ts
   * await generateText({
   *   model: opper('openai/gpt-4o'),
   *   prompt: 'Hello!',
   *   providerOptions: {
   *     opper: { name: 'my-function', guardInput: 'pii,secrets' },
   *   },
   * });
   * ```
   */
  (modelId: string): LanguageModelV3;

  languageModel(modelId: string): LanguageModelV3;
  chatModel(modelId: string): LanguageModelV3;
  embeddingModel(modelId: string): EmbeddingModelV3;
}

export function createOpper(
  options: OpperProviderSettings = {},
): OpperProvider {
  const baseURL = withoutTrailingSlash(options.baseURL) ?? DEFAULT_BASE_URL;

  const getHeaders = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: 'OPPER_API_KEY',
      description: 'Opper',
    })}`,
    ...options.headers,
  });

  // Wrap fetch to extract the Opper-specific marker field from the body and
  // convert its contents into real request headers before the request is sent.
  const baseFetch = (options.fetch ?? fetch) as typeof fetch;
  const opperFetch: typeof fetch = async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(init.body);
      } catch {
        return baseFetch(input, init);
      }

      if (parsed[OPPER_HEADERS_FIELD]) {
        const opperHeaders = parsed[OPPER_HEADERS_FIELD] as Record<string, string>;
        delete parsed[OPPER_HEADERS_FIELD];

        const headers = new Headers(init.headers as HeadersInit);
        for (const [key, value] of Object.entries(opperHeaders)) {
          if (value) headers.set(key, value);
        }

        return baseFetch(input, {
          ...init,
          headers,
          body: JSON.stringify(parsed),
        });
      }
    }
    return baseFetch(input, init);
  };

  // Intercept the request body to promote any Opper-specific fields that came
  // in via providerOptions.opper into the hidden marker field for opperFetch.
  const transformRequestBody = (body: Record<string, unknown>) => {
    const opperHeaders: Record<string, string> = {};

    if (typeof body.name === 'string') {
      opperHeaders['X-Opper-Name'] = body.name;
      delete body.name;
    }
    if (typeof body.parentSpanId === 'string') {
      opperHeaders['X-Opper-Parent-Span-Id'] = body.parentSpanId;
      delete body.parentSpanId;
    }
    if (typeof body.guardInput === 'string') {
      opperHeaders['X-Opper-Guard-Input'] = body.guardInput;
      delete body.guardInput;
    }
    if (typeof body.guardOutput === 'string') {
      opperHeaders['X-Opper-Guard-Output'] = body.guardOutput;
      delete body.guardOutput;
    }
    if (typeof body.guardAction === 'string') {
      opperHeaders['X-Opper-Guard-Action'] = body.guardAction;
      delete body.guardAction;
    }

    if (Object.keys(opperHeaders).length > 0) {
      body[OPPER_HEADERS_FIELD] = opperHeaders;
    }

    return body;
  };

  const getChatConfig = () => ({
    provider: 'opper.chat',
    url: ({ path }: { path: string }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: opperFetch as FetchFunction,
    includeUsage: true,
    transformRequestBody,
  });

  const getEmbeddingConfig = () => ({
    provider: 'opper.embedding',
    url: ({ path }: { path: string }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: opperFetch as FetchFunction,
  });

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, getChatConfig());

  const createEmbeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, getEmbeddingConfig());

  const provider = (modelId: string) => createChatModel(modelId);

  provider.languageModel = createChatModel;
  provider.chatModel = createChatModel;
  provider.embeddingModel = createEmbeddingModel;

  return provider as OpperProvider;
}

/**
 * Default Opper provider instance. Reads the API key from the
 * `OPPER_API_KEY` environment variable.
 */
export const opper = createOpper();
