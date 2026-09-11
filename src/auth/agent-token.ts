import { jwtVerify, SignJWT } from "jose";

export const AGENT_TOKEN_AUDIENCE = "aircon-agent-api";
export const AGENT_TOKEN_TTL_SECONDS = 180;
const AGENT_TOKEN_ALGORITHM = "HS256";

export type AgentScope = "aircon:read" | "aircon:write";

export interface AgentTokenClaims {
  sub: string;
  aud: typeof AGENT_TOKEN_AUDIENCE;
  scope: AgentScope[];
  iat: number;
  exp: number;
}

interface CreateAgentAccessTokenInput {
  userId: string;
  scopes: AgentScope[];
}

export class AgentTokenError extends Error {
  constructor() {
    super("Invalid agent access token");
    this.name = "AgentTokenError";
  }
}

export async function createAgentAccessToken(
  secret: string,
  input: CreateAgentAccessTokenInput,
  currentDate = new Date(),
): Promise<string> {
  if (secret.length < 32 || input.userId.length === 0 || input.scopes.length === 0) {
    throw new AgentTokenError();
  }

  const issuedAt = Math.floor(currentDate.getTime() / 1_000);
  return new SignJWT({ scope: [...new Set(input.scopes)] })
    .setProtectedHeader({ alg: AGENT_TOKEN_ALGORITHM, typ: "JWT" })
    .setSubject(input.userId)
    .setAudience(AGENT_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + AGENT_TOKEN_TTL_SECONDS)
    .sign(encodeSecret(secret));
}

export async function verifyAgentAccessToken(
  secret: string,
  token: string,
  currentDate = new Date(),
): Promise<AgentTokenClaims> {
  if (secret.length < 32 || token.length === 0) throw new AgentTokenError();

  try {
    const { payload } = await jwtVerify(token, encodeSecret(secret), {
      algorithms: [AGENT_TOKEN_ALGORITHM],
      audience: AGENT_TOKEN_AUDIENCE,
      typ: "JWT",
      requiredClaims: ["sub", "iat", "exp", "scope"],
      maxTokenAge: AGENT_TOKEN_TTL_SECONDS,
      currentDate,
    });

    if (
      typeof payload.sub !== "string" ||
      payload.sub.length === 0 ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      !Array.isArray(payload.scope) ||
      payload.scope.length === 0 ||
      !payload.scope.every(isAgentScope)
    ) {
      throw new AgentTokenError();
    }

    return {
      sub: payload.sub,
      aud: AGENT_TOKEN_AUDIENCE,
      scope: [...new Set(payload.scope)],
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    throw new AgentTokenError();
  }
}

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function isAgentScope(value: unknown): value is AgentScope {
  return value === "aircon:read" || value === "aircon:write";
}
