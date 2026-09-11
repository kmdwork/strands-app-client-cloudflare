-- Idempotent sample data for migrations/0002_create_aircon_management_tables.sql.
-- Fixed sample-* IDs let this file be executed repeatedly without duplicates.

INSERT INTO "companies" ("id", "name", "createdAt", "updatedAt")
VALUES
    ('sample-company-kamada', 'カマダ設備株式会社', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('sample-company-demo', 'デモ施設管理株式会社', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT("id") DO UPDATE SET
    "name" = excluded."name",
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "properties" (
    "id", "companyId", "name", "address", "createdAt", "updatedAt"
)
VALUES
    (
        'sample-property-tokyo',
        'sample-company-kamada',
        '東京本社',
        '東京都千代田区丸の内1-1-1',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-property-yokohama',
        'sample-company-kamada',
        '横浜営業所',
        '神奈川県横浜市西区みなとみらい1-1-1',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-property-osaka',
        'sample-company-demo',
        '大阪テストビル',
        '大阪府大阪市北区梅田1-1-1',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
ON CONFLICT("id") DO UPDATE SET
    "companyId" = excluded."companyId",
    "name" = excluded."name",
    "address" = excluded."address",
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "systems" (
    "id", "propertyId", "name", "createdAt", "updatedAt"
)
VALUES
    (
        'sample-system-tokyo-3f-east',
        'sample-property-tokyo',
        '3階 東系統',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-system-tokyo-3f-west',
        'sample-property-tokyo',
        '3階 西系統',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-system-yokohama-1f',
        'sample-property-yokohama',
        '1階 事務所系統',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-system-osaka-2f',
        'sample-property-osaka',
        '2階 テスト系統',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
ON CONFLICT("id") DO UPDATE SET
    "propertyId" = excluded."propertyId",
    "name" = excluded."name",
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "airconModels" (
    "id", "modelNumber", "manufacturer", "createdAt", "updatedAt"
)
VALUES
    (
        'sample-model-daikin-outdoor',
        'RZRP140BY',
        'ダイキン工業',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-model-daikin-indoor',
        'FXYFP71NB',
        'ダイキン工業',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-model-mitsubishi-outdoor',
        'PUZ-ZRMP140KA14',
        '三菱電機',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-model-mitsubishi-indoor',
        'PL-ZRP71EA9',
        '三菱電機',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
ON CONFLICT("id") DO UPDATE SET
    "modelNumber" = excluded."modelNumber",
    "manufacturer" = excluded."manufacturer",
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "units" (
    "id",
    "systemId",
    "airconModelId",
    "name",
    "unitType",
    "createdAt",
    "updatedAt"
)
VALUES
    (
        'sample-unit-tokyo-east-outdoor-1',
        'sample-system-tokyo-3f-east',
        'sample-model-daikin-outdoor',
        '室外機1',
        'outdoor',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-unit-tokyo-east-indoor-1',
        'sample-system-tokyo-3f-east',
        'sample-model-daikin-indoor',
        '会議室A 室内機',
        'indoor',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-unit-tokyo-west-indoor-1',
        'sample-system-tokyo-3f-west',
        'sample-model-daikin-indoor',
        '執務室西 室内機',
        'indoor',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-unit-yokohama-outdoor-1',
        'sample-system-yokohama-1f',
        'sample-model-mitsubishi-outdoor',
        '横浜 室外機1',
        'outdoor',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-unit-yokohama-indoor-1',
        'sample-system-yokohama-1f',
        'sample-model-mitsubishi-indoor',
        '事務所 室内機1',
        'indoor',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'sample-unit-osaka-unassigned-model',
        'sample-system-osaka-2f',
        NULL,
        '型式未登録 室内機',
        'indoor',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
ON CONFLICT("id") DO UPDATE SET
    "systemId" = excluded."systemId",
    "airconModelId" = excluded."airconModelId",
    "name" = excluded."name",
    "unitType" = excluded."unitType",
    "updatedAt" = CURRENT_TIMESTAMP;
