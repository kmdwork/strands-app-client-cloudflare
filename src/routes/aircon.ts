import { Hono } from "hono";
import { requireSession } from "../auth/middleware";
import type { AppEnv } from "../auth/types";

const MAX_ROWS_PER_TABLE = 1_000;

interface CompanyRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface PropertyRow {
  id: string;
  companyId: string;
  name: string;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SystemRow {
  id: string;
  propertyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface AirconModelRow {
  id: string;
  modelNumber: string;
  manufacturer: string;
  createdAt: string;
  updatedAt: string;
}

interface UnitRow {
  id: string;
  systemId: string;
  airconModelId: string | null;
  name: string;
  unitType: string;
  manufacturer: string | null;
  modelNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export const airconRoutes = new Hono<AppEnv>();

airconRoutes.use("*", requireSession);

airconRoutes.get("/", async (c) => {
  const [companies, properties, systems, models, units] = await Promise.all([
    c.env.AUTH_DB.prepare(
      `SELECT id, name, createdAt, updatedAt
       FROM companies
       ORDER BY name, id
       LIMIT ?`,
    ).bind(MAX_ROWS_PER_TABLE).all<CompanyRow>(),
    c.env.AUTH_DB.prepare(
      `SELECT id, companyId, name, address, createdAt, updatedAt
       FROM properties
       ORDER BY name, id
       LIMIT ?`,
    ).bind(MAX_ROWS_PER_TABLE).all<PropertyRow>(),
    c.env.AUTH_DB.prepare(
      `SELECT id, propertyId, name, createdAt, updatedAt
       FROM systems
       ORDER BY name, id
       LIMIT ?`,
    ).bind(MAX_ROWS_PER_TABLE).all<SystemRow>(),
    c.env.AUTH_DB.prepare(
      `SELECT id, modelNumber, manufacturer, createdAt, updatedAt
       FROM airconModels
       ORDER BY manufacturer, modelNumber
       LIMIT ?`,
    ).bind(MAX_ROWS_PER_TABLE).all<AirconModelRow>(),
    c.env.AUTH_DB.prepare(
      `SELECT
         units.id,
         units.systemId,
         units.airconModelId,
         units.name,
         units.unitType,
         airconModels.manufacturer,
         airconModels.modelNumber,
         units.createdAt,
         units.updatedAt
       FROM units
       LEFT JOIN airconModels ON airconModels.id = units.airconModelId
       ORDER BY units.name, units.id
       LIMIT ?`,
    ).bind(MAX_ROWS_PER_TABLE).all<UnitRow>(),
  ]);

  return c.json({
    companies: companies.results,
    properties: properties.results,
    systems: systems.results,
    models: models.results,
    units: units.results,
    limitPerTable: MAX_ROWS_PER_TABLE,
  });
});
