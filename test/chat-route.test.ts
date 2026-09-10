import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InvokeRuntimeStreamResult,
  RuntimeStreamEvent,
} from "../src/agentcore/types";

const mocks = vi.hoisted(() => ({
  authorized: true,
  invokeRuntimeStream: vi.fn(),
}));

vi.mock("../src/auth/middleware", () => ({
  requireSession: async (
    c: { json: (body: unknown, status: number) => Response; set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    if (!mocks.authorized) return c.json({ error: "Unauthorized" }, 401);
    c.set("authSession", { user: { id: "user-1" } });
    await next();
  },
}));

vi.mock("../src/agentcore/invoke-runtime", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../src/agentcore/invoke-runtime")
  >();
  return {
    ...original,
    invokeRuntimeStream: mocks.invokeRuntimeStream,
  };
});

import { AgentCoreInvocationError } from "../src/agentcore/invoke-runtime";
import { chatRoutes } from "../src/routes/chat";

const environment = {} as Env;

function runtimeResult(
  events: RuntimeStreamEvent[],
  overrides: Partial<InvokeRuntimeStreamResult> = {},
): InvokeRuntimeStreamResult {
  return {
    sessionId: "runtime-session",
    events: (async function* () {
      yield* events;
    })(),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function chatRequest(body: unknown, headers: HeadersInit = {}): Request {
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /", () => {
  beforeEach(() => {
    mocks.authorized = true;
    mocks.invokeRuntimeStream.mockReset();
  });

  it("keeps authentication, content type, size, and validation failures as JSON", async () => {
    mocks.authorized = false;
    const unauthorized = await chatRoutes.request(
      chatRequest({ message: "hello" }),
      undefined,
      environment,
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("content-type")).toContain("application/json");

    mocks.authorized = true;
    const unsupported = await chatRoutes.request("/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    }, environment);
    expect(unsupported.status).toBe(415);
    expect(unsupported.headers.get("content-type")).toContain("application/json");

    const tooLarge = await chatRoutes.request(
      chatRequest(
        { message: "hello" },
        { "Content-Length": String(6 * 1024 * 1024 + 1) },
      ),
      undefined,
      environment,
    );
    expect(tooLarge.status).toBe(400);

    const invalid = await chatRoutes.request(
      chatRequest({ message: "" }),
      undefined,
      environment,
    );
    expect(invalid.status).toBe(400);
    expect(mocks.invokeRuntimeStream).not.toHaveBeenCalled();
  });

  it("returns a pre-stream invocation failure as 502 JSON", async () => {
    mocks.invokeRuntimeStream.mockRejectedValue(
      new AgentCoreInvocationError("upstream failed"),
    );
    const response = await chatRoutes.request(
      chatRequest({ message: "hello" }),
      undefined,
      environment,
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: "AgentCore invocation failed",
    });
  });

  it("streams normalized events in order with the required headers", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.invokeRuntimeStream.mockResolvedValue(runtimeResult([
      { type: "delta", text: "hello" },
      {
        type: "metadata",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        latencyMs: 42,
      },
      { type: "image", image: { mediaType: "image/png", data: "aGVsbG8=" } },
      { type: "done" },
    ], { close }));

    const response = await chatRoutes.request(chatRequest({
      message: "hello",
      sessionId: "existing-session-123456789012345678",
    }), undefined, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-encoding")).toBe("Identity");
    const text = await response.text();
    expect(text).toContain(
      'event: session\ndata: {"sessionId":"runtime-session"}',
    );
    expect(text.indexOf("event: session")).toBeLessThan(text.indexOf("event: delta"));
    expect(text.indexOf("event: delta")).toBeLessThan(text.indexOf("event: metadata"));
    expect(text.indexOf("event: metadata")).toBeLessThan(text.indexOf("event: image"));
    expect(text.indexOf("event: image")).toBeLessThan(text.indexOf("event: done"));
    expect(mocks.invokeRuntimeStream.mock.calls[0]?.[1]).toMatchObject({
      sessionId: "existing-session-123456789012345678",
    });
    expect(close).toHaveBeenCalled();
  });

  it("makes the first delta readable before upstream completion", async () => {
    let finish = () => {};
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.invokeRuntimeStream.mockResolvedValue({
      sessionId: "session-1",
      events: (async function* () {
        yield { type: "delta", text: "first" } satisfies RuntimeStreamEvent;
        await blocked;
        yield { type: "done" } satisfies RuntimeStreamEvent;
      })(),
      close: vi.fn().mockResolvedValue(undefined),
    });

    const response = await chatRoutes.request(
      chatRequest({ message: "hello" }),
      undefined,
      environment,
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("event: delta")) {
      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      received += decoder.decode(chunk.value, { stream: true });
    }
    expect(received).toContain('data: {"text":"first"}');
    finish();
    while (!(await reader.read()).done) {
      // Drain the stream so its cleanup path completes.
    }
    reader.releaseLock();
  });

  it("turns a post-start failure into an SSE error event", async () => {
    mocks.invokeRuntimeStream.mockResolvedValue({
      sessionId: "session-1",
      events: (async function* () {
        yield { type: "delta", text: "partial" } satisfies RuntimeStreamEvent;
        throw new Error("private upstream detail");
      })(),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const response = await chatRoutes.request(
      chatRequest({ message: "hello" }),
      undefined,
      environment,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('event: delta\ndata: {"text":"partial"}');
    expect(text).toContain(
      'event: error\ndata: {"message":"AgentCore invocation failed"}',
    );
    expect(text).not.toContain("private upstream detail");
  });

  it("propagates downstream cancellation to the upstream AbortSignal", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.invokeRuntimeStream.mockImplementation(
      async (_env: Env, _input: unknown, options: { abortSignal: AbortSignal }) => {
        upstreamSignal = options.abortSignal;
        return {
          sessionId: "session-1",
          events: (async function* () {
            yield { type: "delta", text: "first" } satisfies RuntimeStreamEvent;
            await new Promise<void>((resolve) => {
              options.abortSignal.addEventListener("abort", () => resolve(), { once: true });
            });
          })(),
          close,
        };
      },
    );
    const response = await chatRoutes.request(
      chatRequest({ message: "hello" }),
      undefined,
      environment,
    );
    await response.body!.cancel();
    await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true));
    expect(close).toHaveBeenCalled();
  });
});
