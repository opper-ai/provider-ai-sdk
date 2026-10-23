import type { LanguageModelV4Middleware } from '@ai-sdk/provider';
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils';

export interface OpperSpanOptions {
  /**
   * Name of the session span shown in the Opper platform.
   * Defaults to `'aisdk-session'`.
   */
  name?: string;

  /**
   * Opper API key. Defaults to the `OPPER_API_KEY` environment variable.
   */
  apiKey?: string;

  /**
   * Base URL of the Opper API. Defaults to `https://api.opper.ai`.
   */
  baseURL?: string;
}

/**
 * Handle returned by `opperSpan`. Call `end()` when the session is finished
 * to close the span in the Opper platform.
 */
export interface OpperSpanHandle {
  /** The span ID assigned by the Opper platform. */
  readonly spanId: Promise<string>;
  /** Closes the span, optionally setting a final output string. */
  end(output?: string): Promise<void>;
}

interface OpperSpanData {
  id: string;
  name: string;
  trace_id: string;
}

async function createSpan(
  name: string,
  baseURL: string,
  apiKey: string,
): Promise<OpperSpanData> {
  const res = await fetch(`${baseURL}/v3/spans`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, start_time: new Date().toISOString() }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create Opper span: ${res.status}`);
  }
  const json = (await res.json()) as { data: OpperSpanData };
  return json.data;
}

async function closeSpan(
  id: string,
  baseURL: string,
  apiKey: string,
  output?: string,
): Promise<void> {
  await fetch(`${baseURL}/v3/spans/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      end_time: new Date().toISOString(),
      ...(output !== undefined && { output }),
    }),
  });
}

/**
 * Creates an Opper session span and returns a language model middleware plus
 * a handle to close the span when the session ends.
 *
 * The middleware sends the span's ID as `X-Opper-Parent-Span-Id` on every
 * model call, so all calls are grouped under the same trace in Opper. The span
 * is created lazily on the first model call.
 *
 * @example
 * ```ts
 * import { wrapLanguageModel, generateText } from 'ai';
 * import { opper, opperSpan } from '@opperai/ai-sdk-provider';
 *
 * const { middleware, handle } = opperSpan({ name: 'support-chat' });
 *
 * const model = wrapLanguageModel({
 *   model: opper('claude-sonnet-4-6'),
 *   middleware,
 * });
 *
 * const { text } = await generateText({ model, prompt: 'Hello!' });
 * await generateText({ model, prompt: 'Follow-up...' });
 *
 * await handle.end(text);
 * ```
 */
export function opperSpan(options: OpperSpanOptions = {}): {
  middleware: LanguageModelV4Middleware;
  handle: OpperSpanHandle;
} {
  const spanName = options.name ?? 'aisdk-session';
  const baseURL =
    withoutTrailingSlash(options.baseURL) ?? 'https://api.opper.ai';
  const apiKey = loadApiKey({
    apiKey: options.apiKey,
    environmentVariableName: 'OPPER_API_KEY',
    description: 'Opper',
  });

  // Created on the first model call.
  let spanPromise: Promise<OpperSpanData> | null = null;

  function getSpan(): Promise<OpperSpanData> {
    if (!spanPromise) {
      spanPromise = createSpan(spanName, baseURL, apiKey);
    }
    return spanPromise;
  }

  const handle: OpperSpanHandle = {
    get spanId() {
      return getSpan().then(span => span.id);
    },
    async end(output?: string) {
      if (!spanPromise) return; // no model call was made, nothing to close
      const span = await spanPromise;
      await closeSpan(span.id, baseURL, apiKey, output);
    },
  };

  const middleware: LanguageModelV4Middleware = {
    specificationVersion: 'v4',
    transformParams: async ({ params }) => {
      const span = await getSpan();
      return {
        ...params,
        headers: {
          ...params.headers,
          'X-Opper-Parent-Span-Id': span.id,
        },
      };
    },
  };

  return { middleware, handle };
}
