import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createTestServer } from '@ai-sdk/test-server';
import { generateText, streamText, embed } from 'ai';
import { createOpper } from './opper-provider.js';

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
  model: 'openai/text-embedding-3-small',
  usage: { prompt_tokens: 4, total_tokens: 4 },
};

// ── Test servers ──────────────────────────────────────────────────────────────

const COMPLETIONS_URL = 'https://api.opper.ai/v3/compat/chat/completions';
const EMBEDDINGS_URL = 'https://api.opper.ai/v3/compat/embeddings';

const server = createTestServer({
  [COMPLETIONS_URL]: { response: undefined as any },
  [EMBEDDINGS_URL]: { response: undefined as any },
});

beforeAll(() => server.server.start());
afterEach(() => server.server.reset());
afterAll(() => server.server.stop());

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOpper(extraHeaders?: Record<string, string>) {
  return createOpper({ apiKey: 'test-key', headers: extraHeaders });
}

// ── Provider instantiation ────────────────────────────────────────────────────

describe('createOpper', () => {
  it('creates a callable provider that returns a language model', () => {
    const opper = makeOpper();
    const model = opper('openai/gpt-4o');
    expect(model).toBeDefined();
    expect(model.provider).toBe('opper.chat');
    expect(model.modelId).toBe('openai/gpt-4o');
  });

  it('exposes languageModel and chatModel as aliases', () => {
    const opper = makeOpper();
    expect(opper.languageModel('openai/gpt-4o').modelId).toBe('openai/gpt-4o');
    expect(opper.chatModel('openai/gpt-4o').modelId).toBe('openai/gpt-4o');
  });

  it('accepts a custom baseURL', () => {
    const opper = createOpper({ apiKey: 'k', baseURL: 'https://custom.example.com/v1' });
    expect(opper('openai/gpt-4o')).toBeDefined();
  });

  it('exposes embeddingModel', () => {
    const opper = makeOpper();
    const model = opper.embeddingModel('openai/text-embedding-3-small');
    expect(model).toBeDefined();
    expect(model.provider).toBe('opper.embedding');
  });
});

// ── generateText ──────────────────────────────────────────────────────────────

describe('generateText', () => {
  it('returns text from a basic chat response', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    const { text } = await generateText({ model: makeOpper()('openai/gpt-4o'), prompt: 'Hello' });
    expect(text).toBe('Hello! How can I help you today?');
  });

  it('sends the correct Authorization header', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({ model: makeOpper()('openai/gpt-4o'), prompt: 'Hi' });
    expect(server.calls[0].requestHeaders['authorization']).toBe('Bearer test-key');
  });

  it('sends the model ID in the request body', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({ model: makeOpper()('openai/gpt-4o'), prompt: 'Hi' });
    const body = await server.calls[0].requestBodyJson;
    expect(body.model).toBe('openai/gpt-4o');
  });

  it('forwards static custom headers', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({
      model: makeOpper({ 'X-Custom': 'value' })('openai/gpt-4o'),
      prompt: 'Hi',
    });
    expect(server.calls[0].requestHeaders['x-custom']).toBe('value');
  });

  it('maps usage correctly', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    const { usage } = await generateText({ model: makeOpper()('openai/gpt-4o'), prompt: 'Hi' });
    expect(usage.inputTokens).toBe(12);
    expect(usage.outputTokens).toBe(9);
  });

  it('maps finish reason correctly', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    const { finishReason } = await generateText({ model: makeOpper()('openai/gpt-4o'), prompt: 'Hi' });
    expect(finishReason).toBe('stop');
  });

  it('returns tool calls from a tool-call response', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: toolCallResponse };
    const { toolCalls, finishReason } = await generateText({
      model: makeOpper()('openai/gpt-4o'),
      prompt: 'Weather in SF?',
      tools: {
        get_weather: {
          description: 'Get weather',
          parameters: { type: 'object' as const, properties: { location: { type: 'string' } } },
        },
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
      generateText({ model: makeOpper()('openai/gpt-4o'), prompt: 'Hi' }),
    ).rejects.toThrow();
  });
});

// ── Opper-specific headers ────────────────────────────────────────────────────

describe('providerOptions.opper headers', () => {
  it('sets X-Opper-Name', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({
      model: makeOpper()('openai/gpt-4o'),
      prompt: 'Hi',
      providerOptions: { opper: { name: 'my-function' } },
    });
    expect(server.calls[0].requestHeaders['x-opper-name']).toBe('my-function');
  });

  it('sets X-Opper-Parent-Span-Id', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({
      model: makeOpper()('openai/gpt-4o'),
      prompt: 'Hi',
      providerOptions: { opper: { parentSpanId: 'abc-123' } },
    });
    expect(server.calls[0].requestHeaders['x-opper-parent-span-id']).toBe('abc-123');
  });

  it('sets X-Opper-Guard-Input and X-Opper-Guard-Output', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({
      model: makeOpper()('openai/gpt-4o'),
      prompt: 'Hi',
      providerOptions: { opper: { guardInput: 'pii,secrets', guardOutput: 'toxicity' } },
    });
    expect(server.calls[0].requestHeaders['x-opper-guard-input']).toBe('pii,secrets');
    expect(server.calls[0].requestHeaders['x-opper-guard-output']).toBe('toxicity');
  });

  it('sets X-Opper-Guard-Action', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({
      model: makeOpper()('openai/gpt-4o'),
      prompt: 'Hi',
      providerOptions: { opper: { guardAction: 'block' } },
    });
    expect(server.calls[0].requestHeaders['x-opper-guard-action']).toBe('block');
  });

  it('does not set Opper headers when no providerOptions given', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({ model: makeOpper()('openai/gpt-4o'), prompt: 'Hi' });
    expect(server.calls[0].requestHeaders['x-opper-name']).toBeUndefined();
    expect(server.calls[0].requestHeaders['x-opper-guard-input']).toBeUndefined();
  });

  it('does not leak Opper fields into the request body', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    await generateText({
      model: makeOpper()('openai/gpt-4o'),
      prompt: 'Hi',
      providerOptions: { opper: { name: 'fn', guardInput: 'pii' } },
    });
    const body = await server.calls[0].requestBodyJson;
    expect(body.name).toBeUndefined();
    expect(body.guardInput).toBeUndefined();
    expect(body.__opper__).toBeUndefined();
  });
});

// ── streamText ────────────────────────────────────────────────────────────────

describe('streamText', () => {
  it('streams text correctly', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'stream-chunks', chunks: chatStreamChunks };
    const { textStream } = streamText({ model: makeOpper()('openai/gpt-4o'), prompt: 'Hi' });
    const chunks: string[] = [];
    for await (const chunk of textStream) chunks.push(chunk);
    expect(chunks.join('')).toBe('Hello!');
  });

  it('reports usage after streaming', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'stream-chunks', chunks: chatStreamChunks };
    const result = streamText({ model: makeOpper()('openai/gpt-4o'), prompt: 'Hi' });
    for await (const _ of result.textStream) {}
    const usage = await result.usage;
    expect(usage.inputTokens).toBe(12);
    expect(usage.outputTokens).toBe(2);
  });

  it('sets stream: true in the request body', async () => {
    server.urls[COMPLETIONS_URL].response = { type: 'stream-chunks', chunks: chatStreamChunks };
    const result = streamText({ model: makeOpper()('openai/gpt-4o'), prompt: 'Hi' });
    for await (const _ of result.textStream) {}
    const body = await server.calls[0].requestBodyJson;
    expect(body.stream).toBe(true);
  });
});

// ── embeddings ────────────────────────────────────────────────────────────────

describe('embeddings', () => {
  it('generates an embedding', async () => {
    server.urls[EMBEDDINGS_URL].response = { type: 'json-value', body: embeddingResponse };
    const { embedding } = await embed({
      model: makeOpper().embeddingModel('openai/text-embedding-3-small'),
      value: 'Hello world',
    });
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('sends the correct model in the request body', async () => {
    server.urls[EMBEDDINGS_URL].response = { type: 'json-value', body: embeddingResponse };
    await embed({
      model: makeOpper().embeddingModel('openai/text-embedding-3-small'),
      value: 'Hello',
    });
    const body = await server.calls[0].requestBodyJson;
    expect(body.model).toBe('openai/text-embedding-3-small');
  });
});
