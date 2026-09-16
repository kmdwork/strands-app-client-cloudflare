import { describe, expect, it } from "vitest";
import {
  parseChatRequest,
  parseResumeChatRequest,
  RequestValidationError,
} from "../src/schemas/chat";

describe("parseChatRequest", () => {
  it("accepts a message without a session ID", () => {
    expect(parseChatRequest({ message: "  hello  " })).toEqual({ message: "hello" });
  });

  it("accepts a UUID session ID", () => {
    const sessionId = "727840a8-0279-4ec5-a169-08fe0e6b8344";
    expect(parseChatRequest({ message: "hello", sessionId })).toEqual({
      message: "hello",
      sessionId,
    });
  });

  it("rejects an empty message", () => {
    expect(() => parseChatRequest({ message: "   " })).toThrow(RequestValidationError);
  });

  it("rejects a short session ID", () => {
    expect(() => parseChatRequest({ message: "hello", sessionId: "short" })).toThrow(
      RequestValidationError,
    );
  });

  it("accepts a supported base64 image", () => {
    expect(
      parseChatRequest({
        message: "この画像を説明して",
        image: { mediaType: "image/png", data: "aGVsbG8=" },
      }),
    ).toEqual({
      message: "この画像を説明して",
      image: { mediaType: "image/png", data: "aGVsbG8=" },
    });
  });

  it("rejects an unsupported image type", () => {
    expect(() =>
      parseChatRequest({
        message: "この画像を説明して",
        image: { mediaType: "image/svg+xml", data: "PHN2Zz4=" },
      }),
    ).toThrow(RequestValidationError);
  });

  it("rejects malformed base64 image data", () => {
    expect(() =>
      parseChatRequest({
        message: "この画像を説明して",
        image: { mediaType: "image/png", data: "not base64" },
      }),
    ).toThrow(RequestValidationError);
  });
});

describe("parseResumeChatRequest", () => {
  const sessionId = "727840a8-0279-4ec5-a169-08fe0e6b8344";

  it("accepts an approval decision for an existing session", () => {
    expect(parseResumeChatRequest({
      sessionId,
      interruptId: " interrupt-1 ",
      decision: "approve",
    })).toEqual({
      sessionId,
      interruptId: "interrupt-1",
      decision: "approve",
    });
  });

  it("requires a valid session, interrupt ID, and explicit decision", () => {
    const invalidBodies = [
      { interruptId: "id", decision: "approve" },
      { sessionId, interruptId: "", decision: "approve" },
      { sessionId, interruptId: "id", decision: "later" },
    ];
    for (const body of invalidBodies) {
      expect(() => parseResumeChatRequest(body)).toThrow(RequestValidationError);
    }
  });
});
