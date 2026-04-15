import { describe, it, expect } from "vitest";
import { sanitizeSurrogates } from "./sanitize.js";

describe("sanitizeSurrogates", () => {
  it("passes through clean strings unchanged", () => {
    expect(sanitizeSurrogates("hello world")).toBe("hello world");
  });

  it("replaces lone high surrogate", () => {
    expect(sanitizeSurrogates("bad\uD800char")).toBe("bad\uFFFDchar");
  });

  it("replaces lone low surrogate", () => {
    expect(sanitizeSurrogates("bad\uDC00char")).toBe("bad\uFFFDchar");
  });

  it("preserves valid surrogate pairs", () => {
    // U+1F600 GRINNING FACE = \uD83D\uDE00
    const emoji = "\uD83D\uDE00";
    expect(sanitizeSurrogates(emoji)).toBe(emoji);
  });

  it("handles empty string", () => {
    expect(sanitizeSurrogates("")).toBe("");
  });
});
