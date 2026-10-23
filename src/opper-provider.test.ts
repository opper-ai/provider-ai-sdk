import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createTestServer } from '@ai-sdk/test-server';
import { NoSuchModelError } from '@ai-sdk/provider';
import { embed, generateText, jsonSchema, streamText, tool } from 'ai';
import { createOpper } from './opper-provider.js';
import { VERSION } from './version.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const chatResponse = JSON.parse(
  readFileSync(join(import.meta.dirname, '__fixtures__/chat-response.json'), 'utf8'),
);
const toolCallResponse = JSON.parse(
  readFileSync(join(import.meta.dirname, '__fixtures__/tool-call-response.json'), 'utf8'),
);
const chatStreamChunks = readFileSync(
  join(import.meta.dirname, '__fixtures__/chat-stream.txt'),
  'utf8',
)
  .split('\n\n')
  .filter(Boolean)
  .map(chunk => chunk + '\n\n');

const embeddingResponse = {
  object: 'list',
  data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
  model: 'text-embedding-3-small',
  usage: { prompt_tokens: 4, total_tokens: 4 },
};

const CHAT_MODEL = 'claude-sonnet-4-6';
const EMBEDDING_MODEL = 'text-embedding-3-small';

// ── Test server ───────────────────────────────────────────────────────────────

const COMPLETIONS_URL = 'https://api.opper.ai/v3/compat/chat/completions';
const EMBEDDINGS_URL = 'https://api.opper.ai/v3/compat/embeddings';

const server = createTestServer({
  [COMPLETIONS_URL]: { response: undefined as any },
  [EMBEDDINGS_URL]: { response: undefined as any },
});

beforeAll(() => server.server.start());
afterEach(() => server.server.reset());
afterAll(() => server.server.stop());

function makeOpper(extraHeaders?: Record<string, string>) {
  return createOpper({ apiKey: 'test-key', headers: extraHeaders });
}

// ── Provider ──────────────────────────────────────────────────────────────────

describe('createOpper', () => {
  it('is an AI SDK v4 provider', () => {
    expect(makeOpper().specificationVersion).toBe('v4');
  });

  it('creates a callable provider that returns a v4 language model', () => {
    const model = makeOpper()(CHAT_MODEL);
    expect(model.specificationVersion).toBe('v4');
    expect(model.provider).toBe('opper.chat');
    expect(model.modelId).toBe(CHAT_MODEL);
  });

  it('exposes languageModel and chatModel as aliases', () => {
    const opper = makeOpper();
    expect(opper.languageModel(CHAT_MODEL).modelId).toBe(CHAT_MODEL);
    expect(opper.chatModel(CHAT_MODEL).modelId).toBe(CHAT_MODEL);
  });

  it('accepts a pinned provider/model id', () => {
    expect(makeOpper()('anthropic/claude-sonnet-4-6').modelId).toBe(
      'anthropic/claude-sonnet-4-6',
    );
  });

  it('exposes embeddingModel and the deprecated textEmbeddingModel alias', () => {
    const opper = makeOpper();
    const model = opper.embeddingModel(EMBEDDING_MODEL);
    expect(model.specificationVersion).toBe('v4');
    expect(model.provider).toBe('opper.embedding');
    expect(opper.textEmbeddingModel(EMBEDDING_MODEL).modelId).toBe(EMBEDDING_MODEL);
  });

  it('throws NoSuchModelError for image models', () => {
    expect(() => makeOpper().imageModel('any-model')).toThrow(NoSuchModelError);
  });
});

// ── API key loading ───────────────────────────────────────────────────────────

describe('API key', () => {
  it('reads OPPER_API_KEY from the environment when no apiKey is passed', async () => {
    const previous = process.env.OPPER_API_KEY;
    process.env.OPPER_API_KEY = 'env-key';
    try {
      server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
      await generateText({ model: createOpper()(CHAT_MODEL), prompt: 'Hi' });
      expect(server.calls[0].requestHeaders['authorization']).toBe('Bearer env-key');
    } finally {
      if (previous === undefined) delete process.env.OPPER_API_KEY;
      else process.env.OPPER_API_KEY = previous;
    }
  });

  it('prefers an explicit apiKey over the environment', async () => {
    const previous = process.env.OPPER_API_KEY;
    process.env.OPPER_API_KEY = 'env-key';
    try {
      server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
      await generateText({ model: makeOpper()(CHAT_MODEL), prompt: 'Hi' });
      expect(server.calls[0].requestHeaders['authorization']).toBe('Bearer test-key');
    } finally {
      if (previous === undefined) delete process.env.OPPER_API_KEY;
      else process.env.OPPER_API_KEY = previous;
    }
  });

  it('fails when no API key is available', async () => {
    const previous = process.env.OPPER_API_KEY;
    delete process.env.OPPER_API_KEY;
    try {
      server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
      await expect(
        generateText({ model: createOpper()(CHAT_MODEL), prompt: 'Hi' }),
      ).rejects.toThrow(/OPPER_API_KEY/);
    } finally {
      if (previous !== undefined) process.env.OPPER_API_KEY = previous;
    }
  });
});

// ── generateText ──────────────────────────────────────────────────────────────

describe('generateText', () => {
  it('returns text from a chat response', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    const { text } = await generateText({ model: makeOpper()(CHAT_MODEL), prompt: 'Hello' });
    expect(text).toBe('Hello! How can I help you today?');
  });

  it('calls /v3/compat/chat/completions with the bearer key', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({ model: makeOpper()(CHAT_MODEL), prompt: 'Hi' });
    expect(server.calls[0].requestUrl).toBe(COMPLETIONS_URL);
    expect(server.calls[0].requestHeaders['authorization']).toBe('Bearer test-key');
  });

  it('sends the model id unchanged in the request body', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({ model: makeOpper()('anthropic/claude-sonnet-4-6'), prompt: 'Hi' });
    const body = await server.calls[0].requestBodyJson;
    expect(body.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('adds the package version to the User-Agent', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({ model: makeOpper()(CHAT_MODEL), prompt: 'Hi' });
    expect(server.calls[0].requestUserAgent).toContain(`ai-sdk-opper/${VERSION}`);
  });

  it('forwards static custom headers', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({ model: makeOpper({ 'X-Custom': 'value' })(CHAT_MODEL), prompt: 'Hi' });
    expect(server.calls[0].requestHeaders['x-custom']).toBe('value');
  });

  it('accepts a custom baseURL and fetch', async () => {
    const requestedUrls: string[] = [];
    const opper = createOpper({
      apiKey: 'k',
      baseURL: 'https://gateway.example.com/v3/compat/',
      fetch: async (input, _init) => {
        requestedUrls.push(String(input));
        return new Response(JSON.stringify(chatResponse), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const { text } = await generateText({ model: opper(CHAT_MODEL), prompt: 'Hi' });
    expect(text).toBe('Hello! How can I help you today?');
    expect(requestedUrls).toEqual(['https://gateway.example.com/v3/compat/chat/completions']);
  });

  it('maps usage', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    const { usage } = await generateText({ model: makeOpper()(CHAT_MODEL), prompt: 'Hi' });
    expect(usage.inputTokens).toBe(12);
    expect(usage.outputTokens).toBe(9);
  });

  it('maps the finish reason', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    const { finishReason } = await generateText({ model: makeOpper()(CHAT_MODEL), prompt: 'Hi' });
    expect(finishReason).toBe('stop');
  });

  it('returns tool calls', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: toolCallResponse };
    const { toolCalls, finishReason } = await generateText({
      model: makeOpper()(CHAT_MODEL),
      prompt: 'Weather in SF?',
      tools: {
        get_weather: tool({
          description: 'Get weather',
          inputSchema: jsonSchema<{ location: string }>({
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          }),
        }),
      },
    });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolName).toBe('get_weather');
    expect(finishReason).toBe('tool-calls');
  });

  it('throws on a 401 response', async () => {
    server.urls[COMPLETIONS_URL].response = {
      type: 'error',
      status: 401,
      body: JSON.stringify({ error: { message: 'Invalid API key' } }),
    };
    await expect(
      generateText({ model: makeOpper()(CHAT_MODEL), prompt: 'Hi', maxRetries: 0 }),
    ).rejects.toThrow();
  });
});

// ── Per-call Opper options ────────────────────────────────────────────────────

describe('providerOptions.opper', () => {
  it('sends name as X-Opper-Name', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({
      model: makeOpper()(CHAT_MODEL),
      prompt: 'Hi',
      providerOptions: { opper: { name: 'my-function' } },
    });
    expect(server.calls[0].requestHeaders['x-opper-name']).toBe('my-function');
  });

  it('sends parentSpanId as X-Opper-Parent-Span-Id', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({
      model: makeOpper()(CHAT_MODEL),
      prompt: 'Hi',
      providerOptions: {
        opper: { parentSpanId: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90' },
      },
    });
    expect(server.calls[0].requestHeaders['x-opper-parent-span-id']).toBe(
      '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
    );
  });

  it('sends both headers on a streaming call', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'stream-chunks', chunks: chatStreamChunks };
    const result = streamText({
      model: makeOpper()(CHAT_MODEL),
      prompt: 'Hi',
      providerOptions: { opper: { name: 'fn', parentSpanId: 'span-1' } },
    });
    for await (const _ of result.textStream) {
    }
    expect(server.calls[0].requestHeaders['x-opper-name']).toBe('fn');
    expect(server.calls[0].requestHeaders['x-opper-parent-span-id']).toBe('span-1');
  });

  it('keeps the per-call headers next to call-level headers', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({
      model: makeOpper()(CHAT_MODEL),
      prompt: 'Hi',
      headers: { 'X-Request-Id': 'req-1' },
      providerOptions: { opper: { name: 'fn' } },
    });
    expect(server.calls[0].requestHeaders['x-request-id']).toBe('req-1');
    expect(server.calls[0].requestHeaders['x-opper-name']).toBe('fn');
  });

  it('sets no Opper headers when no Opper options are given', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({ model: makeOpper()(CHAT_MODEL), prompt: 'Hi' });
    expect(server.calls[0].requestHeaders['x-opper-name']).toBeUndefined();
    expect(server.calls[0].requestHeaders['x-opper-parent-span-id']).toBeUndefined();
  });

  it('does not send the Opper options in the request body', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({
      model: makeOpper()(CHAT_MODEL),
      prompt: 'Hi',
      providerOptions: { opper: { name: 'fn', parentSpanId: 'span-1' } },
    });
    const body = await server.calls[0].requestBodyJson;
    expect(body.name).toBeUndefined();
    expect(body.parentSpanId).toBeUndefined();
  });

  it('sends X-Opper-Name on embedding calls', async () => {
    server.urls[EMBEDDINGS_URL].response = { type: 'json-value', body: embeddingResponse };
    await embed({
      model: makeOpper().embeddingModel(EMBEDDING_MODEL),
      value: 'Hello',
      providerOptions: { opper: { name: 'embedder' } },
    });
    expect(server.calls[0].requestHeaders['x-opper-name']).toBe('embedder');
  });
});

// ── streamText ────────────────────────────────────────────────────────────────

describe('streamText', () => {
  it('streams text', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'stream-chunks', chunks: chatStreamChunks };
    const { textStream } = streamText({ model: makeOpper()(CHAT_MODEL), prompt: 'Hi' });
    const chunks: string[] = [];
    for await (const chunk of textStream) chunks.push(chunk);
    expect(chunks.join('')).toBe('Hello!');
  });

  it('reports usage after streaming', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'stream-chunks', chunks: chatStreamChunks };
    const result = streamText({ model: makeOpper()(CHAT_MODEL), prompt: 'Hi' });
    for await (const _ of result.textStream) {
    }
    const usage = await result.usage;
    expect(usage.inputTokens).toBe(12);
    expect(usage.outputTokens).toBe(2);
  });

  it('sets stream: true and asks for usage in the request body', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'stream-chunks', chunks: chatStreamChunks };
    const result = streamText({ model: makeOpper()(CHAT_MODEL), prompt: 'Hi' });
    for await (const _ of result.textStream) {
    }
    const body = await server.calls[0].requestBodyJson;
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});

// ── Embeddings ────────────────────────────────────────────────────────────────

describe('embeddings', () => {
  it('generates an embedding', async () => {
    server.urls[EMBEDDINGS_URL].response = { type: 'json-value', body: embeddingResponse };
    const { embedding } = await embed({
      model: makeOpper().embeddingModel(EMBEDDING_MODEL),
      value: 'Hello world',
    });
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('calls /v3/compat/embeddings with the model id', async () => {
    server.urls[EMBEDDINGS_URL].response = { type: 'json-value', body: embeddingResponse };
    await embed({ model: makeOpper().embeddingModel(EMBEDDING_MODEL), value: 'Hello' });
    expect(server.calls[0].requestUrl).toBe(EMBEDDINGS_URL);
    const body = await server.calls[0].requestBodyJson;
    expect(body.model).toBe(EMBEDDING_MODEL);
  });
});
