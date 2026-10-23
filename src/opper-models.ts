import type {
  EmbeddingModelV4,
  EmbeddingModelV4CallOptions,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider';

/** Maps `providerOptions.opper` keys to the request headers Opper reads. */
const OPPER_HEADER_OPTIONS = {
  name: 'X-Opper-Name',
  parentSpanId: 'X-Opper-Parent-Span-Id',
} as const;

/**
 * Splits the Opper per-call options out of `providerOptions.opper` and returns
 * them as request headers. The remaining `providerOptions` are returned without
 * those keys, so they are not also sent in the request body.
 */
export function extractOpperHeaders(
  providerOptions: SharedV4ProviderOptions | undefined,
): {
  headers: Record<string, string>;
  providerOptions: SharedV4ProviderOptions | undefined;
} {
  const opperOptions = providerOptions?.opper;
  if (opperOptions == null) {
    return { headers: {}, providerOptions };
  }

  const headers: Record<string, string> = {};
  const rest = { ...opperOptions };

  for (const [option, header] of Object.entries(OPPER_HEADER_OPTIONS)) {
    const value = rest[option];
    if (typeof value === 'string' && value.length > 0) {
      headers[header] = value;
    }
    delete rest[option];
  }

  const { opper: _opper, ...otherProviderOptions } = providerOptions!;

  return {
    headers,
    providerOptions:
      Object.keys(rest).length > 0
        ? { ...otherProviderOptions, opper: rest }
        : otherProviderOptions,
  };
}

/**
 * Chat model that turns `providerOptions.opper` into Opper request headers
 * before handing the call to the OpenAI-compatible chat model.
 */
export class OpperChatLanguageModel implements LanguageModelV4 {
  readonly specificationVersion: 'v4' = 'v4';

  constructor(private readonly model: LanguageModelV4) {}

  get provider(): string {
    return this.model.provider;
  }

  get modelId(): string {
    return this.model.modelId;
  }

  get supportedUrls() {
    return this.model.supportedUrls;
  }

  doGenerate(options: LanguageModelV4CallOptions) {
    return this.model.doGenerate(withOpperHeaders(options));
  }

  doStream(options: LanguageModelV4CallOptions) {
    return this.model.doStream(withOpperHeaders(options));
  }
}

/**
 * Embedding model that turns `providerOptions.opper` into Opper request
 * headers before handing the call to the OpenAI-compatible embedding model.
 */
export class OpperEmbeddingModel implements EmbeddingModelV4 {
  readonly specificationVersion: 'v4' = 'v4';

  constructor(private readonly model: EmbeddingModelV4) {}

  get provider(): string {
    return this.model.provider;
  }

  get modelId(): string {
    return this.model.modelId;
  }

  get maxEmbeddingsPerCall() {
    return this.model.maxEmbeddingsPerCall;
  }

  get supportsParallelCalls() {
    return this.model.supportsParallelCalls;
  }

  doEmbed(options: EmbeddingModelV4CallOptions) {
    return this.model.doEmbed(withOpperHeaders(options));
  }
}

function withOpperHeaders<
  T extends {
    headers?: Record<string, string | undefined>;
    providerOptions?: SharedV4ProviderOptions;
  },
>(options: T): T {
  if (options.providerOptions?.opper == null) {
    return options;
  }
  const { headers, providerOptions } = extractOpperHeaders(
    options.providerOptions,
  );
  return {
    ...options,
    headers: { ...options.headers, ...headers },
    providerOptions,
  };
}
