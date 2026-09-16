import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentAccessToken } from "../src/auth/agent-token";
import { agentAirconWriteRoutes } from "../src/routes/agent-aircon-write";

const SECRET = "agent-api-test-secret-with-at-least-32-bytes";

interface StatementCall { query: string; values: unknown[] }

function database(calls: StatementCall[], fail = false): D1Database {
  const db = Object.create(null) as D1Database;
  db.prepare = vi.fn((query: string) => {
    const statement = Object.create(null) as D1PreparedStatement;
    let values: unknown[] = [];
    statement.bind = (...bound: unknown[]) => {
      values = bound;
      calls.push({ query, values });
      return statement;
    };
    return statement;
  });
  db.batch = vi.fn(async () => {
    if (fail) throw new Error("constraint failed");
    return calls.map(() => ({ success: true, meta: {} as D1Meta }));
  }) as unknown as D1Database["batch"];
  return db;
}

async function bearer(scopes: Array<"aircon:read" | "aircon:write">) {
  return `Bearer ${await createAgentAccessToken(SECRET, { userId: "user-1", scopes })}`;
}

function request(body: unknown, authorization?: string): Request {
  return new Request("http://localhost/changes/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify(body),
  });
}

describe("Agent aircon write API", () => {
  let calls: StatementCall[];

  beforeEach(() => { calls = []; });

  function env(fail = false): Env {
    return { AGENT_API_TOKEN_SECRET: SECRET, AUTH_DB: database(calls, fail) } as Env;
  }

  it("requires a write Bearer token and does not accept read-only tokens", async () => {
    const body = { operations: [{ type: "create_company", name: "Mura" }] };
    expect((await agentAirconWriteRoutes.fetch(request(body), env())).status).toBe(401);
    expect((await agentAirconWriteRoutes.fetch(request(body, await bearer(["aircon:read"])), env())).status).toBe(403);
    expect((await agentAirconWriteRoutes.fetch(request(body, await bearer(["aircon:write"])), env())).status).toBe(200);
  });

  it("binds an operation batch once and resolves create references before execution", async () => {
    const response = await agentAirconWriteRoutes.fetch(request({
      operations: [
        { type: "create_company", name: "むらしま生産" },
        { type: "create_property", name: "東京本社", company_ref: 0 },
        { type: "create_system", name: "3F", property_ref: 1 },
        { type: "create_unit", name: "室外機1", unit_type: "outdoor", system_ref: 2 },
      ],
    }, await bearer(["aircon:read", "aircon:write"])), env());

    expect(response.status).toBe(200);
    const responseBody = await response.json() as { success: boolean; results: unknown[] };
    expect(responseBody).toMatchObject({ success: true });
    expect(responseBody.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationIndex: 0, operation: "create_company" }),
      expect.objectContaining({ operationIndex: 3, operation: "create_unit" }),
    ]));
    expect(calls).toHaveLength(4);
    expect(calls[1]?.query).toContain("INSERT INTO properties");
    expect(calls[1]?.values[1]).toBe(calls[0]?.values[0]);
    expect(calls[2]?.values[1]).toBe(calls[1]?.values[0]);
    expect(calls[3]?.values[1]).toBe(calls[2]?.values[0]);
  });

  it("rejects unsupported operations and does not execute a partial batch when D1 fails", async () => {
    const authorization = await bearer(["aircon:write"]);
    const invalid = await agentAirconWriteRoutes.fetch(request({
      operations: [{ type: "delete_company", id: "company-1" }],
    }, authorization), env());
    expect(invalid.status).toBe(400);
    expect(calls).toHaveLength(0);

    const failed = await agentAirconWriteRoutes.fetch(request({
      operations: [{ type: "create_company", name: "Mura" }, { type: "create_model", manufacturer: "Daikin", model_number: "X" }],
    }, authorization), env(true));
    expect(failed.status).toBe(409);
    await expect(failed.json()).resolves.toEqual({ error: "Aircon changes could not be applied" });
  });
});
