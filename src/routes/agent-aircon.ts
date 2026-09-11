import { Hono } from "hono";
import {
  requireAgentScope,
  requireAgentToken,
} from "../auth/agent-middleware";
import type { AppEnv } from "../auth/types";
import { readJsonWithLimit, RequestBodyError } from "../http/read-json";
import {
  searchCompanies,
  searchModels,
  searchProperties,
  searchSystems,
  searchUnits,
} from "../repositories/aircon";
import {
  AirconSearchValidationError,
  parseNameSearch,
  parsePropertySearch,
  parseSystemSearch,
  parseUnitSearch,
} from "../schemas/aircon-search";

const MAX_SEARCH_BODY_BYTES = 16 * 1024;

export const agentAirconRoutes = new Hono<AppEnv>();

agentAirconRoutes.use("*", requireAgentToken);
agentAirconRoutes.use("*", requireAgentScope("aircon:read"));

agentAirconRoutes.post("/companies/search", async (c) => {
  const input = await readSearchInput(c.req.raw, parseNameSearch);
  return c.json({ companies: await searchCompanies(c.env.AUTH_DB, input) });
});

agentAirconRoutes.post("/properties/search", async (c) => {
  const input = await readSearchInput(c.req.raw, parsePropertySearch);
  return c.json({ properties: await searchProperties(c.env.AUTH_DB, input) });
});

agentAirconRoutes.post("/systems/search", async (c) => {
  const input = await readSearchInput(c.req.raw, parseSystemSearch);
  return c.json({ systems: await searchSystems(c.env.AUTH_DB, input) });
});

agentAirconRoutes.post("/units/search", async (c) => {
  const input = await readSearchInput(c.req.raw, parseUnitSearch);
  return c.json({ units: await searchUnits(c.env.AUTH_DB, input) });
});

agentAirconRoutes.post("/models/search", async (c) => {
  const input = await readSearchInput(c.req.raw, parseNameSearch);
  return c.json({ models: await searchModels(c.env.AUTH_DB, input) });
});

async function readSearchInput<T>(
  request: Request,
  parse: (value: unknown) => T,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AirconSearchHttpError(
      "Content-Type must be application/json",
      415,
    );
  }

  try {
    return parse(await readJsonWithLimit(request, MAX_SEARCH_BODY_BYTES));
  } catch (error) {
    if (
      error instanceof RequestBodyError ||
      error instanceof AirconSearchValidationError
    ) {
      throw new AirconSearchHttpError(error.message, 400);
    }
    throw error;
  }
}

class AirconSearchHttpError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 415,
  ) {
    super(message);
    this.name = "AirconSearchHttpError";
  }
}

agentAirconRoutes.onError((error, c) => {
  if (error instanceof AirconSearchHttpError) {
    return c.json({ error: error.message }, error.status);
  }
  throw error;
});
