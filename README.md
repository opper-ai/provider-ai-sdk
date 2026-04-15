# @opper/ai-sdk-provider

AI SDK provider for the Opper Task API. Use any model through a unified interface with the [Vercel AI SDK](https://sdk.vercel.ai/).

## Installation

```bash
npm install @opper/ai-sdk-provider ai
```

## Quick Start

```typescript
import { opper } from "@opper/ai-sdk-provider";
import { generateText } from "ai";

const result = await generateText({
  model: opper("default"),
  prompt: "What is the capital of France?",
});

console.log(result.text);
```

## Custom Configuration

Use `createTaskProvider()` for custom settings:

```typescript
import { createTaskProvider } from "@opper/ai-sdk-provider";

const opper = createTaskProvider({
  // Task API URL (default: http://localhost:8080)
  baseUrl: "http://localhost:8080",

  // Model preference hint: "fast" | "cheap" | "quality" | "balanced"
  prefer: "quality",

  // Request timeout in milliseconds (default: 120000)
  timeoutMs: 60000,
});
```

## Task Naming

Task names enable caching and state management on the Task API. You can specify a name at different levels with the following priority:

1. **Per-call** via `providerOptions` (highest priority)
2. **Per-model** via model options
3. **Per-provider** via provider options (lowest priority)

### Per-Model Name (Recommended)

Specify a name when creating the model:

```typescript
import { createTaskProvider } from "@opper/ai-sdk-provider";
import { generateText } from "ai";

const opper = createTaskProvider();

// Each task gets its own name for caching
const result = await generateText({
  model: opper("default", { name: "summarize-article" }),
  prompt: "Summarize this article...",
});
```

### Per-Call Name

Override the name for a specific call using `providerOptions`:

```typescript
const result = await generateText({
  model: opper("default"),
  providerOptions: {
    opper: { name: "translate-to-spanish" },
  },
  prompt: "Translate this to Spanish...",
});
```

### Multi-Agent Example

Different agents can have different names for proper caching:

```typescript
const opper = createTaskProvider();

// Each agent gets its own cached task
const plannerModel = opper("default", { name: "planner-agent" });
const coderModel = opper("default", { name: "coder-agent" });
const reviewerModel = opper("default", { name: "reviewer-agent" });
```

## Models

The `model` field accepts any string. The Task API resolves the model on the backend.

### Special Values

| Value | Description |
|-------|-------------|
| `"default"` | Let the Task API choose the best model |

### Provider/Model Format

Use the format `provider/model-name` to specify a particular model:

```typescript
// Anthropic models
opper("anthropic/claude-sonnet-4-5-20250514")
opper("anthropic/claude-opus-4-5-20251101")

// OpenAI models
opper("openai/gpt-4o")
opper("openai/gpt-4.1")

// Google models
opper("google/gemini-2.0-flash")
```

## Examples

### Basic Text Generation

```typescript
import { opper } from "@opper/ai-sdk-provider";
import { generateText } from "ai";

const result = await generateText({
  model: opper("default"),
  prompt: "Explain quantum computing in simple terms.",
});

console.log(result.text);
```

### Multi-turn Conversation

```typescript
import { opper } from "@opper/ai-sdk-provider";
import { generateText, CoreMessage } from "ai";

const messages: CoreMessage[] = [];

async function chat(userMessage: string) {
  messages.push({ role: "user", content: userMessage });

  const result = await generateText({
    model: opper("default"),
    system: "You are a helpful assistant.",
    messages,
  });

  messages.push({ role: "assistant", content: result.text });
  return result.text;
}

await chat("My name is Alice.");
await chat("What's my name?"); // Will remember "Alice"
```

### Tool Calling

```typescript
import { opper } from "@opper/ai-sdk-provider";
import { generateText, tool } from "ai";
import { z } from "zod";

const result = await generateText({
  model: opper("anthropic/claude-opus-4-5-20251101"),
  tools: {
    weather: tool({
      description: "Get the weather for a location",
      parameters: z.object({
        location: z.string().describe("City name"),
      }),
      execute: async ({ location }) => {
        return `Weather in ${location}: 72°F, sunny`;
      },
    }),
  },
  maxSteps: 5,
  prompt: "What's the weather in San Francisco?",
});

console.log(result.text);
```

### Streaming

```typescript
import { opper } from "@opper/ai-sdk-provider";
import { streamText } from "ai";

const result = streamText({
  model: opper("default"),
  prompt: "Write a short story about a robot.",
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

### Structured Output

```typescript
import { opper } from "@opper/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";

const result = await generateText({
  model: opper("default"),
  output: Output.object({
    schema: z.object({
      name: z.string(),
      age: z.number(),
    }),
  }),
  prompt: "Generate a person named Alice who is 30 years old.",
});

console.log(result.output); // { name: "Alice", age: 30 }
```

### Image Generation

```typescript
import { opper } from "@opper/ai-sdk-provider";
import { generateImage } from "ai";

const result = await generateImage({
  model: opper.image("default"),
  prompt: "A sunset over mountains",
  size: "1024x1024",
});

// result.image.base64 contains the image data
```

### Text-to-Speech

```typescript
import { opper } from "@opper/ai-sdk-provider";
import { experimental_generateSpeech as generateSpeech } from "ai";

const result = await generateSpeech({
  model: opper.speech("default"),
  text: "Hello, world!",
  voice: "alloy",
});

// result.audio contains the audio data
```

### Audio Transcription

```typescript
import { opper } from "@opper/ai-sdk-provider";
import { experimental_transcribe as transcribe } from "ai";
import { readFileSync } from "fs";

const audioData = readFileSync("recording.mp3");

const result = await transcribe({
  model: opper.transcription("default"),
  audio: audioData,
  mediaType: "audio/mpeg",
});

console.log(result.text);
```

## What's Built

This SDK implements the AI SDK provider specifications and provides:

- **`createTaskProvider()`** - Factory function to create a Task API provider
- **`opper`** - Default provider instance ready to use
- **Full AI SDK compatibility** - Works with `generateText`, `streamText`, `generateImage`, `generateSpeech`, `transcribe`
- **Model routing** - Use `"default"` for automatic model selection or specify a model directly
- **Preference hints** - Guide model selection with `prefer: "fast" | "cheap" | "quality" | "balanced"`

### Supported Features

| Feature | Status |
|---------|--------|
| Text generation | Supported |
| Streaming | Supported |
| Structured output | Supported |
| Tool calling | Supported |
| Multi-turn conversations | Supported |
| Image generation | Supported |
| Text-to-speech | Supported |
| Audio transcription | Supported |
| System prompts | Supported |
| Temperature control | Supported |
| Max tokens | Supported |

## Running Examples

```bash
cd sdk/ai-sdk-provider

# Build the provider
npm run build

# Run conversational agent (interactive)
npx tsx examples/conversational-agent.ts

# Run conversational agent (demo mode)
npx tsx examples/conversational-agent.ts --demo

# Run tool agent
npx tsx examples/tool-agent.ts "list all files in the current directory"

# Run multi-agent (structured output)
npx tsx examples/multi-agent.ts "write a function to validate emails"

# Generate an image
npx tsx examples/image-generation.ts "a futuristic city at night"

# Text-to-speech
npx tsx examples/text-to-speech.ts "Hello, world!"

# Transcribe audio
npx tsx examples/transcription.ts recording.mp3
```

## Chatbot Example

The `chatbot-example/` directory contains a Next.js chat application demonstrating the provider. It's a standard AI SDK chatbot with minimal customizations—the main integration point is swapping in `opper(model)` instead of `openai(model)`.

```bash
cd chatbot-example
npm install
npm run dev
# Open http://localhost:3001
```

**What's customized:**
- Uses `@opper/ai-sdk-provider` instead of a built-in provider
- Adds multimodal tools (image generation, speech, transcription)
- Model selector dropdown

**Standard AI SDK patterns used:**
- `useChat` hook from `@ai-sdk/react`
- `streamText`, `tool`, `generateImage`, `generateSpeech`, `transcribe`
- `DefaultChatTransport` for client-server communication

See `chatbot-example/README.md` for details.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TASK_API_URL` | Task API base URL | `http://localhost:8080` |
| `MODEL` | Model to use (tool-agent example) | `anthropic/claude-opus-4-5-20251101` |

## API Reference

### `opper`

Default provider instance with all model types:

```typescript
import { opper } from "@opper/ai-sdk-provider";

// Language models (text generation)
opper("default")                              // Let Task API choose
opper("anthropic/claude-sonnet-4-5-20250514") // Specific model
opper("default", { name: "my-task" })         // With task name for caching

// Image generation
opper.image("default")
opper.image("openai/dall-e-3")
opper.image("default", { name: "avatar-generator" })

// Text-to-speech
opper.speech("default")
opper.speech("openai/tts-1")
opper.speech("default", { name: "narrator" })

// Audio transcription
opper.transcription("default")
opper.transcription("openai/whisper-1")
opper.transcription("default", { name: "meeting-transcriber" })
```

### `createTaskProvider(options?)`

Factory function for custom configuration.

**Options:**
- `baseUrl?: string` - Task API URL (default: `http://localhost:8080`)
- `prefer?: "fast" | "cheap" | "quality" | "balanced"` - Model preference hint
- `timeoutMs?: number` - Request timeout in milliseconds (default: `120000`)
- `name?: string` - Default task name for caching (can be overridden per-model or per-call)

**Returns:** `TaskProvider` - A provider with the following methods:
- `(modelId, options?)` / `languageModel(modelId, options?)` - Create a language model
- `image(modelId, options?)` / `imageModel(modelId, options?)` - Create an image model
- `speech(modelId, options?)` / `speechModel(modelId, options?)` - Create a speech model
- `transcription(modelId, options?)` / `transcriptionModel(modelId, options?)` - Create a transcription model

**Model Options:**
- `name?: string` - Task name for caching (overrides provider-level name)

## Publishing to npm

This provider follows the [AI SDK Custom Provider](https://ai-sdk.dev/providers/community-providers/custom-providers) guidelines.

### Package Structure

```
@opper/ai-sdk-provider
├── src/
│   ├── index.ts              # Main exports
│   ├── task-provider.ts      # Provider factory
│   ├── task-language-model.ts    # LanguageModelV3 implementation
│   ├── task-image-model.ts       # ImageModelV2 implementation
│   ├── task-speech-model.ts      # SpeechModelV3 implementation
│   ├── task-transcription-model.ts # TranscriptionModelV3 implementation
│   └── types.ts              # Shared types
└── package.json
```

### Publishing

```bash
npm publish --access public
```

### Community Provider Listing

To get listed on the [AI SDK Community Providers](https://ai-sdk.dev/providers/community-providers) page:

1. Publish the package to npm
2. Submit a PR to the [AI SDK repository](https://github.com/vercel/ai) adding documentation
3. Use the [OpenRouter provider docs](https://ai-sdk.dev/providers/community-providers/openrouter) as a template

### References

- [AI SDK Custom Provider Guide](https://ai-sdk.dev/providers/community-providers/custom-providers)
- [Language Model Specification V3](https://ai-sdk.dev/docs/reference/ai-sdk-core/custom-provider)
- [Mistral Provider](https://github.com/vercel/ai/tree/main/packages/mistral) - Reference implementation

## License

MIT
