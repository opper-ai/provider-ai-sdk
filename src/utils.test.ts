import { describe, it, expect } from "vitest";
import { normalizeToolCallId } from "./utils.js";

describe("normalizeToolCallId", () => {
  it("returns short clean IDs unchanged", () => {
    expect(normalizeToolCallId("call_abc123")).toBe("call_abc123");
  });

  it("strips the pipe suffix from Responses API IDs", () => {
    expect(normalizeToolCallId("call_abc|very_long_base64==")).toBe("call_abc");
  });

  it("replaces characters outside [a-zA-Z0-9_-]", () => {
    expect(normalizeToolCallId("call.abc!xyz")).toBe("call_abc_xyz");
  });

  it("truncates IDs longer than 40 characters", () => {
    const long = "a".repeat(50);
    expect(normalizeToolCallId(long)).toHaveLength(40);
  });

  it("truncates before pipe stripping leaves exactly 40 chars", () => {
    const id = "x".repeat(45) + "|suffix";
    const result = normalizeToolCallId(id);
    expect(result).toHaveLength(40);
  });
});
