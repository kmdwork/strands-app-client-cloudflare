import { Hono } from "hono";
import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  requireAgentScope,
  requireAgentToken,
} from "../src/auth/agent-middleware";
import {
  AGENT_TOKEN_AUDIENCE,
  AGENT_TOKEN_TTL_SECONDS,
  AgentTokenError,
  createAgentAccessToken,
  verifyAgentAccessToken,
} from "../src/auth/agent-token";
import type { AppEnv } from "../src/auth/types";

const SECRET = "agent-api-test-secret-with-at-least-32-bytes";
const OTHER_SECRET = "different-agent-secret-with-at-least-32-bytes";
const NOW = new Date("2026-09-11T00:00:00.000Z");

describe("agent access token", () => {
  it("creates a 180-second read token for the Better Auth user", async () => {
    const token = await createAgentAccessToken(SECRET, {
      userId: "better-auth-user-1",
      scopes: ["aircon:read"],
    }, NOW);
    const claims = await verifyAgentAccessToken(SECRET, token, NOW);

    expect(claims).toEqual({
      sub: "better-auth-user-1",
      aud: AGENT_TOKEN_AUDIENCE,
      scope: ["aircon:read"],
      iat: Math.floor(NOW.getTime() / 1_000),
      exp: Math.floor(NOW.getTime() / 1_000) + AGENT_TOKEN_TTL_SECONDS,
    });
  });

  it("rejects expired and incorrectly signed tokens", async () => {
    const token = await createAgentAccessToken(SECRET, {
      userId: "user-1",
      scopes: ["aircon:read"],
    }, NOW);

    await expect(verifyAgentAccessToken(
      SECRET,
      token,
      new Date(NOW.getTime() + (AGENT_TOKEN_TTL_SECONDS + 1) * 1_000),
    )).rejects.toBeInstanceOf(AgentTokenError);
    await expect(verifyAgentAccessToken(OTHER_SECRET, token, NOW))
      .rejects.toBeInstanceOf(AgentTokenError);
  });

  it("rejects audience mismatch, missing claims, and unapproved algorithms", async () => {
    const key = new TextEncoder().encode(SECRET);
    const issuedAt = Math.floor(NOW.getTime() / 1_000);
    const wrongAudience = await new SignJWT({ scope: ["aircon:read"] })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject("user-1")
      .setAudience("other-api")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 180)
      .sign(key);
    const missingSubject = await new SignJWT({ scope: ["aircon:read"] })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setAudience(AGENT_TOKEN_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 180)
      .sign(key);
    const wrongAlgorithm = await new SignJWT({ scope: ["aircon:read"] })
      .setProtectedHeader({ alg: "HS384", typ: "JWT" })
      .setSubject("user-1")
      .setAudience(AGENT_TOKEN_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 180)
      .sign(key);

    for (const token of [wrongAudience, missingSubject, wrongAlgorithm]) {
      await expect(verifyAgentAccessToken(SECRET, token, NOW))
        .rejects.toBeInstanceOf(AgentTokenError);
    }
  });
});

describe("agent authentication middleware", () => {
  async function tokenFor(scopes: Array<"aircon:read" | "aircon:write">) {
    return createAgentAccessToken(SECRET, { userId: "user-1", scopes });
  }

  function appFor(scope: "aircon:read" | "aircon:write") {
    const app = new Hono<AppEnv>();
    app.use("*", requireAgentToken);
    app.use("*", requireAgentScope(scope));
    app.get("/", (c) => c.json({ sub: c.get("agentClaims").sub }));
    return app;
  }

  it("rejects missing, malformed, empty, and multiple credentials with 401", async () => {
    const app = appFor("aircon:read");
    const malformed = [
      undefined,
      "Basic abc",
      "Bearer ",
      "Bearer abc",
      "Bearer a.b.c, Bearer d.e.f",
    ];

    for (const authorization of malformed) {
      const response = await app.request("/", {
        headers: authorization === undefined ? {} : { Authorization: authorization },
      }, { AGENT_API_TOKEN_SECRET: SECRET } as Env);
      expect(response.status).toBe(401);
    }
  });

  it("stores verified claims and enforces read/write scope with 403", async () => {
    const readToken = await tokenFor(["aircon:read"]);
    const allowed = await appFor("aircon:read").request("/", {
      headers: { Authorization: `Bearer ${readToken}` },
    }, { AGENT_API_TOKEN_SECRET: SECRET } as Env);
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toEqual({ sub: "user-1" });

    const forbidden = await appFor("aircon:write").request("/", {
      headers: { Authorization: `Bearer ${readToken}` },
    }, { AGENT_API_TOKEN_SECRET: SECRET } as Env);
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: "Forbidden" });
  });
});
