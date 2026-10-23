# @opperai/ai-sdk-provider

[AI SDK](https://ai-sdk.dev) provider for [Opper](https://opper.ai), the EU-hosted AI gateway: 700+ models from 50+ providers behind one OpenAI-compatible API, one key, no markup on provider rates.

Version 0.2 targets AI SDK 7 and Node.js 22 or later. For AI SDK 6, use version 0.1.

## Installation

```bash
npm install @opperai/ai-sdk-provider ai
```

## Setup

Create an API key at [platform.opper.ai](https://platform.opper.ai) and set it as `OPPER_API_KEY`. The default `opper` instance reads it from the environment:

```ts
import { opper } from '@opperai/ai-sdk-provider';
```

To configure the provider yourself, use `createOpper`:

```ts
import { createOpper } from '@opperai/ai-sdk-provider';

const opper = createOpper({
  apiKey: process.env.OPPER_API_KEY, // default: the OPPER_API_KEY environment variable
  baseURL: 'https://api.opper.ai/v3/compat', // default
  headers: {}, // extra headers on every request
});
```

## Models

Pass any model id from the [Opper catalogue](https://opper.ai/models). Bare pool names such as `claude-sonnet-4-6` or `gpt-5.4-mini` let Opper pick the route for each request. A `provider/model` id such as `anthropic/claude-sonnet-4-6` pins one route.

```ts
opper('claude-sonnet-4-6'); // pool: Opper picks the route
opper('gpt-5.4-mini'); // pool
opper('anthropic/claude-sonnet-4-6'); // pinned route
```

## Generate text

```ts
import { generateText } from 'ai';
import { opper } from '@opperai/ai-sdk-provider';

const { text } = await generateText({
  model: opper('claude-sonnet-4-6'),
  prompt: 'Write a haiku about the Baltic Sea.',
});
```

## Stream text

```ts
import { streamText } from 'ai';
import { opper } from '@opperai/ai-sdk-provider';

const result = streamText({
  model: opper('gpt-5.4-mini'),
  prompt: 'Explain vector databases in three sentences.',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

## Tool calling

```ts
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { opper } from '@opperai/ai-sdk-provider';

const { toolCalls } = await generateText({
  model: opper('claude-sonnet-4-6'),
  tools: {
    getWeather: tool({
      description: 'Get the current weather for a city',
      inputSchema: z.object({ city: z.string() }),
    }),
  },
  prompt: "What's the weather in Stockholm?",
});
```

## Embeddings

```ts
import { embed } from 'ai';
import { opper } from '@opperai/ai-sdk-provider';

const { embedding } = await embed({
  model: opper.embeddingModel('text-embedding-3-small'),
  value: 'Sunny day at the beach',
});
```

## Tracing

### Per call

Name a call, or attach it to a parent span, with `providerOptions.opper`. The options are sent as the `X-Opper-Name` and `X-Opper-Parent-Span-Id` headers:

```ts
import { generateText } from 'ai';
import { opper, type OpperCallOptions } from '@opperai/ai-sdk-provider';

await generateText({
  model: opper('claude-sonnet-4-6'),
  prompt: 'Summarise this document...',
  providerOptions: {
    opper: {
      name: 'document-summariser',
      parentSpanId: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
    } satisfies OpperCallOptions,
  },
});
```

### Per session with `opperSpan`

`opperSpan` creates one Opper span for a session and links every model call to it. Pass its middleware to `wrapLanguageModel`:

```ts
import { generateText, wrapLanguageModel } from 'ai';
import { opper, opperSpan } from '@opperai/ai-sdk-provider';

const { middleware, handle } = opperSpan({ name: 'support-chat' });

const model = wrapLanguageModel({
  model: opper('claude-sonnet-4-6'),
  middleware,
});

const { text } = await generateText({ model, prompt: 'Hello!' });
await generateText({ model, prompt: 'A follow-up question...' });

// Close the span when the session ends.
await handle.end(text);
```

The span is created on the first model call, and `handle.end()` does nothing if no call was made. The name defaults to `'aisdk-session'`. Read the span ID with `await handle.spanId`.

## Requirements

- Node.js 22 or later
- AI SDK 7 (`ai` 7.x)
- An Opper API key from [platform.opper.ai](https://platform.opper.ai)

## License

MIT
