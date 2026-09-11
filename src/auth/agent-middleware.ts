import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./types";
import {
  type AgentScope,
  verifyAgentAccessToken,
} from "./agent-token";

const BEARER_TOKEN_PATTERN = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

export const requireAgentToken = createMiddleware<AppEnv>(async (c, next) => {
  const authorization = c.req.header("authorization");
  const match = authorization?.match(BEARER_TOKEN_PATTERN);
  if (match === undefined || match === null) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const claims = await verifyAgentAccessToken(
      c.env.AGENT_API_TOKEN_SECRET,
      match[1],
    );
    c.set("agentClaims", claims);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});

export function requireAgentScope(scope: AgentScope) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const claims = c.get("agentClaims");
    if (!claims.scope.includes(scope)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  });
}
