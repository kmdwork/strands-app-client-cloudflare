import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  AgentCoreInvocationError,
  invokeRuntimeStream,
} from "../agentcore/invoke-runtime";
import type {
  InvokeRuntimePromptInput,
  InvokeRuntimeResumeInput,
  InvokeRuntimeStreamResult,
  RuntimeImage,
  RuntimeInterruptResponse,
} from "../agentcore/types";
import { requireSession } from "../auth/middleware";
import {
  createAgentAccessToken,
  AGENT_WRITE_TOKEN_TTL_SECONDS,
} from "../auth/agent-token";
import type { AgentScope } from "../auth/agent-token";
import type { AppEnv } from "../auth/types";
import { readJsonWithLimit, RequestBodyError } from "../http/read-json";
import {
  parseChatRequest,
  parseResumeChatRequest,
  RequestValidationError,
} from "../schemas/chat";

const MAX_REQUEST_BODY_BYTES = 6 * 1024 * 1024;

export const chatRoutes = new Hono<AppEnv>();

chatRoutes.use("*", requireSession);

chatRoutes.post("/", async (c) => {
  try {
    const body = await readChatJson(c);
    const input = parseChatRequest(body);
    const sessionId = input.sessionId ?? crypto.randomUUID();
    const runtime = await invokeForSession(
      c,
      {
        message: input.message,
        sessionId,
        ...(input.image === undefined ? {} : { image: input.image }),
      },
      { scopes: ["aircon:read"] },
    );
    return streamRuntime(c, runtime);
  } catch (error) {
    return handleChatError(c, error);
  }
});

chatRoutes.post("/resume", async (c) => {
  try {
    const input = parseResumeChatRequest(await readChatJson(c));
    const runtime = await invokeForSession(
      c,
      {
        sessionId: input.sessionId,
        interruptResponses: [{
          interruptId: input.interruptId,
          response: input.decision,
        }],
      },
      input.decision === "approve"
        ? { scopes: ["aircon:read", "aircon:write"], ttlSeconds: AGENT_WRITE_TOKEN_TTL_SECONDS }
        : { scopes: ["aircon:read"] },
    );
    return streamRuntime(c, runtime);
  } catch (error) {
    return handleChatError(c, error);
  }
});

type RuntimeInvocation =
  | { sessionId: string; message: string; image?: RuntimeImage }
  | { sessionId: string; interruptResponses: RuntimeInterruptResponse[] };

interface ActiveRuntime {
  runtime: InvokeRuntimeStreamResult;
  abortController: AbortController;
}

async function readChatJson(c: Context<AppEnv>): Promise<unknown> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ChatHttpError("Content-Type must be application/json", 415);
  }
  return readJsonWithLimit(c.req.raw, MAX_REQUEST_BODY_BYTES);
}

async function invokeForSession(
  c: Context<AppEnv>,
  input: RuntimeInvocation,
  tokenOptions: { scopes: AgentScope[]; ttlSeconds?: number },
): Promise<ActiveRuntime> {
  const authSession = c.get("authSession");
  const userAccessToken = await createAgentAccessToken(c.env.AGENT_API_TOKEN_SECRET, {
    userId: authSession.user.id,
    ...tokenOptions,
  });
  const abortController = new AbortController();
  const identity = {
    actorId: authSession.user.id,
    userAccessToken,
  };
  const runtime = "interruptResponses" in input
    ? await invokeRuntimeStream(c.env, {
      ...input,
      ...identity,
    } satisfies InvokeRuntimeResumeInput, { abortSignal: abortController.signal })
    : await invokeRuntimeStream(c.env, {
      ...input,
      ...identity,
    } satisfies InvokeRuntimePromptInput, { abortSignal: abortController.signal });
  return { runtime, abortController };
}

function streamRuntime(c: Context<AppEnv>, activeRuntime: ActiveRuntime) {
  const { runtime, abortController } = activeRuntime;
  c.header("Cache-Control", "no-cache");
  c.header("Content-Encoding", "Identity");
  return streamSSE(c, async (stream) => {
    stream.onAbort(async () => {
      abortController.abort();
      await runtime.close();
    });

    try {
      await stream.writeSSE({
        event: "session",
        data: JSON.stringify({ sessionId: runtime.sessionId }),
      });

      for await (const event of runtime.events) {
        if (event.type === "delta") {
          await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: event.text }) });
        } else if (event.type === "image") {
          await stream.writeSSE({ event: "image", data: JSON.stringify(event.image) });
        } else if (event.type === "metadata") {
          await stream.writeSSE({
            event: "metadata",
            data: JSON.stringify({
              ...(event.usage === undefined ? {} : { usage: event.usage }),
              ...(event.latencyMs === undefined ? {} : { latencyMs: event.latencyMs }),
            }),
          });
        } else if (event.type === "confirmation_required") {
          await stream.writeSSE({
            event: "confirmation_required",
            data: JSON.stringify({
              interruptId: event.confirmation.interruptId,
              toolName: event.confirmation.toolName,
              summary: event.confirmation.summary,
            }),
          });
        } else {
          await stream.writeSSE({ event: "done", data: "{}" });
        }
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: "agentcore_stream_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      }));
      if (!stream.aborted) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message: "AgentCore invocation failed" }),
        });
      }
    } finally {
      await runtime.close();
    }
  });
}

function handleChatError(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof ChatHttpError) return c.json({ error: error.message }, error.status);
  if (error instanceof RequestBodyError || error instanceof RequestValidationError) {
    return c.json({ error: error.message }, 400);
  }
  if (error instanceof AgentCoreInvocationError) {
    console.error(JSON.stringify({ event: "agentcore_invocation_failed", errorName: error.causeName }));
    return c.json({ error: "AgentCore invocation failed" }, 502);
  }
  throw error;
}

class ChatHttpError extends Error {
  constructor(message: string, readonly status: 415) {
    super(message);
  }
}
