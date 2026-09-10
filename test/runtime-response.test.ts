import { describe, expect, it } from "vitest";
import { parseRuntimeResponse } from "../src/agentcore/invoke-runtime";

describe("parseRuntimeResponse", () => {
  it("reads a JSON string response", () => {
    expect(parseRuntimeResponse('"hello"', "application/json")).toEqual({
      message: "hello",
    });
  });

  it("reads a structured response with an image", () => {
    expect(
      parseRuntimeResponse(
        JSON.stringify({
          message: "generated",
          images: [{ data: "aGVsbG8=", mediaType: "image/png" }],
        }),
        "application/json",
      ),
    ).toEqual({
      message: "generated",
      images: [{ data: "aGVsbG8=", mediaType: "image/png" }],
    });
  });

  it("reads a Strands server-sent event stream", () => {
    expect(
      parseRuntimeResponse(
        [
          'data: {"event":{"messageStart":{"role":"assistant"}}}',
          "",
          'data: {"event":{"contentBlockDelta":{"delta":{"text":"hel"},"contentBlockIndex":0}}}',
          "",
          'data: {"event":{"contentBlockDelta":{"delta":{"text":"lo"},"contentBlockIndex":0}}}',
          "",
          'data: {"event":{"metadata":{"usage":{"inputTokens":2,"outputTokens":1,"totalTokens":3},"metrics":{"latencyMs":42}}}}',
          "",
        ].join("\n"),
        "text/event-stream",
      ),
    ).toEqual({
      message: "hello",
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      latencyMs: 42,
    });
  });
});
