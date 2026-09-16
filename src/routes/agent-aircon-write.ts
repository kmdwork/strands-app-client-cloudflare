import { Hono } from "hono";
import { requireAgentScope, requireAgentToken } from "../auth/agent-middleware";
import type { AppEnv } from "../auth/types";
import { readJsonWithLimit, RequestBodyError } from "../http/read-json";
import {
  applyAirconChanges,
  AirconWriteRepositoryError,
} from "../repositories/aircon-write";
import {
  AirconWriteValidationError,
  parseAirconWriteRequest,
} from "../schemas/aircon-write";

const MAX_WRITE_BODY_BYTES = 64 * 1024;

export const agentAirconWriteRoutes = new Hono<AppEnv>();

agentAirconWriteRoutes.use("*", requireAgentToken);
agentAirconWriteRoutes.use("*", requireAgentScope("aircon:write"));

agentAirconWriteRoutes.post("/changes/apply", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 415);
  }

  try {
    const operations = parseAirconWriteRequest(
      await readJsonWithLimit(c.req.raw, MAX_WRITE_BODY_BYTES),
    );
    const results = await applyAirconChanges(c.env.AUTH_DB, operations);
    return c.json({ success: true, results });
  } catch (error) {
    if (error instanceof RequestBodyError || error instanceof AirconWriteValidationError) {
      return c.json({ error: error.message }, 400);
    }
    if (error instanceof AirconWriteRepositoryError) {
      return c.json({ error: "Aircon changes could not be applied" }, 409);
    }
    throw error;
  }
});
