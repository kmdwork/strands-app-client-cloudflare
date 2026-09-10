import { describe, expect, it, vi } from "vitest";
import {
  ChatStreamError,
  consumeSseFrames,
  streamChat,
} from "../public/chat-stream.js";

const encoder = new TextEncoder();

describe("consumeSseFrames", () => {
  it("keeps an incomplete frame and parses multiple completed frames in order", () => {
    const parsed = consumeSseFrames([
      'event: session\ndata: {"sessionId":"abc"}\n\n',
      'event: delta\ndata: {"text":"hel"}\n\n',
      'event: delta\ndata: {"text":"lo',
    ].join(""));

    expect(parsed.events).toEqual([
      { type: "session", data: { sessionId: "abc" } },
      { type: "delta", data: { text: "hel" } },
    ]);
    expect(parsed.remainder).toBe('event: delta\ndata: {"text":"lo');
  });

  it("supports CRLF, comments, multiple data lines, and a trailing frame", () => {
    expect(consumeSseFrames(
      ': ping\r\nevent: delta\r\ndata: {"text":\r\ndata: "hello"}',
      true,
    )).toEqual({
      events: [{ type: "delta", data: { text: "hello" } }],
      remainder: "",
    });
  });
});

describe("streamChat", () => {
  it("dispatches the first delta before the response completes", async () => {
    let controller;
    const body = new ReadableStream({
      start(value) {
        controller = value;
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    }));
    let resolveFirstDelta;
    const firstDelta = new Promise((resolve) => {
      resolveFirstDelta = resolve;
    });
    const deltas = [];
    let completed = false;

    const streaming = streamChat({ message: "hello" }, {
      delta(data) {
        deltas.push(data.text);
        resolveFirstDelta();
      },
      done() {
        completed = true;
      },
    }, fetchImpl);

    controller.enqueue(encoder.encode(
      'event: session\ndata: {"sessionId":"abc"}\n\n' +
      'event: delta\ndata: {"text":"first"}\n\n',
    ));
    await firstDelta;
    expect(deltas).toEqual(["first"]);
    expect(completed).toBe(false);

    controller.enqueue(encoder.encode(
      'event: delta\ndata: {"text":" second"}\n\n' +
      "event: done\ndata: {}\n\n",
    ));
    controller.close();
    await streaming;
    expect(deltas).toEqual(["first", " second"]);
    expect(completed).toBe(true);
  });

  it("delivers session, metadata, and image events without loss", async () => {
    const received = {};
    await streamChat({ message: "hello" }, {
      session(data) {
        received.session = data;
      },
      metadata(data) {
        received.metadata = data;
      },
      image(data) {
        received.image = data;
      },
    }, async () => new Response([
      'event: session\ndata: {"sessionId":"session-1"}',
      "",
      'event: metadata\ndata: {"usage":{"totalTokens":3},"latencyMs":42}',
      "",
      'event: image\ndata: {"mediaType":"image/png","data":"aGVsbG8="}',
      "",
      "event: done\ndata: {}",
      "",
    ].join("\n"), {
      headers: { "Content-Type": "text/event-stream" },
    }));

    expect(received).toEqual({
      session: { sessionId: "session-1" },
      metadata: { usage: { totalTokens: 3 }, latencyMs: 42 },
      image: { mediaType: "image/png", data: "aGVsbG8=" },
    });
  });

  it("reports a stream error after preserving earlier deltas", async () => {
    const deltas = [];
    await expect(streamChat({ message: "hello" }, {
      delta(data) {
        deltas.push(data.text);
      },
    }, async () => new Response([
      'event: delta\ndata: {"text":"partial"}',
      "",
      'event: error\ndata: {"message":"AgentCore invocation failed"}',
      "",
    ].join("\n"), {
      headers: { "Content-Type": "text/event-stream" },
    }))).rejects.toMatchObject({
      name: "ChatStreamError",
      message: "AgentCore invocation failed",
    });
    expect(deltas).toEqual(["partial"]);
  });

  it("preserves an HTTP authentication status without reading response.text()", async () => {
    await expect(streamChat({ message: "hello" }, {}, async () =>
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    )).rejects.toEqual(new ChatStreamError("Unauthorized", 401));
  });
});
