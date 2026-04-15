import { describe, it, expect } from "vitest";
import { convertMessages } from "./convert-messages.js";
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";

describe("convertMessages", () => {
  it("converts a simple user text message", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];
    expect(convertMessages(prompt)).toEqual([
      { role: "user", content: "Hello" },
    ]);
  });

  it("converts a system message", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "You are helpful." },
    ];
    expect(convertMessages(prompt)).toEqual([
      { role: "system", content: "You are helpful." },
    ]);
  });

  it("skips empty user text messages", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "   " }] },
    ];
    expect(convertMessages(prompt)).toEqual([]);
  });

  it("converts an assistant text message", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "assistant",
        content: [{ type: "text", text: "I can help." }],
      },
    ];
    expect(convertMessages(prompt)).toEqual([
      { role: "assistant", content: "I can help.", tool_calls: undefined },
    ]);
  });

  it("skips empty assistant turns", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "assistant", content: [] },
    ];
    expect(convertMessages(prompt)).toEqual([]);
  });

  it("converts a tool-call in an assistant message", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "search",
            input: { q: "hello" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "search",
            output: "result text",
          },
        ],
      },
    ];
    const messages = convertMessages(prompt);
    const assistant = messages.find((m) => m.role === "assistant") as any;
    expect(assistant.tool_calls).toHaveLength(1);
    expect(assistant.tool_calls[0].function.name).toBe("search");

    const tool = messages.find((m) => m.role === "tool") as any;
    expect(tool.tool_call_id).toBe("call_1");
    expect(tool.content).toBe("result text");
  });

  it("inserts synthetic tool result for orphaned tool call", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_orphan",
            toolName: "missing_tool",
            input: {},
          },
        ],
      },
      { role: "user", content: [{ type: "text", text: "Hi" }] },
    ];
    const messages = convertMessages(prompt);
    const synthetic = messages.find(
      (m) => m.role === "tool" && (m as any).tool_call_id === "call_orphan"
    ) as any;
    expect(synthetic).toBeDefined();
    expect(synthetic.content).toContain("missing_tool");
  });

  it("normalizes long pipe-format tool call IDs", () => {
    const longId = "call_abc|" + "x".repeat(200);
    const prompt: LanguageModelV3Prompt = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: longId,
            toolName: "tool",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: longId,
            toolName: "tool",
            output: "ok",
          },
        ],
      },
    ];
    const messages = convertMessages(prompt);
    const assistant = messages.find((m) => m.role === "assistant") as any;
    const tc = assistant.tool_calls[0];
    expect(tc.id).toBe("call_abc");
    expect(tc.id.length).toBeLessThanOrEqual(40);
  });

  it("handles image content parts in user messages", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          {
            type: "file",
            mediaType: "image/png",
            data: "base64data",
            filename: undefined,
          },
        ],
      },
    ];
    const messages = convertMessages(prompt);
    expect(messages).toHaveLength(1);
    const parts = (messages[0] as any).content;
    expect(parts.find((p: any) => p.type === "text").text).toBe(
      "What is this?"
    );
    expect(
      parts.find((p: any) => p.type === "image_url").image_url.url
    ).toContain("data:image/png;base64,base64data");
  });
});
