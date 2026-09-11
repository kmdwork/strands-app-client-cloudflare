import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentAccessToken } from "../src/auth/agent-token";
import { agentAirconRoutes } from "../src/routes/agent-aircon";

const SECRET = "agent-api-test-secret-with-at-least-32-bytes";
const COMPANY_ROW = { id: "company-1", name: "Kamada" };
const rowsByTable: Record<string, Array<Record<string, unknown>>> = {
  companies: [COMPANY_ROW],
  properties: [{ id: "property-1", companyId: "company-1", name: "本社" }],
  systems: [{ id: "system-1", propertyId: "property-1", name: "1階" }],
  units: [{
    id: "unit-1",
    systemId: "system-1",
    airconModelId: null,
    name: "室外機1",
    unitType: "outdoor",
    manufacturer: null,
    modelNumber: null,
  }],
  airconModels: [{ id: "model-1", manufacturer: "Daikin", modelNumber: "RX-1" }],
};

interface QueryCall {
  query: string;
  values: unknown[];
}

function createDatabase(calls: QueryCall[]): D1Database {
  const database = Object.create(null) as D1Database;
  database.prepare = vi.fn((query: string) => {
    const table = Object.keys(rowsByTable).find((name) =>
      query.includes(`FROM ${name}`) || query.includes(`FROM ${name}\n`),
    );
    const statement = Object.create(null) as D1PreparedStatement;
    let values: unknown[] = [];
    statement.bind = (...bound: unknown[]) => {
      values = bound;
      return statement;
    };
    statement.all = async <T = Record<string, unknown>>(): Promise<D1Result<T>> => {
      calls.push({ query, values });
      return {
        success: true,
        results: (table === undefined ? [] : rowsByTable[table]) as T[],
        meta: {} as D1Meta & Record<string, unknown>,
      };
    };
    return statement;
  });
  return database;
}

function request(path: string, body: unknown, authorization?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization === undefined ? {} : { Authorization: authorization }),
    },
    body: JSON.stringify(body),
  });
}

describe("Agent aircon read API", () => {
  let calls: QueryCall[];
  let database: D1Database;

  beforeEach(() => {
    rowsByTable.companies = [COMPANY_ROW];
    calls = [];
    database = createDatabase(calls);
  });

  async function bearer(scopes: Array<"aircon:read" | "aircon:write">) {
    const token = await createAgentAccessToken(SECRET, {
      userId: "better-auth-user-1",
      scopes,
    });
    return `Bearer ${token}`;
  }

  function env(): Env {
    return {
      AGENT_API_TOKEN_SECRET: SECRET,
      AUTH_DB: database,
    } as Env;
  }

  it("requires a read Bearer token before D1 and does not accept a Cookie", async () => {
    const missing = await agentAirconRoutes.fetch(request(
      "/companies/search",
      {},
    ), env());
    expect(missing.status).toBe(401);

    const cookieOnly = request("/companies/search", {});
    cookieOnly.headers.set("Cookie", "better-auth.session_token=session");
    const cookieResponse = await agentAirconRoutes.fetch(cookieOnly, env());
    expect(cookieResponse.status).toBe(401);

    const writeOnly = await agentAirconRoutes.fetch(request(
      "/companies/search",
      {},
      await bearer(["aircon:write"]),
    ), env());
    expect(writeOnly.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("provides all five POST search endpoints and parent filters", async () => {
    const authorization = await bearer(["aircon:read"]);
    const cases = [
      ["/companies/search", { query: "Kamada" }, "companies"],
      ["/properties/search", { company_id: "company-1" }, "properties"],
      ["/systems/search", { property_id: "property-1" }, "systems"],
      ["/units/search", { system_id: "system-1" }, "units"],
      ["/models/search", { query: "RX-1" }, "models"],
    ] as const;

    for (const [path, body, responseKey] of cases) {
      const response = await agentAirconRoutes.fetch(
        request(path, body, authorization),
        env(),
      );
      expect(response.status).toBe(200);
      const json = await response.json() as Record<string, unknown[]>;
      expect(json[responseKey]?.length).toBe(1);
      if (responseKey === "units") {
        expect(json.units?.[0]).toMatchObject({
          airconModelId: null,
          manufacturer: null,
          modelNumber: null,
        });
      }
    }

    expect(calls[1]?.values).toEqual(["company-1", 1000]);
    expect(calls[2]?.values).toEqual(["property-1", 1000]);
    expect(calls[3]?.values).toEqual(["system-1", 1000]);
    expect(calls[3]?.query).toContain("LEFT JOIN airconModels");
    expect(calls[3]?.query).not.toContain("company-1");
  });

  it("binds injection-like input and escapes LIKE wildcards", async () => {
    const injection = "%' OR 1=1 --_";
    const response = await agentAirconRoutes.fetch(request(
      "/companies/search",
      { query: injection },
      await bearer(["aircon:read"]),
    ), env());

    expect(response.status).toBe(200);
    expect(calls[0]?.query).not.toContain(injection);
    expect(calls[0]?.query).toContain("LIKE ?");
    expect(calls[0]?.values).toEqual(["%\\%' OR 1=1 --\\_%", 1000]);
  });

  it("returns empty arrays and rejects invalid request bodies", async () => {
    rowsByTable.companies = [];
    const authorization = await bearer(["aircon:read"]);
    const empty = await agentAirconRoutes.fetch(
      request("/companies/search", {}, authorization),
      env(),
    );
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ companies: [] });

    const invalidBodies = [
      { query: 1 },
      { unsupported: "value" },
      { query: "x".repeat(201) },
      { query: "" },
    ];
    for (const body of invalidBodies) {
      const response = await agentAirconRoutes.fetch(
        request("/companies/search", body, authorization),
        env(),
      );
      expect(response.status).toBe(400);
    }

    const invalidId = await agentAirconRoutes.fetch(
      request("/properties/search", { company_id: 123 }, authorization),
      env(),
    );
    expect(invalidId.status).toBe(400);
  });

  it("rejects malformed JSON, oversized bodies, wrong content type, and GET", async () => {
    const authorization = await bearer(["aircon:read"]);
    const malformed = new Request("http://localhost/companies/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: "{",
    });
    expect((await agentAirconRoutes.fetch(malformed, env())).status).toBe(400);

    const oversized = request(
      "/companies/search",
      { query: "ok" },
      authorization,
    );
    oversized.headers.set("Content-Length", String(16 * 1024 + 1));
    expect((await agentAirconRoutes.fetch(oversized, env())).status).toBe(400);

    const wrongType = new Request("http://localhost/companies/search", {
      method: "POST",
      headers: { "Content-Type": "text/plain", Authorization: authorization },
      body: "{}",
    });
    expect((await agentAirconRoutes.fetch(wrongType, env())).status).toBe(415);

    const getResponse = await agentAirconRoutes.fetch(new Request(
      "http://localhost/companies/search",
      { headers: { Authorization: authorization } },
    ), env());
    expect(getResponse.status).toBe(404);
  });
});
