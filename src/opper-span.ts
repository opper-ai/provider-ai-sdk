import type { LanguageModelV3Middleware, LanguageModelV3GenerateResult } from '@ai-sdk/provider';

export interface OpperSpanOptions {
  /**
   * Name for the session span shown in the Opper platform.
   * Defaults to 'aisdk-session'.
   */
  name?: string;

  /**
   * Opper API key. Defaults to the OPPER_API_KEY environment variable.
   */
  apiKey?: string;

  /**
   * Base URL for the Opper API. Defaults to https://api.opper.ai.
   */
  baseURL?: string;
}

/**
 * Handle returned by `opperSpan`. Call `.end()` when the session is finished
 * to close the span in the Opper platform.
 */
export interface OpperSpanHandle {
  /** The span ID assigned by the Opper platform. */
  readonly spanId: Promise<string>;
  /** Close the span, optionally setting a final output string. */
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
  if (!res.ok) throw new Error(`Failed to create Opper span: ${res.status}`);
  const json = await res.json() as { data: OpperSpanData };
  return json.data;
}

async function closeSpan(
  id: string,
  baseURL: string,
  apiKey: string,
  output?: string,
  error?: string,
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
      ...(error !== undefined && { error }),
    }),
  });
}

function resolveApiKey(apiKey?: string): string {
  if (apiKey) return apiKey;
  if (typeof process !== 'undefined' && process.env?.OPPER_API_KEY) {
    return process.env.OPPER_API_KEY;
  }
  throw new Error(
    'Opper API key is required for opperSpan. Pass apiKey or set OPPER_API_KEY.',
  );
}

/**
 * Creates an Opper session span and returns both an AI SDK language model
 * middleware and a handle to close the span when the session ends.
 *
 * The middleware injects the span's ID as `X-Opper-Parent-Span-Id` on every
 * model call, grouping them all under the same trace in the Opper platform.
 * The span is created lazily on the first model call.
 *
 * Call `handle.end()` when the session is finished (e.g. when a conversation
 * ends or a request completes).
 *
 * @example
 * ```ts
 * import { wrapLanguageModel, generateText } from 'ai';
 * import { opper, opperSpan } from '@opper/ai-sdk-provider';
 *
 * const { middleware, handle } = opperSpan({ name: 'aisdk-session' });
 *
 * const model = wrapLanguageModel({
 *   model: opper('openai/gpt-4o'),
 *   middleware,
 * });
 *
 * const { text } = await generateText({ model, prompt: 'Hello!' });
 * await generateText({ model, prompt: 'Follow-up...' });
 *
 * await handle.end(text); // close the session span with the final output
 * ```
 */
export function opperSpan(options: OpperSpanOptions = {}): {
  middleware: LanguageModelV3Middleware;
  handle: OpperSpanHandle;
} {
  const spanName = options.name ?? 'aisdk-session';
  const baseURL = (options.baseURL ?? 'https://api.opper.ai').replace(/\/$/, '');
  const apiKey = resolveApiKey(options.apiKey);

  // Lazily created — resolves on the first model call
  let spanPromise: Promise<OpperSpanData> | null = null;

  function getSpan(): Promise<OpperSpanData> {
    if (!spanPromise) {
      spanPromise = createSpan(spanName, baseURL, apiKey);
    }
    return spanPromise;
  }

  const handle: OpperSpanHandle = {
    get spanId() {
      return getSpan().then(s => s.id);
    },
    async end(output?: string) {
      if (!spanPromise) return; // never called, nothing to close
      const span = await spanPromise;
      await closeSpan(span.id, baseURL, apiKey, output);
    },
  };

  const middleware: LanguageModelV3Middleware = {
    specificationVersion: 'v3',

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

    wrapGenerate: async ({ doGenerate }) => {
      let result: LanguageModelV3GenerateResult;
      try {
        result = await doGenerate();
      } catch (err) {
        throw err;
      }
      return result;
    },

    wrapStream: async ({ doStream }) => {
      return doStream();
    },
  };

  return { middleware, handle };
}
