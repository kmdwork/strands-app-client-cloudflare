import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  AgentCoreInvocationError,
  invokeRuntimeStream,
} from "../agentcore/invoke-runtime";
import { requireSession } from "../auth/middleware";
import type { AppEnv } from "../auth/types";
import { readJsonWithLimit, RequestBodyError } from "../http/read-json";
import { parseChatRequest, RequestValidationError } from "../schemas/chat";

const MAX_REQUEST_BODY_BYTES = 6 * 1024 * 1024;

export const chatRoutes = new Hono<AppEnv>();

chatRoutes.use("*", requireSession);

chatRoutes.post("/", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 415);
  }

  try {
    const body = await readJsonWithLimit(c.req.raw, MAX_REQUEST_BODY_BYTES);
    const input = parseChatRequest(body);
    const sessionId = input.sessionId ?? crypto.randomUUID();
    const authSession = c.get("authSession");

    const abortController = new AbortController();
    const runtime = await invokeRuntimeStream(c.env, {
      message: input.message,
      sessionId,
      actorId: authSession.user.id,
      image: input.image,
    }, { abortSignal: abortController.signal });

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
            await stream.writeSSE({
              event: "delta",
              data: JSON.stringify({ text: event.text }),
            });
          } else if (event.type === "image") {
            await stream.writeSSE({
              event: "image",
              data: JSON.stringify(event.image),
            });
          } else if (event.type === "metadata") {
            await stream.writeSSE({
              event: "metadata",
              data: JSON.stringify({
                ...(event.usage === undefined ? {} : { usage: event.usage }),
                ...(event.latencyMs === undefined
                  ? {}
                  : { latencyMs: event.latencyMs }),
              }),
            });
          } else {
            await stream.writeSSE({
              event: "done",
              data: "{}",
            });
          }
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "agentcore_stream_failed",
            errorName: error instanceof Error ? error.name : "UnknownError",
          }),
        );
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
  } catch (error) {
    if (error instanceof RequestBodyError || error instanceof RequestValidationError) {
      return c.json({ error: error.message }, 400);
    }

    if (error instanceof AgentCoreInvocationError) {
      console.error(
        JSON.stringify({
          event: "agentcore_invocation_failed",
          errorName: error.causeName,
        }),
      );
      return c.json({ error: "AgentCore invocation failed" }, 502);
    }

    throw error;
  }
});
