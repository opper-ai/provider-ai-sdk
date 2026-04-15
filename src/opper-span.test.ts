import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createTestServer } from '@ai-sdk/test-server';
import { wrapLanguageModel, generateText, streamText } from 'ai';
import { createOpper, opperSpan } from './index.js';

const chatResponse = JSON.parse(
  readFileSync(join(import.meta.dirname, '__fixtures__/chat-response.json'), 'utf8'),
);
const chatStreamChunks = readFileSync(
  join(import.meta.dirname, '__fixtures__/chat-stream.txt'),
  'utf8',
)
  .split('\n\n')
  .filter(Boolean)
  .map(chunk => chunk + '\n\n');

const COMPLETIONS_URL = 'https://api.opper.ai/v3/compat/chat/completions';
const SPANS_URL = 'https://api.opper.ai/v3/spans';
const SPAN_URL = 'https://api.opper.ai/v3/spans/span-abc123';

const spanCreatedResponse = {
  data: { id: 'span-abc123', name: 'aisdk-session', trace_id: 'trace-xyz' },
};

const server = createTestServer({
  [COMPLETIONS_URL]: { response: undefined as any },
  [SPANS_URL]: { response: undefined as any },
  [SPAN_URL]: { response: undefined as any },
});

beforeAll(() => server.server.start());
afterEach(() => server.server.reset());
afterAll(() => server.server.stop());

function setup(name?: string) {
  const opper = createOpper({ apiKey: 'test-key' });
  const { middleware, handle } = opperSpan({ name, apiKey: 'test-key' });
  const model = wrapLanguageModel({ model: opper('openai/gpt-4o'), middleware });
  return { model, handle };
}

describe('opperSpan', () => {
  it('creates a span on the first call', async () => {
    server.urls[SPANS_URL].response = { type: 'json-value', body: spanCreatedResponse };
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };

    const { model } = setup();
    await generateText({ model, prompt: 'Hi' });

    const spanCall = server.calls.find(
      c => c.requestUrl.endsWith('/v3/spans') && c.requestMethod === 'POST',
    );
    expect(spanCall).toBeDefined();
    const body = await spanCall!.requestBodyJson;
    expect(body.name).toBe('aisdk-session');
    expect(body.start_time).toBeDefined();
  });

  it('defaults span name to aisdk-session', async () => {
    server.urls[SPANS_URL].response = { type: 'json-value', body: spanCreatedResponse };
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };

    const { model } = setup(); // no name arg
    await generateText({ model, prompt: 'Hi' });

    const spanCall = server.calls.find(
      c => c.requestUrl.endsWith('/v3/spans') && c.requestMethod === 'POST',
    );
    const body = await spanCall!.requestBodyJson;
    expect(body.name).toBe('aisdk-session');
  });

  it('injects X-Opper-Parent-Span-Id on every model call', async () => {
    server.urls[SPANS_URL].response = { type: 'json-value', body: spanCreatedResponse };
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };

    const { model } = setup();
    await generateText({ model, prompt: 'Hi' });

    const completionCall = server.calls.find(c => c.requestUrl.includes('/chat/completions'));
    expect(completionCall!.requestHeaders['x-opper-parent-span-id']).toBe('span-abc123');
  });

  it('reuses the same span for multiple calls', async () => {
    server.urls[SPANS_URL].response = { type: 'json-value', body: spanCreatedResponse };
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };

    const { model } = setup();
    await generateText({ model, prompt: 'First' });
    await generateText({ model, prompt: 'Second' });

    const spanCreates = server.calls.filter(
      c => c.requestUrl.endsWith('/v3/spans') && c.requestMethod === 'POST',
    );
    expect(spanCreates).toHaveLength(1);

    // Both model calls carry the same span ID
    const completionCalls = server.calls.filter(c => c.requestUrl.includes('/chat/completions'));
    for (const call of completionCalls) {
      expect(call.requestHeaders['x-opper-parent-span-id']).toBe('span-abc123');
    }
  });

  it('closes the span with output on handle.end()', async () => {
    server.urls[SPANS_URL].response = { type: 'json-value', body: spanCreatedResponse };
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };
    server.urls[SPAN_URL].response = { type: 'empty' };

    const { model, handle } = setup();
    const { text } = await generateText({ model, prompt: 'Hi' });
    await handle.end(text);

    const patchCall = server.calls.find(
      c => c.requestUrl.includes('/v3/spans/span-abc123') && c.requestMethod === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const body = await patchCall!.requestBodyJson;
    expect(body.end_time).toBeDefined();
    expect(body.output).toBe('Hello! How can I help you today?');
  });

  it('handle.end() is a no-op if no calls were made', async () => {
    const { handle } = setup();
    // Should not throw or make any requests
    await handle.end();
    const spanCalls = server.calls.filter(c => c.requestUrl.includes('/v3/spans'));
    expect(spanCalls).toHaveLength(0);
  });

  it('works with streaming', async () => {
    server.urls[SPANS_URL].response = { type: 'json-value', body: spanCreatedResponse };
    server.urls[COMPLETIONS_URL].response = { type: 'stream-chunks', chunks: chatStreamChunks };

    const { model } = setup();
    const result = streamText({ model, prompt: 'Hi' });
    for await (const _ of result.textStream) {}

    const completionCall = server.calls.find(c => c.requestUrl.includes('/chat/completions'));
    expect(completionCall!.requestHeaders['x-opper-parent-span-id']).toBe('span-abc123');
  });

  it('exposes the span ID via handle.spanId', async () => {
    server.urls[SPANS_URL].response = { type: 'json-value', body: spanCreatedResponse };
    server.urls[COMPLETIONS_URL].response = { type: 'json-value', body: chatResponse };

    const { model, handle } = setup();
    await generateText({ model, prompt: 'Hi' });

    expect(await handle.spanId).toBe('span-abc123');
  });
});
