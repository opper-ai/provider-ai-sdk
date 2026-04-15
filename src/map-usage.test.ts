import { describe, it, expect } from "vitest";
import { mapUsage } from "./map-usage.js";

describe("mapUsage", () => {
  it("maps prompt and completion tokens", () => {
    const result = mapUsage({ prompt_tokens: 10, completion_tokens: 5 });
    expect(result.inputTokens.total).toBe(10);
    expect(result.inputTokens.noCache).toBe(10);
    expect(result.outputTokens.total).toBe(5);
    expect(result.outputTokens.text).toBe(5);
  });

  it("sets cacheRead and cacheWrite to undefined", () => {
    const result = mapUsage({ prompt_tokens: 10, completion_tokens: 5 });
    expect(result.inputTokens.cacheRead).toBeUndefined();
    expect(result.inputTokens.cacheWrite).toBeUndefined();
    expect(result.outputTokens.reasoning).toBeUndefined();
  });

  it("handles null input gracefully", () => {
    const result = mapUsage(null);
    expect(result.inputTokens.total).toBeUndefined();
    expect(result.outputTokens.total).toBeUndefined();
    expect(result.raw).toBeUndefined();
  });

  it("handles undefined input gracefully", () => {
    const result = mapUsage(undefined);
    expect(result.inputTokens.total).toBeUndefined();
    expect(result.outputTokens.total).toBeUndefined();
  });

  it("handles missing individual fields", () => {
    const result = mapUsage({ prompt_tokens: 7 });
    expect(result.inputTokens.total).toBe(7);
    expect(result.outputTokens.total).toBeUndefined();
  });

  it("preserves raw value", () => {
    const raw = { prompt_tokens: 3, completion_tokens: 2 };
    expect(mapUsage(raw).raw).toBe(raw);
  });
});
