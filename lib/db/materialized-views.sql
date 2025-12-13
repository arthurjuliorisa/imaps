-- ============================================================================
-- MATERIALIZED VIEWS FOR INDONESIAN CUSTOMS COMPLIANCE REPORTS
-- ============================================================================
-- This file contains all 7 materialized views required for Indonesian customs
-- compliance reporting. These views aggregate data for monthly reporting.
--
-- Prerequisites:
-- - All source tables must exist (IncomingDocument, OutgoingDocument, etc.)
-- - Run this script after database migrations
--
-- Usage:
-- 1. Create views: psql -d your_db -f materialized-views.sql
-- 2. Refresh views: psql -d your_db -f refresh-views.sql
-- ============================================================================

-- ============================================================================
-- 1. LAPORAN PEMASUKAN (INCOMING REPORT)
-- ============================================================================
-- Summary of all incoming customs documents (BC 2.3, BC 4.0, etc.)
-- Aggregated monthly for compliance reporting
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_laporan_pemasukan CASCADE;

CREATE MATERIALIZED VIEW mv_laporan_pemasukan AS
SELECT
    -- Time dimension
    DATE_TRUNC('month', id."registerDate") AS month_period,
    EXTRACT(YEAR FROM id."registerDate")::INTEGER AS year,
    EXTRACT(MONTH FROM id."registerDate")::INTEGER AS month,

    -- Document information
    id."docCode" AS doc_code,
    id."registerNumber" AS register_number,
    id."registerDate" AS register_date,
    id."docNumber" AS doc_number,
    id."docDate" AS doc_date,

    -- Supplier/Shipper information
    id."shipperId" AS shipper_id,
    s."code" AS shipper_code,
    s."name" AS shipper_name,
    s."address" AS shipper_address,

    -- Item information
    id."itemId" AS item_id,
    i."code" AS item_code,
    i."name" AS item_name,

    -- Quantity and UOM
    id."quantity" AS quantity,
    id."uomId" AS uom_id,
    u."code" AS uom_code,
    u."name" AS uom_name,

    -- Financial information
    id."currencyId" AS currency_id,
    curr."code" AS currency_code,
    id."amount" AS amount,

    -- Audit fields
    id."createdAt" AS created_at,
    id."updatedAt" AS updated_at,
    id."id" AS document_id

FROM "IncomingDocument" id
INNER JOIN "Supplier" s ON id."shipperId" = s."id"
INNER JOIN "Item" i ON id."itemId" = i."id"
INNER JOIN "UOM" u ON id."uomId" = u."id"
INNER JOIN "Currency" curr ON id."currencyId" = curr."id"
ORDER BY id."registerDate" DESC, id."docCode", id."docNumber";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_laporan_pemasukan_unique
ON mv_laporan_pemasukan (document_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_laporan_pemasukan_month ON mv_laporan_pemasukan (month_period);
CREATE INDEX idx_mv_laporan_pemasukan_year_month ON mv_laporan_pemasukan (year, month);
CREATE INDEX idx_mv_laporan_pemasukan_item ON mv_laporan_pemasukan (item_id);
CREATE INDEX idx_mv_laporan_pemasukan_shipper ON mv_laporan_pemasukan (shipper_id);
CREATE INDEX idx_mv_laporan_pemasukan_doc_code ON mv_laporan_pemasukan (doc_code);

COMMENT ON MATERIALIZED VIEW mv_laporan_pemasukan IS 'Monthly aggregated incoming document report for Indonesian customs compliance (BC 2.3, BC 4.0)';

-- ============================================================================
-- 2. LAPORAN PENGELUARAN (OUTGOING REPORT)
-- ============================================================================
-- Summary of all outgoing customs documents (BC 2.5, BC 3.0, etc.)
-- Aggregated monthly for compliance reporting
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_laporan_pengeluaran CASCADE;

CREATE MATERIALIZED VIEW mv_laporan_pengeluaran AS
SELECT
    -- Time dimension
    DATE_TRUNC('month', od."registerDate") AS month_period,
    EXTRACT(YEAR FROM od."registerDate")::INTEGER AS year,
    EXTRACT(MONTH FROM od."registerDate")::INTEGER AS month,

    -- Document information
    od."docCode" AS doc_code,
    od."registerNumber" AS register_number,
    od."registerDate" AS register_date,
    od."docNumber" AS doc_number,
    od."docDate" AS doc_date,

    -- Customer/Recipient information
    od."recipientId" AS recipient_id,
    c."code" AS recipient_code,
    c."name" AS recipient_name,
    c."address" AS recipient_address,

    -- Item information
    od."itemId" AS item_id,
    i."code" AS item_code,
    i."name" AS item_name,

    -- Quantity and UOM
    od."quantity" AS quantity,
    od."uomId" AS uom_id,
    u."code" AS uom_code,
    u."name" AS uom_name,

    -- Financial information
    od."currencyId" AS currency_id,
    curr."code" AS currency_code,
    od."amount" AS amount,

    -- Audit fields
    od."createdAt" AS created_at,
    od."updatedAt" AS updated_at,
    od."id" AS document_id

FROM "OutgoingDocument" od
INNER JOIN "Customer" c ON od."recipientId" = c."id"
INNER JOIN "Item" i ON od."itemId" = i."id"
INNER JOIN "UOM" u ON od."uomId" = u."id"
INNER JOIN "Currency" curr ON od."currencyId" = curr."id"
ORDER BY od."registerDate" DESC, od."docCode", od."docNumber";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_laporan_pengeluaran_unique
ON mv_laporan_pengeluaran (document_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_laporan_pengeluaran_month ON mv_laporan_pengeluaran (month_period);
CREATE INDEX idx_mv_laporan_pengeluaran_year_month ON mv_laporan_pengeluaran (year, month);
CREATE INDEX idx_mv_laporan_pengeluaran_item ON mv_laporan_pengeluaran (item_id);
CREATE INDEX idx_mv_laporan_pengeluaran_recipient ON mv_laporan_pengeluaran (recipient_id);
CREATE INDEX idx_mv_laporan_pengeluaran_doc_code ON mv_laporan_pengeluaran (doc_code);

COMMENT ON MATERIALIZED VIEW mv_laporan_pengeluaran IS 'Monthly aggregated outgoing document report for Indonesian customs compliance (BC 2.5, BC 3.0)';

-- ============================================================================
-- 3. MUTASI BAHAN BAKU (RAW MATERIAL MUTATION)
-- ============================================================================
-- Monthly mutation report for raw materials showing stock movements
-- Includes beginning balance, incoming, outgoing, adjustments, and ending balance
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_mutasi_bahan_baku CASCADE;

CREATE MATERIALIZED VIEW mv_mutasi_bahan_baku AS
SELECT
    -- Time dimension
    DATE_TRUNC('month', rm."date") AS month_period,
    EXTRACT(YEAR FROM rm."date")::INTEGER AS year,
    EXTRACT(MONTH FROM rm."date")::INTEGER AS month,
    rm."date" AS mutation_date,

    -- Item information
    rm."itemId" AS item_id,
    i."code" AS item_code,
    i."name" AS item_name,

    -- UOM information
    rm."uomId" AS uom_id,
    u."code" AS uom_code,
    u."name" AS uom_name,

    -- Stock movements
    rm."beginning" AS beginning_stock,
    rm."incoming" AS incoming,
    rm."outgoing" AS outgoing,
    rm."adjustment" AS adjustment,
    rm."ending" AS ending_stock,

    -- Stock opname and variance
    rm."stockOpname" AS stock_opname,
    rm."variant" AS variance,

    -- Additional information
    rm."remarks" AS remarks,
    rm."createdAt" AS created_at,
    rm."updatedAt" AS updated_at,
    rm."id" AS mutation_id

FROM "RawMaterialMutation" rm
INNER JOIN "Item" i ON rm."itemId" = i."id"
INNER JOIN "UOM" u ON rm."uomId" = u."id"
ORDER BY rm."date" DESC, i."code";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_mutasi_bahan_baku_unique
ON mv_mutasi_bahan_baku (mutation_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_mutasi_bahan_baku_month ON mv_mutasi_bahan_baku (month_period);
CREATE INDEX idx_mv_mutasi_bahan_baku_year_month ON mv_mutasi_bahan_baku (year, month);
CREATE INDEX idx_mv_mutasi_bahan_baku_item ON mv_mutasi_bahan_baku (item_id);
CREATE INDEX idx_mv_mutasi_bahan_baku_date ON mv_mutasi_bahan_baku (mutation_date);

COMMENT ON MATERIALIZED VIEW mv_mutasi_bahan_baku IS 'Monthly raw material mutation report showing stock movements for customs compliance';

-- ============================================================================
-- 4. POSISI WIP (WORK IN PROGRESS POSITION)
-- ============================================================================
-- WIP position report showing semi-finished goods in production
-- Required for customs monitoring of production process
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_posisi_wip CASCADE;

CREATE MATERIALIZED VIEW mv_posisi_wip AS
SELECT
    -- Time dimension
    DATE_TRUNC('month', w."date") AS month_period,
    EXTRACT(YEAR FROM w."date")::INTEGER AS year,
    EXTRACT(MONTH FROM w."date")::INTEGER AS month,
    w."date" AS record_date,

    -- Item information
    w."itemId" AS item_id,
    i."code" AS item_code,
    i."name" AS item_name,

    -- UOM information
    w."uomId" AS uom_id,
    u."code" AS uom_code,
    u."name" AS uom_name,

    -- WIP quantity
    w."quantity" AS wip_quantity,

    -- Additional information
    w."remarks" AS remarks,
    w."createdAt" AS created_at,
    w."updatedAt" AS updated_at,
    w."id" AS wip_record_id

FROM "WIPRecord" w
INNER JOIN "Item" i ON w."itemId" = i."id"
INNER JOIN "UOM" u ON w."uomId" = u."id"
ORDER BY w."date" DESC, i."code";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_posisi_wip_unique
ON mv_posisi_wip (wip_record_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_posisi_wip_month ON mv_posisi_wip (month_period);
CREATE INDEX idx_mv_posisi_wip_year_month ON mv_posisi_wip (year, month);
CREATE INDEX idx_mv_posisi_wip_item ON mv_posisi_wip (item_id);
CREATE INDEX idx_mv_posisi_wip_date ON mv_posisi_wip (record_date);

COMMENT ON MATERIALIZED VIEW mv_posisi_wip IS 'WIP (Work In Progress) position report for monitoring semi-finished goods in production';

-- ============================================================================
-- 5. MUTASI FINISHED GOODS (FINISHED GOODS MUTATION)
-- ============================================================================
-- Monthly mutation report for finished goods showing stock movements
-- Includes beginning balance, production, shipment, and ending balance
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_mutasi_finished_goods CASCADE;

CREATE MATERIALIZED VIEW mv_mutasi_finished_goods AS
SELECT
    -- Time dimension
    DATE_TRUNC('month', pm."date") AS month_period,
    EXTRACT(YEAR FROM pm."date")::INTEGER AS year,
    EXTRACT(MONTH FROM pm."date")::INTEGER AS month,
    pm."date" AS mutation_date,

    -- Item information
    pm."itemId" AS item_id,
    i."code" AS item_code,
    i."name" AS item_name,

    -- UOM information
    pm."uomId" AS uom_id,
    u."code" AS uom_code,
    u."name" AS uom_name,

    -- Stock movements
    pm."beginning" AS beginning_stock,
    pm."incoming" AS incoming,  -- Production
    pm."outgoing" AS outgoing,  -- Shipment
    pm."adjustment" AS adjustment,
    pm."ending" AS ending_stock,

    -- Stock opname and variance
    pm."stockOpname" AS stock_opname,
    pm."variant" AS variance,

    -- Additional information
    pm."remarks" AS remarks,
    pm."createdAt" AS created_at,
    pm."updatedAt" AS updated_at,
    pm."id" AS mutation_id

FROM "ProductionMutation" pm
INNER JOIN "Item" i ON pm."itemId" = i."id"
INNER JOIN "UOM" u ON pm."uomId" = u."id"
ORDER BY pm."date" DESC, i."code";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_mutasi_finished_goods_unique
ON mv_mutasi_finished_goods (mutation_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_mutasi_finished_goods_month ON mv_mutasi_finished_goods (month_period);
CREATE INDEX idx_mv_mutasi_finished_goods_year_month ON mv_mutasi_finished_goods (year, month);
CREATE INDEX idx_mv_mutasi_finished_goods_item ON mv_mutasi_finished_goods (item_id);
CREATE INDEX idx_mv_mutasi_finished_goods_date ON mv_mutasi_finished_goods (mutation_date);

COMMENT ON MATERIALIZED VIEW mv_mutasi_finished_goods IS 'Monthly finished goods mutation report showing production and shipment movements';

-- ============================================================================
-- 6. MUTASI CAPITAL GOODS (CAPITAL GOODS MUTATION)
-- ============================================================================
-- Monthly mutation report for capital goods (machinery, equipment)
-- Required for tracking imported capital goods under customs bonded zone
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_mutasi_capital_goods CASCADE;

CREATE MATERIALIZED VIEW mv_mutasi_capital_goods AS
SELECT
    -- Time dimension
    DATE_TRUNC('month', cg."date") AS month_period,
    EXTRACT(YEAR FROM cg."date")::INTEGER AS year,
    EXTRACT(MONTH FROM cg."date")::INTEGER AS month,
    cg."date" AS mutation_date,

    -- Item information
    cg."itemId" AS item_id,
    i."code" AS item_code,
    i."name" AS item_name,

    -- UOM information
    cg."uomId" AS uom_id,
    u."code" AS uom_code,
    u."name" AS uom_name,

    -- Stock movements
    cg."beginning" AS beginning_stock,
    cg."incoming" AS incoming,  -- Procurement
    cg."outgoing" AS outgoing,  -- Disposal/Transfer
    cg."adjustment" AS adjustment,
    cg."ending" AS ending_stock,

    -- Stock opname and variance
    cg."stockOpname" AS stock_opname,
    cg."variant" AS variance,

    -- Additional information
    cg."remarks" AS remarks,
    cg."createdAt" AS created_at,
    cg."updatedAt" AS updated_at,
    cg."id" AS mutation_id

FROM "CapitalGoodsMutation" cg
INNER JOIN "Item" i ON cg."itemId" = i."id"
INNER JOIN "UOM" u ON cg."uomId" = u."id"
ORDER BY cg."date" DESC, i."code";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_mutasi_capital_goods_unique
ON mv_mutasi_capital_goods (mutation_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_mutasi_capital_goods_month ON mv_mutasi_capital_goods (month_period);
CREATE INDEX idx_mv_mutasi_capital_goods_year_month ON mv_mutasi_capital_goods (year, month);
CREATE INDEX idx_mv_mutasi_capital_goods_item ON mv_mutasi_capital_goods (item_id);
CREATE INDEX idx_mv_mutasi_capital_goods_date ON mv_mutasi_capital_goods (mutation_date);

COMMENT ON MATERIALIZED VIEW mv_mutasi_capital_goods IS 'Monthly capital goods mutation report for tracking machinery and equipment under customs supervision';

-- ============================================================================
-- 7. MUTASI SCRAP (SCRAP MUTATION)
-- ============================================================================
-- Monthly mutation report for scrap materials
-- Required for tracking waste and scrap disposal under customs regulations
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_mutasi_scrap CASCADE;

CREATE MATERIALIZED VIEW mv_mutasi_scrap AS
SELECT
    -- Time dimension
    DATE_TRUNC('month', sm."date") AS month_period,
    EXTRACT(YEAR FROM sm."date")::INTEGER AS year,
    EXTRACT(MONTH FROM sm."date")::INTEGER AS month,
    sm."date" AS mutation_date,

    -- Scrap information
    sm."scrapId" AS scrap_id,
    s."code" AS scrap_code,
    s."name" AS scrap_name,
    s."description" AS scrap_description,

    -- UOM information
    sm."uomId" AS uom_id,
    u."code" AS uom_code,
    u."name" AS uom_name,

    -- Stock movements
    sm."beginning" AS beginning_stock,
    sm."incoming" AS incoming,  -- Generated scrap
    sm."outgoing" AS outgoing,  -- Disposed/Sold
    sm."adjustment" AS adjustment,
    sm."ending" AS ending_stock,

    -- Stock opname and variance
    sm."stockOpname" AS stock_opname,
    sm."variant" AS variance,

    -- Additional information
    sm."remarks" AS remarks,
    sm."createdAt" AS created_at,
    sm."updatedAt" AS updated_at,
    sm."id" AS mutation_id

FROM "ScrapMutation" sm
INNER JOIN "ScrapMaster" s ON sm."scrapId" = s."id"
INNER JOIN "UOM" u ON sm."uomId" = u."id"
ORDER BY sm."date" DESC, s."code";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_mutasi_scrap_unique
ON mv_mutasi_scrap (mutation_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_mutasi_scrap_month ON mv_mutasi_scrap (month_period);
CREATE INDEX idx_mv_mutasi_scrap_year_month ON mv_mutasi_scrap (year, month);
CREATE INDEX idx_mv_mutasi_scrap_scrap ON mv_mutasi_scrap (scrap_id);
CREATE INDEX idx_mv_mutasi_scrap_date ON mv_mutasi_scrap (mutation_date);

COMMENT ON MATERIALIZED VIEW mv_mutasi_scrap IS 'Monthly scrap mutation report for tracking waste and scrap disposal under customs regulations';

-- ============================================================================
-- MATERIALIZED VIEW STATISTICS
-- ============================================================================
-- Analyze the materialized views for query optimization
-- Run this after initial creation and after each refresh
-- ============================================================================

ANALYZE mv_laporan_pemasukan;
ANALYZE mv_laporan_pengeluaran;
ANALYZE mv_mutasi_bahan_baku;
ANALYZE mv_posisi_wip;
ANALYZE mv_mutasi_finished_goods;
ANALYZE mv_mutasi_capital_goods;
ANALYZE mv_mutasi_scrap;

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'All 7 materialized views have been created successfully!';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE '1. mv_laporan_pemasukan - Incoming documents report';
    RAISE NOTICE '2. mv_laporan_pengeluaran - Outgoing documents report';
    RAISE NOTICE '3. mv_mutasi_bahan_baku - Raw material mutation report';
    RAISE NOTICE '4. mv_posisi_wip - WIP position report';
    RAISE NOTICE '5. mv_mutasi_finished_goods - Finished goods mutation report';
    RAISE NOTICE '6. mv_mutasi_capital_goods - Capital goods mutation report';
    RAISE NOTICE '7. mv_mutasi_scrap - Scrap mutation report';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Run refresh-views.sql to populate the views with data';
    RAISE NOTICE '2. Schedule regular refreshes (daily/weekly) for up-to-date reporting';
    RAISE NOTICE '3. Use the API endpoint to trigger manual refreshes when needed';
    RAISE NOTICE '============================================================================';
END $$;
