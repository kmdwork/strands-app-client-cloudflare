INSERT INTO "companies" (
    "id",
    "name",
    "createdAt",
    "updatedAt"
) VALUES (
    'company-001',
    'テスト株式会社',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT INTO "properties" (
    "id",
    "companyId",
    "name",
    "address",
    "createdAt",
    "updatedAt"
) VALUES (
    'property-001',
    'company-001',
    '東京本社',
    '東京都千代田区',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT INTO "systems" (
    "id",
    "propertyId",
    "name",
    "createdAt",
    "updatedAt"
) VALUES (
    'system-001',
    'property-001',
    '1階 空調設備',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT INTO "units" (
    "id",
    "systemId",
    "name",
    "unitType",
    "manufacturer",
    "modelNumber",
    "createdAt",
    "updatedAt"
) VALUES (
    'unit-001',
    'system-001',
    '室外機1',
    'outdoor',
    'Daikin',
    'RXYP140FA',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT INTO "units" (
    "id",
    "systemId",
    "name",
    "unitType",
    "manufacturer",
    "modelNumber",
    "createdAt",
    "updatedAt"
) VALUES (
    'unit-002',
    'system-001',
    '室内機1',
    'indoor',
    'Daikin',
    'FXYFP71NB',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);