import { Hono } from "hono";
import { AgentCoreInvocationError, invokeRuntime } from "../agentcore/invoke-runtime";
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

    const result = await invokeRuntime(c.env, {
      message: input.message,
      sessionId,
      actorId: authSession.user.id,
      image: input.image,
    });

    return c.json({
      sessionId: result.sessionId,
      message: result.message,
      images: result.images,
      usage: result.usage,
      latencyMs: result.latencyMs,
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
