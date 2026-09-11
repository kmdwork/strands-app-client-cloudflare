export const MAX_AIRCON_ROWS = 1_000;

export interface CompanyRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyRow {
  id: string;
  companyId: string;
  name: string;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemRow {
  id: string;
  propertyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface AirconModelRow {
  id: string;
  modelNumber: string;
  manufacturer: string;
  createdAt: string;
  updatedAt: string;
}

export interface UnitRow {
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

export interface NameSearchFilter {
  query?: string;
}

export interface PropertySearchFilter extends NameSearchFilter {
  companyId?: string;
}

export interface SystemSearchFilter extends NameSearchFilter {
  propertyId?: string;
}

export interface UnitSearchFilter extends NameSearchFilter {
  systemId?: string;
}

export async function getAirconOverview(db: D1Database) {
  const [companies, properties, systems, models, units] = await Promise.all([
    searchCompanies(db, {}),
    searchProperties(db, {}),
    searchSystems(db, {}),
    searchModels(db, {}),
    searchUnits(db, {}),
  ]);
  return { companies, properties, systems, models, units };
}

export async function searchCompanies(
  db: D1Database,
  filter: NameSearchFilter,
): Promise<CompanyRow[]> {
  const conditions: string[] = [];
  const values: string[] = [];
  if (filter.query !== undefined) {
    conditions.push("name LIKE ? ESCAPE '\\'");
    values.push(toLikePattern(filter.query));
  }
  return selectAll<CompanyRow>(
    db,
    `SELECT id, name, createdAt, updatedAt
     FROM companies${whereClause(conditions)}
     ORDER BY name, id
     LIMIT ?`,
    values,
  );
}

export async function searchProperties(
  db: D1Database,
  filter: PropertySearchFilter,
): Promise<PropertyRow[]> {
  const conditions: string[] = [];
  const values: string[] = [];
  if (filter.query !== undefined) {
    conditions.push("(name LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\')");
    const pattern = toLikePattern(filter.query);
    values.push(pattern, pattern);
  }
  if (filter.companyId !== undefined) {
    conditions.push("companyId = ?");
    values.push(filter.companyId);
  }
  return selectAll<PropertyRow>(
    db,
    `SELECT id, companyId, name, address, createdAt, updatedAt
     FROM properties${whereClause(conditions)}
     ORDER BY name, id
     LIMIT ?`,
    values,
  );
}

export async function searchSystems(
  db: D1Database,
  filter: SystemSearchFilter,
): Promise<SystemRow[]> {
  const conditions: string[] = [];
  const values: string[] = [];
  if (filter.query !== undefined) {
    conditions.push("name LIKE ? ESCAPE '\\'");
    values.push(toLikePattern(filter.query));
  }
  if (filter.propertyId !== undefined) {
    conditions.push("propertyId = ?");
    values.push(filter.propertyId);
  }
  return selectAll<SystemRow>(
    db,
    `SELECT id, propertyId, name, createdAt, updatedAt
     FROM systems${whereClause(conditions)}
     ORDER BY name, id
     LIMIT ?`,
    values,
  );
}

export async function searchModels(
  db: D1Database,
  filter: NameSearchFilter,
): Promise<AirconModelRow[]> {
  const conditions: string[] = [];
  const values: string[] = [];
  if (filter.query !== undefined) {
    conditions.push(
      "(manufacturer LIKE ? ESCAPE '\\' OR modelNumber LIKE ? ESCAPE '\\')",
    );
    const pattern = toLikePattern(filter.query);
    values.push(pattern, pattern);
  }
  return selectAll<AirconModelRow>(
    db,
    `SELECT id, modelNumber, manufacturer, createdAt, updatedAt
     FROM airconModels${whereClause(conditions)}
     ORDER BY manufacturer, modelNumber, id
     LIMIT ?`,
    values,
  );
}

export async function searchUnits(
  db: D1Database,
  filter: UnitSearchFilter,
): Promise<UnitRow[]> {
  const conditions: string[] = [];
  const values: string[] = [];
  if (filter.query !== undefined) {
    conditions.push(
      `(units.name LIKE ? ESCAPE '\\'
        OR airconModels.manufacturer LIKE ? ESCAPE '\\'
        OR airconModels.modelNumber LIKE ? ESCAPE '\\')`,
    );
    const pattern = toLikePattern(filter.query);
    values.push(pattern, pattern, pattern);
  }
  if (filter.systemId !== undefined) {
    conditions.push("units.systemId = ?");
    values.push(filter.systemId);
  }
  return selectAll<UnitRow>(
    db,
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
     LEFT JOIN airconModels ON airconModels.id = units.airconModelId${whereClause(conditions)}
     ORDER BY units.name, units.id
     LIMIT ?`,
    values,
  );
}

async function selectAll<T>(
  db: D1Database,
  query: string,
  values: string[],
): Promise<T[]> {
  const result = await db.prepare(query).bind(...values, MAX_AIRCON_ROWS).all<T>();
  return result.results;
}

function whereClause(conditions: string[]): string {
  return conditions.length === 0 ? "" : `\n     WHERE ${conditions.join(" AND ")}`;
}

function toLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}
