-- ============================================================================
-- MATERIALIZED VIEWS V2.0 FOR INDONESIAN CUSTOMS COMPLIANCE REPORTS
-- ============================================================================
-- This file contains all 7 materialized views required for Indonesian customs
-- compliance reporting using the NEW SCHEMA (v2.0) based on StockDailySnapshot
-- and new transaction tables.
--
-- Schema v2.0 uses:
-- - IncomingHeader/IncomingDetail (replacing IncomingDocument)
-- - OutgoingHeader/OutgoingDetail (replacing OutgoingDocument)
-- - StockDailySnapshot (replacing individual mutation tables)
-- - MaterialUsageHeader/MaterialUsageDetail
-- - FinishedGoodsProductionHeader/FinishedGoodsProductionDetail
-- - WipBalance
-- - Adjustment
--
-- Prerequisites:
-- - All source tables must exist (schema v2.0)
-- - Run this script after database migrations
--
-- Usage:
-- 1. Create views: psql -d your_db -f materialized-views-v2.sql
-- 2. Refresh views: Use /api/admin/refresh-views endpoint or refresh-views.sql
-- ============================================================================

-- ============================================================================
-- 1. LAPORAN PEMASUKAN (INCOMING REPORT)
-- ============================================================================
-- Summary of all incoming customs documents (BC 2.3, BC 2.5, BC 2.7, BC 4.0)
-- Source: IncomingHeader + IncomingDetail
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_laporan_pemasukan CASCADE;

CREATE MATERIALIZED VIEW mv_laporan_pemasukan AS
SELECT
    -- Time dimension
    DATE_TRUNC('month', h."incomingDate") AS month_period,
    EXTRACT(YEAR FROM h."incomingDate")::INTEGER AS year,
    EXTRACT(MONTH FROM h."incomingDate")::INTEGER AS month,

    -- Document information
    h."customsDocumentType" AS doc_code,
    h."ppkekNumber" AS register_number,
    h."customsRegistrationDate" AS register_date,
    h."incomingEvidenceNumber" AS doc_number,
    h."incomingDate" AS doc_date,

    -- Supplier/Shipper information
    h."shipperCode" AS shipper_code,
    h."shipperName" AS shipper_name,

    -- Item information
    d."itemCode" AS item_code,
    d."itemName" AS item_name,
    d."itemTypeCode" AS item_type_code,

    -- Quantity and UOM
    d.qty AS quantity,
    d.uom AS uom_code,

    -- Financial information
    h.currency AS currency_code,
    h."totalAmount" AS amount,

    -- Company information
    h."companyCode" AS company_code,

    -- Audit fields
    d."createdAt" AS created_at,
    d."updatedAt" AS updated_at,
    d.id AS detail_id,
    h.id AS header_id

FROM "IncomingHeader" h
INNER JOIN "IncomingDetail" d ON h.id = d."headerId" AND h."trxDate" = d."trxDate"
ORDER BY h."incomingDate" DESC, h."customsDocumentType", h."ppkekNumber";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_laporan_pemasukan_v2_unique
ON mv_laporan_pemasukan (detail_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_laporan_pemasukan_v2_month ON mv_laporan_pemasukan (month_period);
CREATE INDEX idx_mv_laporan_pemasukan_v2_year_month ON mv_laporan_pemasukan (year, month);
CREATE INDEX idx_mv_laporan_pemasukan_v2_item ON mv_laporan_pemasukan (item_code);
CREATE INDEX idx_mv_laporan_pemasukan_v2_shipper ON mv_laporan_pemasukan (shipper_code);
CREATE INDEX idx_mv_laporan_pemasukan_v2_doc_code ON mv_laporan_pemasukan (doc_code);
CREATE INDEX idx_mv_laporan_pemasukan_v2_company ON mv_laporan_pemasukan (company_code);

COMMENT ON MATERIALIZED VIEW mv_laporan_pemasukan IS 'V2: Monthly aggregated incoming document report for Indonesian customs compliance (BC 2.3, BC 2.5, BC 2.7, BC 4.0)';

-- ============================================================================
-- 2. LAPORAN PENGELUARAN (OUTGOING REPORT)
-- ============================================================================
-- Summary of all outgoing customs documents (BC 3.0, BC 4.0, BC 4.1)
-- Source: OutgoingHeader + OutgoingDetail
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_laporan_pengeluaran CASCADE;

CREATE MATERIALIZED VIEW mv_laporan_pengeluaran AS
SELECT
    -- Time dimension
    DATE_TRUNC('month', h."outgoingDate") AS month_period,
    EXTRACT(YEAR FROM h."outgoingDate")::INTEGER AS year,
    EXTRACT(MONTH FROM h."outgoingDate")::INTEGER AS month,

    -- Document information
    h."customsDocumentType" AS doc_code,
    h."ppkekNumber" AS register_number,
    h."customsRegistrationDate" AS register_date,
    h."outgoingEvidenceNumber" AS doc_number,
    h."outgoingDate" AS doc_date,

    -- Customer/Recipient information
    h."recipientCode",
    h."recipientName",

    -- Item information
    d."itemCode",
    d."itemName",
    d."itemTypeCode",

    -- Quantity and UOM
    d.qty AS quantity,
    d.uom AS uom_code,

    -- Financial information
    h.currency AS currency_code,
    h."totalAmount" AS amount,

    -- Company information
    h."companyCode",

    -- Audit fields
    d."createdAt",
    d."updatedAt",
    d.id AS detail_id,
    h.id AS header_id

FROM "OutgoingHeader" h
INNER JOIN "OutgoingDetail" d ON h.id = d."headerId" AND h."trxDate" = d."trxDate"
ORDER BY h."outgoingDate" DESC, h."customsDocumentType", h."ppkekNumber";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_laporan_pengeluaran_v2_unique
ON mv_laporan_pengeluaran (detail_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_laporan_pengeluaran_v2_month ON mv_laporan_pengeluaran (month_period);
CREATE INDEX idx_mv_laporan_pengeluaran_v2_year_month ON mv_laporan_pengeluaran (year, month);
CREATE INDEX idx_mv_laporan_pengeluaran_v2_item ON mv_laporan_pengeluaran (item_code);
CREATE INDEX idx_mv_laporan_pengeluaran_v2_recipient ON mv_laporan_pengeluaran (recipient_code);
CREATE INDEX idx_mv_laporan_pengeluaran_v2_doc_code ON mv_laporan_pengeluaran (doc_code);
CREATE INDEX idx_mv_laporan_pengeluaran_v2_company ON mv_laporan_pengeluaran (company_code);

COMMENT ON MATERIALIZED VIEW mv_laporan_pengeluaran IS 'V2: Monthly aggregated outgoing document report for Indonesian customs compliance (BC 3.0, BC 4.0, BC 4.1)';

-- ============================================================================
-- 3. MUTASI BAHAN BAKU (RAW MATERIAL MUTATION)
-- ============================================================================
-- Monthly mutation report for raw materials (ROH) showing stock movements
-- Source: StockDailySnapshot WHERE item_type_code = 'ROH'
-- Aggregated by month with opening, incoming, usage, adjustment, closing
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_mutasi_bahan_baku CASCADE;

CREATE MATERIALIZED VIEW mv_mutasi_bahan_baku AS
WITH monthly_aggregation AS (
    SELECT
        "companyCode",
        "itemCode",
        "itemName",
        uom,
        DATE_TRUNC('month', "snapshotDate") AS month_period,
        MIN("snapshotDate") AS first_date,
        MAX("snapshotDate") AS last_date,

        -- Opening balance: first day of month
        (SELECT "openingBalance" FROM "StockDailySnapshot" s2
         WHERE s2."companyCode" = s."companyCode"
           AND s2."itemCode" = s."itemCode"
           AND s2."snapshotDate" = MIN(s."snapshotDate")
         LIMIT 1) AS beginning_stock,

        -- Sum of movements during month
        SUM(COALESCE("incomingQty", 0)) AS incoming,
        SUM(COALESCE("materialUsageQty", 0)) AS outgoing,
        SUM(COALESCE("adjustmentQty", 0)) AS adjustment,

        -- Closing balance: last day of month
        (SELECT "closingBalance" FROM "StockDailySnapshot" s3
         WHERE s3."companyCode" = s."companyCode"
           AND s3."itemCode" = s."itemCode"
           AND s3."snapshotDate" = MAX(s."snapshotDate")
         LIMIT 1) AS ending_stock

    FROM "StockDailySnapshot" s
    WHERE "itemTypeCode" = 'ROH'
    GROUP BY "companyCode", "itemCode", "itemName", uom, DATE_TRUNC('month', "snapshotDate")
)
SELECT
    month_period,
    EXTRACT(YEAR FROM month_period)::INTEGER AS year,
    EXTRACT(MONTH FROM month_period)::INTEGER AS month,
    "companyCode" AS company_code,
    "itemCode" AS item_code,
    "itemName" AS item_name,
    uom AS uom_code,
    beginning_stock,
    incoming,
    outgoing,
    adjustment,
    ending_stock,
    NULL::NUMERIC(15,2) AS stock_opname,  -- To be filled manually if needed
    NULL::NUMERIC(15,2) AS variance,      -- Calculated as stock_opname - ending_stock
    first_date AS period_start,
    last_date AS period_end,
    ROW_NUMBER() OVER (ORDER BY month_period DESC, "companyCode", "itemCode") AS row_id
FROM monthly_aggregation
ORDER BY month_period DESC, "companyCode", "itemCode";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_mutasi_bahan_baku_v2_unique
ON mv_mutasi_bahan_baku (row_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_mutasi_bahan_baku_v2_month ON mv_mutasi_bahan_baku (month_period);
CREATE INDEX idx_mv_mutasi_bahan_baku_v2_year_month ON mv_mutasi_bahan_baku (year, month);
CREATE INDEX idx_mv_mutasi_bahan_baku_v2_item ON mv_mutasi_bahan_baku (item_code);
CREATE INDEX idx_mv_mutasi_bahan_baku_v2_company ON mv_mutasi_bahan_baku (company_code);

COMMENT ON MATERIALIZED VIEW mv_mutasi_bahan_baku IS 'V2: Monthly raw material (ROH) mutation report from StockDailySnapshot';

-- ============================================================================
-- 4. POSISI WIP (WORK IN PROGRESS POSITION)
-- ============================================================================
-- WIP position report showing semi-finished goods (HALB)
-- Source: StockDailySnapshot WHERE item_type_code = 'HALB' + WipBalance
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_posisi_wip CASCADE;

CREATE MATERIALIZED VIEW mv_posisi_wip AS
SELECT
    -- Time dimension
    DATE_TRUNC('month', "snapshotDate") AS month_period,
    EXTRACT(YEAR FROM "snapshotDate")::INTEGER AS year,
    EXTRACT(MONTH FROM "snapshotDate")::INTEGER AS month,
    "snapshotDate" AS record_date,

    -- Company and item information
    "companyCode" AS company_code,
    "itemCode" AS item_code,
    "itemName" AS item_name,
    uom AS uom_code,

    -- WIP quantity (from WIP snapshot, not transaction calculation)
    "wipBalanceQty" AS wip_quantity,
    "closingBalance" AS ending_stock,

    -- Metadata
    "calculationMethod" AS calculation_method,
    "calculatedAt" AS calculated_at,
    id AS snapshot_id

FROM "StockDailySnapshot"
WHERE "itemTypeCode" = 'HALB'
ORDER BY "snapshotDate" DESC, "companyCode", "itemCode";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_posisi_wip_v2_unique
ON mv_posisi_wip (snapshot_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_posisi_wip_v2_month ON mv_posisi_wip (month_period);
CREATE INDEX idx_mv_posisi_wip_v2_year_month ON mv_posisi_wip (year, month);
CREATE INDEX idx_mv_posisi_wip_v2_item ON mv_posisi_wip (item_code);
CREATE INDEX idx_mv_posisi_wip_v2_date ON mv_posisi_wip (record_date);
CREATE INDEX idx_mv_posisi_wip_v2_company ON mv_posisi_wip (company_code);

COMMENT ON MATERIALIZED VIEW mv_posisi_wip IS 'V2: WIP (Work In Progress) position report from StockDailySnapshot for HALB items';

-- ============================================================================
-- 5. MUTASI FINISHED GOODS (FINISHED GOODS MUTATION)
-- ============================================================================
-- Monthly mutation report for finished goods (FERT)
-- Source: StockDailySnapshot WHERE item_type_code = 'FERT'
-- Shows production incoming and shipment outgoing
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_mutasi_finished_goods CASCADE;

CREATE MATERIALIZED VIEW mv_mutasi_finished_goods AS
WITH monthly_aggregation AS (
    SELECT
        "companyCode",
        "itemCode",
        "itemName",
        uom,
        DATE_TRUNC('month', "snapshotDate") AS month_period,
        MIN("snapshotDate") AS first_date,
        MAX("snapshotDate") AS last_date,

        -- Opening balance: first day of month
        (SELECT "openingBalance" FROM "StockDailySnapshot" s2
         WHERE s2."companyCode" = s."companyCode"
           AND s2."itemCode" = s."itemCode"
           AND s2."snapshotDate" = MIN(s."snapshotDate")
         LIMIT 1) AS beginning_stock,

        -- Sum of movements during month
        SUM(COALESCE("productionQty", 0)) AS incoming,  -- Production
        SUM(COALESCE("outgoingQty", 0)) AS outgoing,    -- Shipment
        SUM(COALESCE("adjustmentQty", 0)) AS adjustment,

        -- Closing balance: last day of month
        (SELECT "closingBalance" FROM "StockDailySnapshot" s3
         WHERE s3."companyCode" = s."companyCode"
           AND s3."itemCode" = s."itemCode"
           AND s3."snapshotDate" = MAX(s."snapshotDate")
         LIMIT 1) AS ending_stock

    FROM "StockDailySnapshot" s
    WHERE "itemTypeCode" = 'FERT'
    GROUP BY "companyCode", "itemCode", "itemName", uom, DATE_TRUNC('month', "snapshotDate")
)
SELECT
    month_period,
    EXTRACT(YEAR FROM month_period)::INTEGER AS year,
    EXTRACT(MONTH FROM month_period)::INTEGER AS month,
    "companyCode" AS company_code,
    "itemCode" AS item_code,
    "itemName" AS item_name,
    uom AS uom_code,
    beginning_stock,
    incoming,
    outgoing,
    adjustment,
    ending_stock,
    NULL::NUMERIC(15,2) AS stock_opname,
    NULL::NUMERIC(15,2) AS variance,
    first_date AS period_start,
    last_date AS period_end,
    ROW_NUMBER() OVER (ORDER BY month_period DESC, "companyCode", "itemCode") AS row_id
FROM monthly_aggregation
ORDER BY month_period DESC, "companyCode", "itemCode";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_mutasi_finished_goods_v2_unique
ON mv_mutasi_finished_goods (row_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_mutasi_finished_goods_v2_month ON mv_mutasi_finished_goods (month_period);
CREATE INDEX idx_mv_mutasi_finished_goods_v2_year_month ON mv_mutasi_finished_goods (year, month);
CREATE INDEX idx_mv_mutasi_finished_goods_v2_item ON mv_mutasi_finished_goods (item_code);
CREATE INDEX idx_mv_mutasi_finished_goods_v2_company ON mv_mutasi_finished_goods (company_code);

COMMENT ON MATERIALIZED VIEW mv_mutasi_finished_goods IS 'V2: Monthly finished goods (FERT) mutation report from StockDailySnapshot';

-- ============================================================================
-- 6. MUTASI CAPITAL GOODS (CAPITAL GOODS MUTATION)
-- ============================================================================
-- Monthly mutation report for capital goods (HIBE-M, HIBE-E, HIBE-T, HIBE)
-- Source: StockDailySnapshot WHERE item_type_code IN ('HIBE_M', 'HIBE_E', 'HIBE_T', 'HIBE')
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_mutasi_capital_goods CASCADE;

CREATE MATERIALIZED VIEW mv_mutasi_capital_goods AS
WITH monthly_aggregation AS (
    SELECT
        "companyCode",
        "itemTypeCode",
        "itemCode",
        "itemName",
        uom,
        DATE_TRUNC('month', "snapshotDate") AS month_period,
        MIN("snapshotDate") AS first_date,
        MAX("snapshotDate") AS last_date,

        -- Opening balance: first day of month
        (SELECT "openingBalance" FROM "StockDailySnapshot" s2
         WHERE s2."companyCode" = s."companyCode"
           AND s2."itemCode" = s."itemCode"
           AND s2."snapshotDate" = MIN(s."snapshotDate")
         LIMIT 1) AS beginning_stock,

        -- Sum of movements during month
        SUM(COALESCE("incomingQty", 0)) AS incoming,
        SUM(COALESCE("outgoingQty", 0)) AS outgoing,
        SUM(COALESCE("adjustmentQty", 0)) AS adjustment,

        -- Closing balance: last day of month
        (SELECT "closingBalance" FROM "StockDailySnapshot" s3
         WHERE s3."companyCode" = s."companyCode"
           AND s3."itemCode" = s."itemCode"
           AND s3."snapshotDate" = MAX(s."snapshotDate")
         LIMIT 1) AS ending_stock

    FROM "StockDailySnapshot" s
    WHERE "itemTypeCode" IN ('HIBE_M', 'HIBE_E', 'HIBE_T', 'HIBE')
    GROUP BY "companyCode", "itemTypeCode", "itemCode", "itemName", uom, DATE_TRUNC('month', "snapshotDate")
)
SELECT
    month_period,
    EXTRACT(YEAR FROM month_period)::INTEGER AS year,
    EXTRACT(MONTH FROM month_period)::INTEGER AS month,
    "companyCode" AS company_code,
    "itemTypeCode" AS item_type_code,
    "itemCode" AS item_code,
    "itemName" AS item_name,
    uom AS uom_code,
    beginning_stock,
    incoming,
    outgoing,
    adjustment,
    ending_stock,
    NULL::NUMERIC(15,2) AS stock_opname,
    NULL::NUMERIC(15,2) AS variance,
    first_date AS period_start,
    last_date AS period_end,
    ROW_NUMBER() OVER (ORDER BY month_period DESC, "companyCode", "itemTypeCode", "itemCode") AS row_id
FROM monthly_aggregation
ORDER BY month_period DESC, "companyCode", "itemTypeCode", "itemCode";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_mutasi_capital_goods_v2_unique
ON mv_mutasi_capital_goods (row_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_mutasi_capital_goods_v2_month ON mv_mutasi_capital_goods (month_period);
CREATE INDEX idx_mv_mutasi_capital_goods_v2_year_month ON mv_mutasi_capital_goods (year, month);
CREATE INDEX idx_mv_mutasi_capital_goods_v2_item ON mv_mutasi_capital_goods (item_code);
CREATE INDEX idx_mv_mutasi_capital_goods_v2_item_type ON mv_mutasi_capital_goods (item_type_code);
CREATE INDEX idx_mv_mutasi_capital_goods_v2_company ON mv_mutasi_capital_goods (company_code);

COMMENT ON MATERIALIZED VIEW mv_mutasi_capital_goods IS 'V2: Monthly capital goods (HIBE*) mutation report from StockDailySnapshot';

-- ============================================================================
-- 7. MUTASI SCRAP (SCRAP MUTATION)
-- ============================================================================
-- Monthly mutation report for scrap materials (SCRAP)
-- Source: StockDailySnapshot WHERE item_type_code = 'SCRAP'
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_mutasi_scrap CASCADE;

CREATE MATERIALIZED VIEW mv_mutasi_scrap AS
WITH monthly_aggregation AS (
    SELECT
        "companyCode",
        "itemCode",
        "itemName",
        uom,
        DATE_TRUNC('month', "snapshotDate") AS month_period,
        MIN("snapshotDate") AS first_date,
        MAX("snapshotDate") AS last_date,

        -- Opening balance: first day of month
        (SELECT "openingBalance" FROM "StockDailySnapshot" s2
         WHERE s2."companyCode" = s."companyCode"
           AND s2."itemCode" = s."itemCode"
           AND s2."snapshotDate" = MIN(s."snapshotDate")
         LIMIT 1) AS beginning_stock,

        -- Sum of movements during month
        SUM(COALESCE("incomingQty", 0)) AS incoming,  -- Generated scrap
        SUM(COALESCE("outgoingQty", 0)) AS outgoing,  -- Disposed/Sold
        SUM(COALESCE("adjustmentQty", 0)) AS adjustment,

        -- Closing balance: last day of month
        (SELECT "closingBalance" FROM "StockDailySnapshot" s3
         WHERE s3."companyCode" = s."companyCode"
           AND s3."itemCode" = s."itemCode"
           AND s3."snapshotDate" = MAX(s."snapshotDate")
         LIMIT 1) AS ending_stock

    FROM "StockDailySnapshot" s
    WHERE "itemTypeCode" = 'SCRAP'
    GROUP BY "companyCode", "itemCode", "itemName", uom, DATE_TRUNC('month', "snapshotDate")
)
SELECT
    month_period,
    EXTRACT(YEAR FROM month_period)::INTEGER AS year,
    EXTRACT(MONTH FROM month_period)::INTEGER AS month,
    "companyCode" AS company_code,
    "itemCode" AS item_code,
    "itemName" AS item_name,
    uom AS uom_code,
    beginning_stock,
    incoming,
    outgoing,
    adjustment,
    ending_stock,
    NULL::NUMERIC(15,2) AS stock_opname,
    NULL::NUMERIC(15,2) AS variance,
    first_date AS period_start,
    last_date AS period_end,
    ROW_NUMBER() OVER (ORDER BY month_period DESC, "companyCode", "itemCode") AS row_id
FROM monthly_aggregation
ORDER BY month_period DESC, "companyCode", "itemCode";

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_mv_mutasi_scrap_v2_unique
ON mv_mutasi_scrap (row_id);

-- Create indexes for common queries
CREATE INDEX idx_mv_mutasi_scrap_v2_month ON mv_mutasi_scrap (month_period);
CREATE INDEX idx_mv_mutasi_scrap_v2_year_month ON mv_mutasi_scrap (year, month);
CREATE INDEX idx_mv_mutasi_scrap_v2_item ON mv_mutasi_scrap (item_code);
CREATE INDEX idx_mv_mutasi_scrap_v2_company ON mv_mutasi_scrap (company_code);

COMMENT ON MATERIALIZED VIEW mv_mutasi_scrap IS 'V2: Monthly scrap (SCRAP) mutation report from StockDailySnapshot';

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
    RAISE NOTICE 'All 7 materialized views V2.0 have been created successfully!';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE '1. mv_laporan_pemasukan - Incoming documents report (from IncomingHeader/Detail)';
    RAISE NOTICE '2. mv_laporan_pengeluaran - Outgoing documents report (from OutgoingHeader/Detail)';
    RAISE NOTICE '3. mv_mutasi_bahan_baku - Raw material mutation (from StockDailySnapshot ROH)';
    RAISE NOTICE '4. mv_posisi_wip - WIP position (from StockDailySnapshot HALB)';
    RAISE NOTICE '5. mv_mutasi_finished_goods - Finished goods mutation (from StockDailySnapshot FERT)';
    RAISE NOTICE '6. mv_mutasi_capital_goods - Capital goods mutation (from StockDailySnapshot HIBE*)';
    RAISE NOTICE '7. mv_mutasi_scrap - Scrap mutation (from StockDailySnapshot SCRAP)';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Schema Version: V2.0';
    RAISE NOTICE 'Source Tables: IncomingHeader/Detail, OutgoingHeader/Detail, StockDailySnapshot';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Use POST /api/admin/refresh-views to populate with data';
    RAISE NOTICE '2. Schedule automatic refreshes via scheduler (added to jobs)';
    RAISE NOTICE '3. Create API endpoints to query these views';
    RAISE NOTICE '============================================================================';
END $$;
