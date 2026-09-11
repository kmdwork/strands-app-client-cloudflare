import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invokeRuntimeStream,
  parseRuntimeEventStream,
} from "../src/agentcore/invoke-runtime";
import type { RuntimeStreamEvent } from "../src/agentcore/types";

const clientMocks = vi.hoisted(() => ({
  send: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("../src/agentcore/client", () => ({
  createAgentCoreClient: () => clientMocks,
}));

const encoder = new TextEncoder();

async function collect(
  chunks: Array<string | Uint8Array>,
  cleanup: () => void | Promise<void> = () => {},
): Promise<RuntimeStreamEvent[]> {
  async function* source(): AsyncGenerator<string | Uint8Array> {
    yield* chunks;
  }
  return collectFrom(parseRuntimeEventStream(source(), cleanup));
}

describe("parseRuntimeEventStream", () => {
  it("parses one event from one chunk", async () => {
    await expect(collect([
      'data: {"event":{"contentBlockDelta":{"delta":{"text":"hello"}}}}\n\n',
    ])).resolves.toEqual([
      { type: "delta", text: "hello" },
      { type: "done" },
    ]);
  });

  it("restores an event split across byte chunks", async () => {
    await expect(collect([
      encoder.encode('data: {"event":{"contentBlockDel'),
      encoder.encode('ta":{"delta":{"text":"hello"}}}}\r\n\r\n'),
    ])).resolves.toEqual([
      { type: "delta", text: "hello" },
      { type: "done" },
    ]);
  });

  it("preserves delta order when one chunk contains multiple events", async () => {
    await expect(collect([[
      'data: {"event":{"contentBlockDelta":{"delta":{"text":"hel"}}}}',
      "",
      'data: {"event":{"contentBlockDelta":{"delta":{"text":"lo"}}}}',
      "",
    ].join("\n")])).resolves.toEqual([
      { type: "delta", text: "hel" },
      { type: "delta", text: "lo" },
      { type: "done" },
    ]);
  });

  it("supports comments, CRLF, multiple data lines, and a final unterminated frame", async () => {
    await expect(collect([
      ': keep-alive\r\ndata: {"event":\r\ndata: {"contentBlockDelta":{"delta":{"text":"ok"}}}}',
    ])).resolves.toEqual([
      { type: "delta", text: "ok" },
      { type: "done" },
    ]);
  });

  it("normalizes usage, latency, and images", async () => {
    await expect(collect([[
      'data: {"event":{"metadata":{"usage":{"inputTokens":2,"outputTokens":1,"totalTokens":3},"metrics":{"latencyMs":42}}}}',
      "",
      'data: {"images":[{"data":"aGVsbG8=","mediaType":"image/png"}]}',
      "",
    ].join("\n")])).resolves.toEqual([
      {
        type: "metadata",
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        latencyMs: 42,
      },
      { type: "image", image: { data: "aGVsbG8=", mediaType: "image/png" } },
      { type: "done" },
    ]);
  });

  it("emits done only once for an explicit [DONE]", async () => {
    await expect(collect([
      'data: {"event":{"contentBlockDelta":{"delta":{"text":"ok"}}}}\n\n',
      "data: [DONE]\n\n",
    ])).resolves.toEqual([
      { type: "delta", text: "ok" },
      { type: "done" },
    ]);
  });

  it("skips malformed JSON without losing later events", async () => {
    await expect(collect([[
      "data: {not-json}",
      "",
      'data: {"event":{"contentBlockDelta":{"delta":{"text":"survives"}}}}',
      "",
    ].join("\n")])).resolves.toEqual([
      { type: "delta", text: "survives" },
      { type: "done" },
    ]);
  });

  it("runs cleanup when the consumer cancels iteration", async () => {
    const cleanup = vi.fn();
    async function* source(): AsyncGenerator<string> {
      yield 'data: {"event":{"contentBlockDelta":{"delta":{"text":"first"}}}}\n\n';
      yield 'data: {"event":{"contentBlockDelta":{"delta":{"text":"second"}}}}\n\n';
    }
    const iterator = parseRuntimeEventStream(source(), cleanup);
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "delta", text: "first" },
    });
    await iterator.return(undefined);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe("invokeRuntimeStream", () => {
  beforeEach(() => {
    clientMocks.send.mockReset();
    clientMocks.destroy.mockReset();
  });

  it("requests SSE, releases the reader, and destroys the client", async () => {
    const releaseLock = vi.fn();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn()
      .mockResolvedValueOnce({
        done: false,
        value: encoder.encode(
          'data: {"event":{"contentBlockDelta":{"delta":{"text":"hi"}}}}\n\n',
        ),
      })
      .mockResolvedValueOnce({ done: true, value: undefined });
    const body = { locked: false, getReader: () => ({ read, releaseLock }), cancel };
    clientMocks.send.mockResolvedValue({
      response: body,
      contentType: "text/event-stream; charset=utf-8",
      runtimeSessionId: "runtime-session",
      statusCode: 200,
    });
    const abortController = new AbortController();

    const stream = await invokeRuntimeStream({
      AGENTCORE_RUNTIME_ARN: "arn:test",
    } as Env, {
      message: "hello",
      sessionId: "input-session",
      actorId: "actor",
      userAccessToken: "delegated-token",
    }, { abortSignal: abortController.signal });

    await expect(collectFrom(stream.events)).resolves.toEqual([
      { type: "delta", text: "hi" },
      { type: "done" },
    ]);
    const command = clientMocks.send.mock.calls[0]?.[0];
    expect(command.input.accept).toBe("text/event-stream");
    expect(JSON.parse(new TextDecoder().decode(command.input.payload))).toEqual({
      prompt: "hello",
      user_access_token: "delegated-token",
    });
    expect(clientMocks.send.mock.calls[0]?.[1]).toEqual({
      abortSignal: abortController.signal,
    });
    expect(stream.sessionId).toBe("runtime-session");
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(clientMocks.destroy).toHaveBeenCalledOnce();
  });

  it("keeps image media while adding the delegated token to the payload", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    clientMocks.send.mockResolvedValue({
      response: body,
      contentType: "text/event-stream",
      statusCode: 200,
    });

    const stream = await invokeRuntimeStream({
      AGENTCORE_RUNTIME_ARN: "arn:test",
    } as Env, {
      message: "describe",
      sessionId: "session",
      actorId: "actor",
      userAccessToken: "delegated-token",
      image: { mediaType: "image/png", data: "aGVsbG8=" },
    });
    await collectFrom(stream.events);

    const command = clientMocks.send.mock.calls[0]?.[0];
    expect(JSON.parse(new TextDecoder().decode(command.input.payload))).toEqual({
      prompt: "describe",
      user_access_token: "delegated-token",
      media: { type: "image", format: "png", data: "aGVsbG8=" },
    });
  });

  it("destroys the client when invocation fails before streaming", async () => {
    clientMocks.send.mockRejectedValue(new Error("network failure"));
    await expect(invokeRuntimeStream({
      AGENTCORE_RUNTIME_ARN: "arn:test",
    } as Env, {
      message: "hello",
      sessionId: "session",
      actorId: "actor",
      userAccessToken: "delegated-token",
    })).rejects.toMatchObject({
      name: "AgentCoreInvocationError",
      message: "Failed to invoke AgentCore Runtime",
    });
    expect(clientMocks.destroy).toHaveBeenCalledOnce();
  });

  it("releases the reader and destroys the client when streaming fails", async () => {
    const releaseLock = vi.fn();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const body = {
      locked: false,
      getReader: () => ({
        read: vi.fn().mockRejectedValue(new Error("stream failure")),
        releaseLock,
      }),
      cancel,
    };
    clientMocks.send.mockResolvedValue({
      response: body,
      contentType: "text/event-stream",
      statusCode: 200,
    });
    const stream = await invokeRuntimeStream({
      AGENTCORE_RUNTIME_ARN: "arn:test",
    } as Env, {
      message: "hello",
      sessionId: "session",
      actorId: "actor",
      userAccessToken: "delegated-token",
    });

    await expect(collectFrom(stream.events)).rejects.toThrow("stream failure");
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(clientMocks.destroy).toHaveBeenCalledOnce();
  });

  it("releases the reader and destroys the client when consumption is cancelled", async () => {
    const releaseLock = vi.fn();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValue({
      done: false,
      value: encoder.encode(
        'data: {"event":{"contentBlockDelta":{"delta":{"text":"partial"}}}}\n\n',
      ),
    });
    const body = { locked: false, getReader: () => ({ read, releaseLock }), cancel };
    clientMocks.send.mockResolvedValue({
      response: body,
      contentType: "text/event-stream",
      statusCode: 200,
    });
    const stream = await invokeRuntimeStream({
      AGENTCORE_RUNTIME_ARN: "arn:test",
    } as Env, {
      message: "hello",
      sessionId: "session",
      actorId: "actor",
      userAccessToken: "delegated-token",
    });
    const iterator = stream.events[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "delta", text: "partial" },
    });
    await iterator.return?.();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(clientMocks.destroy).toHaveBeenCalledOnce();
  });

  it("rejects an unexpected content type and destroys the client", async () => {
    clientMocks.send.mockResolvedValue({
      response: new Uint8Array(),
      contentType: "application/json",
      statusCode: 200,
    });
    await expect(invokeRuntimeStream({
      AGENTCORE_RUNTIME_ARN: "arn:test",
    } as Env, {
      message: "hello",
      sessionId: "session",
      actorId: "actor",
      userAccessToken: "delegated-token",
    })).rejects.toThrow("unsupported content type");
    expect(clientMocks.destroy).toHaveBeenCalledOnce();
  });
});

async function collectFrom(
  source: AsyncIterable<RuntimeStreamEvent>,
): Promise<RuntimeStreamEvent[]> {
  const result: RuntimeStreamEvent[] = [];
  for await (const event of source) result.push(event);
  return result;
}
