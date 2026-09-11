-- Migration number: 0002 	 2026-09-11T00:20:36.728Z

CREATE TABLE IF NOT EXISTS "companies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "properties" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL REFERENCES "companies" ("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "systems" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL REFERENCES "properties" ("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "airconModels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelNumber" TEXT NOT NULL UNIQUE,
    "manufacturer" TEXT NOT NULL,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "units" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "systemId" TEXT NOT NULL REFERENCES "systems" ("id") ON DELETE CASCADE,
    "airconModelId" TEXT REFERENCES "airconModels" ("id") ON DELETE SET NULL,
    "name" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_properties_companyId"
    ON "properties" ("companyId");

CREATE INDEX IF NOT EXISTS "idx_systems_propertyId"
    ON "systems" ("propertyId");

CREATE INDEX IF NOT EXISTS "idx_units_systemId"
    ON "units" ("systemId");

CREATE INDEX IF NOT EXISTS "idx_units_airconModelId"
    ON "units" ("airconModelId");

CREATE INDEX IF NOT EXISTS "idx_airconModels_modelNumber"
    ON "airconModels" ("modelNumber");