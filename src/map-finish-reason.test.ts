import { describe, it, expect } from "vitest";
import { mapFinishReason } from "./map-finish-reason.js";

describe("mapFinishReason", () => {
  it("maps stop", () => {
    expect(mapFinishReason("stop")).toEqual({ unified: "stop", raw: "stop" });
  });

  it("maps length", () => {
    expect(mapFinishReason("length")).toEqual({
      unified: "length",
      raw: "length",
    });
  });

  it("maps model_length", () => {
    expect(mapFinishReason("model_length")).toEqual({
      unified: "length",
      raw: "model_length",
    });
  });

  it("maps tool_calls", () => {
    expect(mapFinishReason("tool_calls")).toEqual({
      unified: "tool-calls",
      raw: "tool_calls",
    });
  });

  it("maps content_filter", () => {
    expect(mapFinishReason("content_filter")).toEqual({
      unified: "content-filter",
      raw: "content_filter",
    });
  });

  it("maps unknown values to other", () => {
    expect(mapFinishReason("something_else")).toEqual({
      unified: "other",
      raw: "something_else",
    });
  });

  it("maps null to other with undefined raw", () => {
    expect(mapFinishReason(null)).toEqual({ unified: "other", raw: undefined });
  });

  it("maps undefined to other with undefined raw", () => {
    expect(mapFinishReason(undefined)).toEqual({
      unified: "other",
      raw: undefined,
    });
  });
});
