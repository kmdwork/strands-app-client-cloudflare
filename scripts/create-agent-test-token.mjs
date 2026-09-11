import { SignJWT } from "jose";

const AUDIENCE = "aircon-agent-api";
const TOKEN_TTL_SECONDS = 180;
const ALLOWED_SCOPES = new Set(["aircon:read", "aircon:write"]);

const secret = process.env.AGENT_API_TOKEN_SECRET;
const userId = process.argv[2] ?? "curl-test-user";
const scope = process.argv[3] ?? "aircon:read";

if (typeof secret !== "string" || secret.length < 32) {
  console.error(
    "AGENT_API_TOKEN_SECRET must be set to at least 32 characters.",
  );
  process.exitCode = 1;
} else if (userId.length === 0) {
  console.error("user id must not be empty.");
  process.exitCode = 1;
} else if (!ALLOWED_SCOPES.has(scope)) {
  console.error("scope must be aircon:read or aircon:write.");
  process.exitCode = 1;
} else {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const token = await new SignJWT({ scope: [scope] })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));

  // This command intentionally prints only the short-lived token for shell capture.
  console.log(token);
}
