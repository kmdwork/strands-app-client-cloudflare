import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ authorized: true }));

vi.mock("../src/auth/middleware", () => ({
  requireSession: async (
    c: { json: (body: unknown, status: number) => Response; set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    if (!authState.authorized) return c.json({ error: "Unauthorized" }, 401);
    c.set("authSession", { user: { id: "user-1" } });
    await next();
  },
}));

import { airconRoutes } from "../src/routes/aircon";

const rowsByTable: Record<string, Array<Record<string, unknown>>> = {
  companies: [{ id: "company-1", name: "Kamada", createdAt: "2026-09-11", updatedAt: "2026-09-11" }],
  properties: [{ id: "property-1", companyId: "company-1", name: "本社", address: "東京都", createdAt: "2026-09-11", updatedAt: "2026-09-11" }],
  systems: [{ id: "system-1", propertyId: "property-1", name: "1階", createdAt: "2026-09-11", updatedAt: "2026-09-11" }],
  airconModels: [{ id: "model-1", modelNumber: "RX-1", manufacturer: "Daikin", createdAt: "2026-09-11", updatedAt: "2026-09-11" }],
  units: [{ id: "unit-1", systemId: "system-1", airconModelId: "model-1", name: "室外機1", unitType: "outdoor", manufacturer: "Daikin", modelNumber: "RX-1", createdAt: "2026-09-11", updatedAt: "2026-09-11" }],
};

function createDatabase(): D1Database {
  const database = Object.create(null) as D1Database;
  database.prepare = vi.fn((query: string) => {
    const table = Object.keys(rowsByTable).find((name) =>
      query.includes(`FROM ${name}`) || query.includes(`FROM ${name}\n`),
    );
    const statement = Object.create(null) as D1PreparedStatement;
    statement.bind = () => statement;
    statement.all = async <T = Record<string, unknown>>(): Promise<D1Result<T>> => ({
      success: true,
      results: (table === undefined ? [] : rowsByTable[table]) as T[],
      meta: {} as D1Meta & Record<string, unknown>,
    });
    return statement;
  });
  return database;
}

describe("GET /api/aircon", () => {
  beforeEach(() => {
    authState.authorized = true;
  });

  it("rejects unauthenticated requests before querying D1", async () => {
    authState.authorized = false;
    const database = createDatabase();
    const prepare = vi.spyOn(database, "prepare");
    const response = await airconRoutes.request("/", undefined, {
      AUTH_DB: database,
    } as Env);

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("returns all aircon management tables for an authenticated user", async () => {
    const database = createDatabase();
    const response = await airconRoutes.request("/", undefined, {
      AUTH_DB: database,
    } as Env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      companies: rowsByTable.companies,
      properties: rowsByTable.properties,
      systems: rowsByTable.systems,
      models: rowsByTable.airconModels,
      units: rowsByTable.units,
      limitPerTable: 1000,
    });
  });
});
