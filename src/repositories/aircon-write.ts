import type { AirconWriteOperation } from "../schemas/aircon-write";

export interface AirconWriteResult {
  operationIndex: number;
  operation: AirconWriteOperation["type"];
  id: string;
}

export class AirconWriteRepositoryError extends Error {
  constructor() {
    super("Aircon changes could not be applied");
    this.name = "AirconWriteRepositoryError";
  }
}

export async function applyAirconChanges(
  db: D1Database,
  operations: AirconWriteOperation[],
  options: { createId?: () => string; now?: () => string } = {},
): Promise<AirconWriteResult[]> {
  const createId = options.createId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  const generatedIds = new Map<number, string>();

  for (const [index, operation] of operations.entries()) {
    if (operation.type.startsWith("create_")) generatedIds.set(index, createId());
  }

  const statements = operations.map((operation, index) => {
    const id = generatedIds.get(index) ?? operation.id;
    if (id === undefined) throw new AirconWriteRepositoryError();
    return buildStatement(db, operation, id, generatedIds, now());
  });

  try {
    const results = await db.batch(statements);
    if (results.some((result) => !result.success)) throw new AirconWriteRepositoryError();
  } catch {
    // D1 batch is transactional: an error rolls the complete batch back.
    throw new AirconWriteRepositoryError();
  }

  return operations.map((operation, operationIndex) => ({
    operationIndex,
    operation: operation.type,
    id: generatedIds.get(operationIndex) ?? operation.id!,
  }));
}

function buildStatement(
  db: D1Database,
  operation: AirconWriteOperation,
  id: string,
  generatedIds: Map<number, string>,
  now: string,
): D1PreparedStatement {
  switch (operation.type) {
    case "create_company":
      return db.prepare("INSERT INTO companies (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)")
        .bind(id, operation.name!, now, now);
    case "create_property":
      return db.prepare("INSERT INTO properties (id, companyId, name, address, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, resolveId(operation.companyId, operation.companyRef, generatedIds), operation.name!, operation.address ?? null, now, now);
    case "create_system":
      return db.prepare("INSERT INTO systems (id, propertyId, name, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)")
        .bind(id, resolveId(operation.propertyId, operation.propertyRef, generatedIds), operation.name!, now, now);
    case "create_model":
      return db.prepare("INSERT INTO airconModels (id, modelNumber, manufacturer, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)")
        .bind(id, operation.modelNumber!, operation.manufacturer!, now, now);
    case "create_unit":
      return db.prepare("INSERT INTO units (id, systemId, airconModelId, name, unitType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, resolveId(operation.systemId, operation.systemRef, generatedIds), resolveOptionalId(operation.modelId, operation.modelRef, generatedIds), operation.name!, operation.unitType!, now, now);
    case "update_company":
      return updateStatement(db, "companies", operation.id!, {
        name: operation.name,
      }, now);
    case "update_property":
      return updateStatement(db, "properties", operation.id!, {
        companyId: operation.companyId,
        name: operation.name,
        address: operation.address,
      }, now);
    case "update_system":
      return updateStatement(db, "systems", operation.id!, {
        propertyId: operation.propertyId,
        name: operation.name,
      }, now);
    case "update_model":
      return updateStatement(db, "airconModels", operation.id!, {
        manufacturer: operation.manufacturer,
        modelNumber: operation.modelNumber,
      }, now);
    case "update_unit":
      return updateStatement(db, "units", operation.id!, {
        systemId: operation.systemId,
        airconModelId: operation.modelId,
        name: operation.name,
        unitType: operation.unitType,
      }, now);
  }
}

function updateStatement(
  db: D1Database,
  table: "companies" | "properties" | "systems" | "airconModels" | "units",
  id: string,
  values: Record<string, string | null | undefined>,
  now: string,
): D1PreparedStatement {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  if (entries.length === 0) throw new AirconWriteRepositoryError();
  const columns = entries.map(([column]) => `${column} = ?`);
  return db.prepare(`UPDATE ${table} SET ${columns.join(", ")}, updatedAt = ? WHERE id = ?`)
    .bind(...entries.map(([, value]) => value), now, id);
}

function resolveId(
  id: string | undefined,
  reference: number | undefined,
  generatedIds: Map<number, string>,
): string {
  if (id !== undefined) return id;
  if (reference !== undefined) {
    const resolved = generatedIds.get(reference);
    if (resolved !== undefined) return resolved;
  }
  throw new AirconWriteRepositoryError();
}

function resolveOptionalId(
  id: string | null | undefined,
  reference: number | undefined,
  generatedIds: Map<number, string>,
): string | null {
  if (id !== undefined) return id;
  if (reference !== undefined) return resolveId(undefined, reference, generatedIds);
  return null;
}
