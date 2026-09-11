export class AirconSearchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AirconSearchValidationError";
  }
}

const MAX_QUERY_LENGTH = 200;
const MAX_ID_LENGTH = 200;

export interface NameSearchInput {
  query?: string;
}

export interface PropertySearchInput extends NameSearchInput {
  companyId?: string;
}

export interface SystemSearchInput extends NameSearchInput {
  propertyId?: string;
}

export interface UnitSearchInput extends NameSearchInput {
  systemId?: string;
}

export function parseNameSearch(value: unknown): NameSearchInput {
  const record = parseObject(value, ["query"]);
  return optionalString(record, "query", MAX_QUERY_LENGTH);
}

export function parsePropertySearch(value: unknown): PropertySearchInput {
  const record = parseObject(value, ["query", "company_id"]);
  return {
    ...optionalString(record, "query", MAX_QUERY_LENGTH),
    ...optionalMappedString(record, "company_id", "companyId", MAX_ID_LENGTH),
  };
}

export function parseSystemSearch(value: unknown): SystemSearchInput {
  const record = parseObject(value, ["query", "property_id"]);
  return {
    ...optionalString(record, "query", MAX_QUERY_LENGTH),
    ...optionalMappedString(record, "property_id", "propertyId", MAX_ID_LENGTH),
  };
}

export function parseUnitSearch(value: unknown): UnitSearchInput {
  const record = parseObject(value, ["query", "system_id"]);
  return {
    ...optionalString(record, "query", MAX_QUERY_LENGTH),
    ...optionalMappedString(record, "system_id", "systemId", MAX_ID_LENGTH),
  };
}

function parseObject(
  value: unknown,
  allowedKeys: string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AirconSearchValidationError("Request body must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.includes(key));
  if (unknownKey !== undefined) {
    throw new AirconSearchValidationError(`Unsupported field: ${unknownKey}`);
  }
  return record;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): Record<string, string> {
  return optionalMappedString(record, key, key, maxLength);
}

function optionalMappedString(
  record: Record<string, unknown>,
  sourceKey: string,
  outputKey: string,
  maxLength: number,
): Record<string, string> {
  const value = record[sourceKey];
  if (value === undefined) return {};
  if (typeof value !== "string") {
    throw new AirconSearchValidationError(`${sourceKey} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new AirconSearchValidationError(
      `${sourceKey} must be 1-${maxLength} characters`,
    );
  }
  return { [outputKey]: normalized };
}
