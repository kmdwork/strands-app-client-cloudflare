const MAX_OPERATIONS = 20;
const MAX_FIELD_CHARS = 500;
const MAX_ID_CHARS = 200;

export type AirconWriteOperationType =
  | "create_company"
  | "create_property"
  | "create_system"
  | "create_model"
  | "create_unit"
  | "update_company"
  | "update_property"
  | "update_system"
  | "update_model"
  | "update_unit";

export interface AirconWriteOperation {
  type: AirconWriteOperationType;
  id?: string;
  name?: string;
  address?: string | null;
  companyId?: string;
  companyRef?: number;
  propertyId?: string;
  propertyRef?: number;
  systemId?: string;
  systemRef?: number;
  modelId?: string | null;
  modelRef?: number;
  manufacturer?: string;
  modelNumber?: string;
  unitType?: "indoor" | "outdoor";
}

export class AirconWriteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AirconWriteValidationError";
  }
}

export function parseAirconWriteRequest(value: unknown): AirconWriteOperation[] {
  const body = record(value, "Request body must be a JSON object");
  rejectUnknown(body, ["operations"]);
  if (!Array.isArray(body.operations) || body.operations.length === 0) {
    throw new AirconWriteValidationError("operations must be a non-empty array");
  }
  if (body.operations.length > MAX_OPERATIONS) {
    throw new AirconWriteValidationError(`operations must not exceed ${MAX_OPERATIONS} items`);
  }

  const operations = body.operations.map((value, index) => parseOperation(value, index));
  validateReferences(operations);
  return operations;
}

function parseOperation(value: unknown, index: number): AirconWriteOperation {
  const operation = record(value, `operations[${index}] must be an object`);
  const type = operation.type;
  if (!isOperationType(type)) {
    throw new AirconWriteValidationError(`operations[${index}].type is not supported`);
  }

  const definition = definitionFor(type);
  rejectUnknown(operation, definition.allowed);
  for (const required of definition.required) {
    if (!(required in operation)) {
      throw new AirconWriteValidationError(`operations[${index}] is missing required field: ${required}`);
    }
  }

  const result: AirconWriteOperation = { type };
  const writable = result as unknown as Record<string, unknown>;
  for (const [source, target] of Object.entries(fieldNames)) {
    if (!(source in operation)) continue;
    const value = operation[source];
    if (source.endsWith("_ref")) {
      if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
        throw new AirconWriteValidationError(`operations[${index}].${source} must be a non-negative integer`);
      }
      writable[target] = value;
    } else if (source === "address" || source === "model_id") {
      writable[target] = nullableString(value, `operations[${index}].${source}`, source === "model_id" ? MAX_ID_CHARS : MAX_FIELD_CHARS);
    } else if (source === "unit_type") {
      if (value !== "indoor" && value !== "outdoor") {
        throw new AirconWriteValidationError(`operations[${index}].unit_type must be indoor or outdoor`);
      }
      result.unitType = value;
    } else {
      writable[target] = requiredString(
        value,
        `operations[${index}].${source}`,
        source === "id" || source.endsWith("_id") ? MAX_ID_CHARS : MAX_FIELD_CHARS,
      );
    }
  }

  for (const pair of definition.referencePairs) {
    const direct = pair.id in operation;
    const reference = pair.ref in operation;
    if (pair.optional && !direct && !reference) continue;
    if (direct === reference) {
      throw new AirconWriteValidationError(
        `operations[${index}] must contain exactly one of ${pair.id} or ${pair.ref}`,
      );
    }
  }

  if (type.startsWith("update_") && Object.keys(operation).length === 2) {
    throw new AirconWriteValidationError(`operations[${index}] must include a field to update`);
  }
  return result;
}

const fieldNames: Record<string, keyof AirconWriteOperation> = {
  id: "id", name: "name", address: "address", company_id: "companyId", company_ref: "companyRef",
  property_id: "propertyId", property_ref: "propertyRef", system_id: "systemId", system_ref: "systemRef",
  model_id: "modelId", model_ref: "modelRef", manufacturer: "manufacturer", model_number: "modelNumber",
  unit_type: "unitType",
};

type Definition = {
  allowed: string[];
  required: string[];
  referencePairs: Array<{ id: string; ref: string; optional?: boolean }>;
};

function definitionFor(type: AirconWriteOperationType): Definition {
  const withType = (fields: string[]) => ["type", ...fields];
  switch (type) {
    case "create_company": return { allowed: withType(["name"]), required: ["name"], referencePairs: [] };
    case "create_property": return { allowed: withType(["name", "company_id", "company_ref", "address"]), required: ["name"], referencePairs: [{ id: "company_id", ref: "company_ref" }] };
    case "create_system": return { allowed: withType(["name", "property_id", "property_ref"]), required: ["name"], referencePairs: [{ id: "property_id", ref: "property_ref" }] };
    case "create_model": return { allowed: withType(["manufacturer", "model_number"]), required: ["manufacturer", "model_number"], referencePairs: [] };
    case "create_unit": return { allowed: withType(["name", "unit_type", "system_id", "system_ref", "model_id", "model_ref"]), required: ["name", "unit_type"], referencePairs: [{ id: "system_id", ref: "system_ref" }, { id: "model_id", ref: "model_ref", optional: true }] };
    case "update_company": return { allowed: withType(["id", "name"]), required: ["id"], referencePairs: [] };
    case "update_property": return { allowed: withType(["id", "company_id", "name", "address"]), required: ["id"], referencePairs: [] };
    case "update_system": return { allowed: withType(["id", "property_id", "name"]), required: ["id"], referencePairs: [] };
    case "update_model": return { allowed: withType(["id", "manufacturer", "model_number"]), required: ["id"], referencePairs: [] };
    case "update_unit": return { allowed: withType(["id", "system_id", "model_id", "name", "unit_type"]), required: ["id"], referencePairs: [] };
  }
}

function validateReferences(operations: AirconWriteOperation[]) {
  const expected: Record<string, AirconWriteOperationType> = {
    companyRef: "create_company", propertyRef: "create_property", systemRef: "create_system", modelRef: "create_model",
  };
  for (const [index, operation] of operations.entries()) {
    for (const [field, requiredType] of Object.entries(expected) as Array<[keyof AirconWriteOperation, AirconWriteOperationType]>) {
      const reference = operation[field];
      if (reference === undefined) continue;
      if (typeof reference !== "number" || reference >= index || operations[reference]?.type !== requiredType) {
        throw new AirconWriteValidationError(`operations[${index}].${toSnake(field)} must reference an earlier ${requiredType}`);
      }
    }
  }
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AirconWriteValidationError(message);
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: string[]) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw new AirconWriteValidationError(`Unsupported field: ${unknown}`);
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new AirconWriteValidationError(`${label} must be 1-${maxLength} characters`);
  }
  return value.trim();
}

function nullableString(value: unknown, label: string, maxLength: number): string | null {
  return value === null ? null : requiredString(value, label, maxLength);
}

function isOperationType(value: unknown): value is AirconWriteOperationType {
  return typeof value === "string" && ["create_company", "create_property", "create_system", "create_model", "create_unit", "update_company", "update_property", "update_system", "update_model", "update_unit"].includes(value);
}

function toSnake(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}
