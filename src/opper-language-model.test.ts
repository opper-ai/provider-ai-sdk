import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createTestServer } from "@ai-sdk/test-server";
import { OpperLanguageModel } from "./opper-language-model.js";

const TEST_URL = "https://api.opper.ai/v3/compat/chat/completions";

const textResponse = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "__fixtures__/opper-text.json"),
    "utf8"
  )
);
const toolCallResponse = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "__fixtures__/opper-tool-call.json"),
    "utf8"
  )
);

function chunksFromFixture(name: string): string[] {
  const raw = readFileSync(
    join(import.meta.dirname, `__fixtures__/${name}.chunks.txt`),
    "utf8"
  );
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => `data: ${line}\n\n`);
}

const textChunks = chunksFromFixture("opper-text");
const toolChunks = chunksFromFixture("opper-tool-call");

// ── Helpers ────────────────────────────────────────────────────────────────

function makeModel(fetch?: typeof globalThis.fetch) {
  return new OpperLanguageModel("anthropic/claude-haiku-4-5", {
    provider: "opper.language",
    baseURL: "https://api.opper.ai/v3/compat",
    headers: () => ({ Authorization: "Bearer test-key" }),
    fetch,
  });
}

async function collectStream(
  model: OpperLanguageModel,
  options: Parameters<OpperLanguageModel["doStream"]>[0]
) {
  const { stream } = await model.doStream(options);
  const parts: unknown[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return parts;
}

// ── Server setup ──────────────────────────────────────────────────────────

const server = createTestServer({
  [TEST_URL]: { response: undefined as any },
});

beforeAll(() => server.server.start());
afterEach(() => server.server.reset());
afterAll(() => server.server.stop());

// ── doGenerate ─────────────────────────────────────────────────────────────

describe("OpperLanguageModel.doGenerate", () => {
  it("returns text content from a simple response", async () => {
    server.urls[TEST_URL].response = {
      type: "json-value",
      body: textResponse,
    };

    const result = await makeModel().doGenerate({
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    });

    const text = result.content.find((c) => c.type === "text");
    expect(text).toBeDefined();
    expect((text as any).text).toBe("Hello! How can I help you today?");
  });

  it("maps finish reason and usage correctly", async () => {
    server.urls[TEST_URL].response = { type: "json-value", body: textResponse };

    const result = await makeModel().doGenerate({
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    expect(result.finishReason.unified).toBe("stop");
    expect(result.usage.inputTokens.total).toBe(12);
    expect(result.usage.outputTokens.total).toBe(9);
  });

  it("populates response metadata", async () => {
    server.urls[TEST_URL].response = { type: "json-value", body: textResponse };

    const result = await makeModel().doGenerate({
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    expect(result.response.id).toBe("chatcmpl-test123");
    expect(result.response.modelId).toBe("anthropic/claude-haiku-4-5");
  });

  it("returns tool-call content for tool-call responses", async () => {
    server.urls[TEST_URL].response = {
      type: "json-value",
      body: toolCallResponse,
    };

    const result = await makeModel().doGenerate({
      inputFormat: "prompt",
      mode: {
        type: "regular",
        tools: [
          {
            type: "function",
            name: "get_weather",
            description: "Get weather",
            inputSchema: {
              type: "object",
              properties: { location: { type: "string" } },
            },
          },
        ],
      },
      prompt: [{ role: "user", content: [{ type: "text", text: "Weather?" }] }],
    });

    const tc = result.content.find((c) => c.type === "tool-call");
    expect(tc).toBeDefined();
    expect((tc as any).toolName).toBe("get_weather");
    expect((tc as any).toolCallId).toBe("call_abc123");
    expect(result.finishReason.unified).toBe("tool-calls");
  });

  it("sends the correct Authorization header", async () => {
    server.urls[TEST_URL].response = { type: "json-value", body: textResponse };

    await makeModel().doGenerate({
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    expect(server.calls[0].requestHeaders["authorization"]).toBe(
      "Bearer test-key"
    );
  });

  it("sends model in the request body", async () => {
    server.urls[TEST_URL].response = { type: "json-value", body: textResponse };

    await makeModel().doGenerate({
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    const body = await server.calls[0].requestBodyJson;
    expect(body.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("passes temperature, topP, maxOutputTokens to the request", async () => {
    server.urls[TEST_URL].response = { type: "json-value", body: textResponse };

    await makeModel().doGenerate({
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      temperature: 0.5,
      topP: 0.9,
      maxOutputTokens: 100,
    });

    const body = await server.calls[0].requestBodyJson;
    expect(body.temperature).toBe(0.5);
    expect(body.top_p).toBe(0.9);
    expect(body.max_tokens).toBe(100);
  });

  it("warns about unsupported topK", async () => {
    server.urls[TEST_URL].response = { type: "json-value", body: textResponse };

    const result = await makeModel().doGenerate({
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      topK: 40,
    });

    expect(result.warnings.some((w) => w.type === "unsupported" && (w as any).feature === "topK")).toBe(true);
  });

  it("throws on non-2xx response", async () => {
    server.urls[TEST_URL].response = {
      type: "error",
      status: 401,
      body: JSON.stringify({ error: { message: "Invalid API key" } }),
    };

    await expect(
      makeModel().doGenerate({
        inputFormat: "prompt",
        mode: { type: "regular" },
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      })
    ).rejects.toThrow();
  });
});

// ── doStream ───────────────────────────────────────────────────────────────

describe("OpperLanguageModel.doStream", () => {
  it("emits stream-start, text parts, and finish for a text response", async () => {
    server.urls[TEST_URL].response = {
      type: "stream-chunks",
      chunks: [...textChunks, "data: [DONE]\n\n"],
    };

    const parts = await collectStream(makeModel(), {
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    const types = parts.map((p: any) => p.type);
    expect(types).toContain("stream-start");
    expect(types).toContain("text-delta");
    expect(types).toContain("finish");
  });

  it("assembles streamed text correctly", async () => {
    server.urls[TEST_URL].response = {
      type: "stream-chunks",
      chunks: [...textChunks, "data: [DONE]\n\n"],
    };

    const parts = await collectStream(makeModel(), {
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    const deltas = parts
      .filter((p: any) => p.type === "text-delta")
      .map((p: any) => p.delta)
      .join("");

    expect(deltas).toBe("Hello!");
  });

  it("emits finish with correct reason and usage from stream", async () => {
    server.urls[TEST_URL].response = {
      type: "stream-chunks",
      chunks: [...textChunks, "data: [DONE]\n\n"],
    };

    const parts = await collectStream(makeModel(), {
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    const finish = parts.find((p: any) => p.type === "finish") as any;
    expect(finish).toBeDefined();
    expect(finish.finishReason.unified).toBe("stop");
    expect(finish.usage.inputTokens.total).toBe(12);
    expect(finish.usage.outputTokens.total).toBe(2);
  });

  it("emits response-metadata with id and modelId on first chunk", async () => {
    server.urls[TEST_URL].response = {
      type: "stream-chunks",
      chunks: [...textChunks, "data: [DONE]\n\n"],
    };

    const parts = await collectStream(makeModel(), {
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    const meta = parts.find((p: any) => p.type === "response-metadata") as any;
    expect(meta).toBeDefined();
    expect(meta.id).toBe("chatcmpl-stream1");
    expect(meta.modelId).toBe("anthropic/claude-haiku-4-5");
  });

  it("assembles streamed tool calls correctly", async () => {
    server.urls[TEST_URL].response = {
      type: "stream-chunks",
      chunks: [...toolChunks, "data: [DONE]\n\n"],
    };

    const parts = await collectStream(makeModel(), {
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Weather?" }] }],
    });

    const tc = parts.find((p: any) => p.type === "tool-call") as any;
    expect(tc).toBeDefined();
    expect(tc.toolName).toBe("get_weather");
    expect(tc.toolCallId).toBe("call_abc123");
    expect(JSON.parse(tc.input)).toEqual({ location: "San Francisco" });
  });

  it("emits tool-input-start and tool-input-end around a streamed tool call", async () => {
    server.urls[TEST_URL].response = {
      type: "stream-chunks",
      chunks: [...toolChunks, "data: [DONE]\n\n"],
    };

    const parts = await collectStream(makeModel(), {
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Weather?" }] }],
    });

    const types = parts.map((p: any) => p.type);
    expect(types).toContain("tool-input-start");
    expect(types).toContain("tool-input-delta");
    expect(types).toContain("tool-input-end");
  });

  it("sets stream: true in the request body", async () => {
    server.urls[TEST_URL].response = {
      type: "stream-chunks",
      chunks: [...textChunks, "data: [DONE]\n\n"],
    };

    await collectStream(makeModel(), {
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });

    const body = await server.calls[0].requestBodyJson;
    expect(body.stream).toBe(true);
    expect(body.stream_options?.include_usage).toBe(true);
  });
});
