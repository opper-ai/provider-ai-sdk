# @opperai/ai-sdk-provider

[Vercel AI SDK](https://sdk.vercel.ai/) provider for [Opper](https://opper.ai) — run any model through a single API key with built-in tracing and guardrails.

## Installation

```bash
npm install @opperai/ai-sdk-provider ai
```

## Quick start

```ts
import { opper } from '@opperai/ai-sdk-provider';
import { generateText } from 'ai';

const { text } = await generateText({
  model: opper('openai/gpt-4o'),
  prompt: 'Hello!',
});
```

Set your API key via the `OPPER_API_KEY` environment variable, or pass it explicitly (see below).

## Provider setup

```ts
import { createOpper } from '@opperai/ai-sdk-provider';

const opper = createOpper({
  apiKey: process.env.OPPER_API_KEY, // default: OPPER_API_KEY env var
  baseURL: 'https://api.opper.ai/v3/compat', // default
});
```

## Models

Pass any Opper model string — the provider routes it to the right backend:

```ts
opper('openai/gpt-4o')
opper('anthropic/claude-sonnet-4-5')
opper('google/gemini-2.0-flash')
opper('default') // your configured default model
```

## Streaming

```ts
import { streamText } from 'ai';

const { textStream } = streamText({
  model: opper('openai/gpt-4o'),
  prompt: 'Write a haiku about TypeScript.',
});

for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
```

## Tool calling

```ts
import { generateText, tool } from 'ai';
import { z } from 'zod';

const { toolCalls } = await generateText({
  model: opper('openai/gpt-4o'),
  tools: {
    getWeather: tool({
      description: 'Get current weather',
      parameters: z.object({ location: z.string() }),
      execute: async ({ location }) => ({ temperature: 22, unit: 'celsius' }),
    }),
  },
  prompt: "What's the weather in Stockholm?",
});
```

## Embeddings

```ts
import { embed } from 'ai';

const { embedding } = await embed({
  model: opper.embeddingModel('openai/text-embedding-3-small'),
  value: 'Hello world',
});
```

## Opper-specific options

Pass per-call Opper options via `providerOptions.opper`:

### Session tracing with `opperSpan`

`opperSpan` creates an Opper span that groups all model calls in a session
under the same trace. Pass it to `wrapLanguageModel` once and every call
is automatically linked — no need to pass span IDs manually.

```ts
import { wrapLanguageModel, generateText, streamText } from 'ai';
import { opper, opperSpan } from '@opperai/ai-sdk-provider';

const { middleware, handle } = opperSpan({ name: 'my-chat-session' });

const model = wrapLanguageModel({
  model: opper('openai/gpt-4o'),
  middleware,
});

// Every call is linked to the same session span in Opper
const { text } = await generateText({ model, prompt: 'Hello!' });
await generateText({ model, prompt: 'Follow-up question...' });

// Close the span when the session ends (e.g. conversation over, request done)
await handle.end(text);
```

The span is created lazily on the first model call. `handle.end()` is a
no-op if no calls were made. The span name defaults to `'aisdk-session'`
if not specified.

You can also read the span ID if you need it elsewhere:

```ts
const spanId = await handle.spanId; // e.g. 'span_032ZZczKjASAvGMnE5sdnd'
```

### Per-call tracing

To attach a name or parent span to individual calls without a session wrapper:

```ts
await generateText({
  model: opper('openai/gpt-4o'),
  prompt: 'Summarise this document...',
  providerOptions: {
    opper: {
      name: 'document-summariser',
      parentSpanId: 'uuid-of-parent-span',
    },
  },
});
```

### Guardrails

Apply input/output safety checks:

```ts
await generateText({
  model: opper('openai/gpt-4o'),
  prompt: userMessage,
  providerOptions: {
    opper: {
      guardInput: 'pii,secrets',   // comma-separated checks
      guardOutput: 'toxicity',
      guardAction: 'block',        // 'flag' | 'block' | 'redact' (default: 'flag')
    },
  },
});
```

For TypeScript autocomplete on these options, import the `OpperCallOptions` type:

```ts
import type { OpperCallOptions } from '@opperai/ai-sdk-provider';

const opperOptions: OpperCallOptions = {
  name: 'my-function',
  guardInput: 'pii',
};
```

## Requirements

- Node.js 18+
- An Opper API key — [sign up at opper.ai](https://opper.ai)

## License

MIT
