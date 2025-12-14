-- ============================================================================
-- POSTGRESQL PARTITIONING SETUP FOR iMAPS
-- ============================================================================
-- This script creates partitioned tables for high-volume transactional data
-- Partitioning strategy: BY LIST (company_code) then BY RANGE (date fields)
-- 
-- NOTE: Run this AFTER prisma db push/migrate
-- This is a manual step because Prisma doesn't support partitioning natively
-- ============================================================================

-- ============================================================================
-- 1. INCOMING GOODS PARTITIONING
-- ============================================================================

-- Drop existing table and recreate as partitioned
DROP TABLE IF EXISTS incoming_goods CASCADE;

CREATE TABLE incoming_goods (
    id SERIAL,
    wms_id VARCHAR(100) NOT NULL,
    company_code INTEGER NOT NULL,
    owner INTEGER NOT NULL,
    customs_document_type VARCHAR(10) NOT NULL,
    ppkek_number VARCHAR(50) NOT NULL,
    customs_registration_date DATE NOT NULL,
    incoming_evidence_number VARCHAR(50) NOT NULL,
    incoming_date DATE NOT NULL,
    invoice_number VARCHAR(50) NOT NULL,
    invoice_date DATE NOT NULL,
    shipper_name VARCHAR(200) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL,
    deleted_at TIMESTAMPTZ(6)
) PARTITION BY LIST (company_code);

-- Create partitions for each company
CREATE TABLE incoming_goods_1370 PARTITION OF incoming_goods
    FOR VALUES IN (1370)
    PARTITION BY RANGE (incoming_date);

CREATE TABLE incoming_goods_1310 PARTITION OF incoming_goods
    FOR VALUES IN (1310)
    PARTITION BY RANGE (incoming_date);

CREATE TABLE incoming_goods_1380 PARTITION OF incoming_goods
    FOR VALUES IN (1380)
    PARTITION BY RANGE (incoming_date);

-- Create date range partitions for company 1370 (2025)
CREATE TABLE incoming_goods_1370_2025_q1 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');

CREATE TABLE incoming_goods_1370_2025_q2 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');

CREATE TABLE incoming_goods_1370_2025_q3 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');

CREATE TABLE incoming_goods_1370_2025_q4 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Create date range partitions for company 1310 (2026)
CREATE TABLE incoming_goods_1310_2026_q1 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');

CREATE TABLE incoming_goods_1310_2026_q2 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');

CREATE TABLE incoming_goods_1310_2026_q3 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');

CREATE TABLE incoming_goods_1310_2026_q4 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Create indexes on partitioned table
CREATE UNIQUE INDEX idx_incoming_goods_wms_id ON incoming_goods (company_code, wms_id, incoming_date);
CREATE INDEX idx_incoming_goods_company_code ON incoming_goods (company_code);
CREATE INDEX idx_incoming_goods_incoming_date ON incoming_goods (incoming_date);
CREATE INDEX idx_incoming_goods_ppkek_number ON incoming_goods (ppkek_number);
CREATE INDEX idx_incoming_goods_customs_document_type ON incoming_goods (customs_document_type);
CREATE INDEX idx_incoming_goods_incoming_evidence_number ON incoming_goods (incoming_evidence_number);

-- ============================================================================
-- 2. MATERIAL USAGE PARTITIONING
-- ============================================================================

DROP TABLE IF EXISTS material_usages CASCADE;

CREATE TABLE material_usages (
    id SERIAL,
    wms_id VARCHAR(100) NOT NULL,
    company_code INTEGER NOT NULL,
    work_order_number VARCHAR(50),
    cost_center_number VARCHAR(100),
    internal_evidence_number VARCHAR(50) NOT NULL,
    transaction_date DATE NOT NULL,
    reversal VARCHAR(1),
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL,
    deleted_at TIMESTAMPTZ(6)
) PARTITION BY LIST (company_code);

-- Create partitions for each company
CREATE TABLE material_usages_1370 PARTITION OF material_usages
    FOR VALUES IN (1370)
    PARTITION BY RANGE (transaction_date);

CREATE TABLE material_usages_1310 PARTITION OF material_usages
    FOR VALUES IN (1310)
    PARTITION BY RANGE (transaction_date);

CREATE TABLE material_usages_1380 PARTITION OF material_usages
    FOR VALUES IN (1380)
    PARTITION BY RANGE (transaction_date);

-- Create date range partitions for company 1370 (2025)
CREATE TABLE material_usages_1370_2025_q1 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');

CREATE TABLE material_usages_1370_2025_q2 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');

CREATE TABLE material_usages_1370_2025_q3 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');

CREATE TABLE material_usages_1370_2025_q4 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Create date range partitions for company 1310 (2026)
CREATE TABLE material_usages_1310_2026_q1 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');

CREATE TABLE material_usages_1310_2026_q2 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');

CREATE TABLE material_usages_1310_2026_q3 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');

CREATE TABLE material_usages_1310_2026_q4 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Create indexes
CREATE UNIQUE INDEX idx_material_usages_wms_id ON material_usages (company_code, wms_id, transaction_date);
CREATE INDEX idx_material_usages_company_code ON material_usages (company_code);
CREATE INDEX idx_material_usages_transaction_date ON material_usages (transaction_date);
CREATE INDEX idx_material_usages_work_order_number ON material_usages (work_order_number);
CREATE INDEX idx_material_usages_cost_center_number ON material_usages (cost_center_number);
CREATE INDEX idx_material_usages_internal_evidence_number ON material_usages (internal_evidence_number);

-- ============================================================================
-- 3. WIP BALANCE PARTITIONING
-- ============================================================================

DROP TABLE IF EXISTS wip_balances CASCADE;

CREATE TABLE wip_balances (
    id SERIAL,
    wms_id VARCHAR(100) NOT NULL,
    company_code INTEGER NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    stock_date DATE NOT NULL,
    uom VARCHAR(20) NOT NULL,
    qty DECIMAL(15, 3) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL,
    deleted_at TIMESTAMPTZ(6)
) PARTITION BY LIST (company_code);

-- Create partitions for each company
CREATE TABLE wip_balances_1370 PARTITION OF wip_balances
    FOR VALUES IN (1370)
    PARTITION BY RANGE (stock_date);

CREATE TABLE wip_balances_1310 PARTITION OF wip_balances
    FOR VALUES IN (1310)
    PARTITION BY RANGE (stock_date);

CREATE TABLE wip_balances_1380 PARTITION OF wip_balances
    FOR VALUES IN (1380)
    PARTITION BY RANGE (stock_date);

-- Create date range partitions for company 1370 (2025)
CREATE TABLE wip_balances_1370_2025_q1 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');

CREATE TABLE wip_balances_1370_2025_q2 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');

CREATE TABLE wip_balances_1370_2025_q3 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');

CREATE TABLE wip_balances_1370_2025_q4 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Create date range partitions for company 1310 (2026)
CREATE TABLE wip_balances_1310_2026_q1 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');

CREATE TABLE wip_balances_1310_2026_q2 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');

CREATE TABLE wip_balances_1310_2026_q3 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');

CREATE TABLE wip_balances_1310_2026_q4 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Create indexes
CREATE UNIQUE INDEX idx_wip_balances_wms_id ON wip_balances (company_code, wms_id, stock_date);
CREATE INDEX idx_wip_balances_company_code ON wip_balances (company_code);
CREATE INDEX idx_wip_balances_stock_date ON wip_balances (stock_date);
CREATE INDEX idx_wip_balances_item_code ON wip_balances (item_code);
CREATE INDEX idx_wip_balances_item_type ON wip_balances (item_type);

-- ============================================================================
-- 4. PRODUCTION OUTPUT PARTITIONING
-- ============================================================================

DROP TABLE IF EXISTS production_outputs CASCADE;

CREATE TABLE production_outputs (
    id SERIAL,
    wms_id VARCHAR(100) NOT NULL,
    company_code INTEGER NOT NULL,
    internal_evidence_number VARCHAR(50) NOT NULL,
    transaction_date DATE NOT NULL,
    reversal VARCHAR(1),
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL,
    deleted_at TIMESTAMPTZ(6)
) PARTITION BY LIST (company_code);

-- Create partitions for each company
CREATE TABLE production_outputs_1370 PARTITION OF production_outputs
    FOR VALUES IN (1370)
    PARTITION BY RANGE (transaction_date);

CREATE TABLE production_outputs_1310 PARTITION OF production_outputs
    FOR VALUES IN (1310)
    PARTITION BY RANGE (transaction_date);

CREATE TABLE production_outputs_1380 PARTITION OF production_outputs
    FOR VALUES IN (1380)
    PARTITION BY RANGE (transaction_date);

-- Create date range partitions for company 1370 (2025)
CREATE TABLE production_outputs_1370_2025_q1 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');

CREATE TABLE production_outputs_1370_2025_q2 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');

CREATE TABLE production_outputs_1370_2025_q3 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');

CREATE TABLE production_outputs_1370_2025_q4 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Create date range partitions for company 1310 (2026)
CREATE TABLE production_outputs_1310_2026_q1 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');

CREATE TABLE production_outputs_1310_2026_q2 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');

CREATE TABLE production_outputs_1310_2026_q3 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');

CREATE TABLE production_outputs_1310_2026_q4 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Create indexes
CREATE UNIQUE INDEX idx_production_outputs_wms_id ON production_outputs (company_code, wms_id, transaction_date);
CREATE INDEX idx_production_outputs_company_code ON production_outputs (company_code);
CREATE INDEX idx_production_outputs_transaction_date ON production_outputs (transaction_date);
CREATE INDEX idx_production_outputs_internal_evidence_number ON production_outputs (internal_evidence_number);

-- ============================================================================
-- 5. OUTGOING GOODS PARTITIONING
-- ============================================================================

DROP TABLE IF EXISTS outgoing_goods CASCADE;

CREATE TABLE outgoing_goods (
    id SERIAL,
    wms_id VARCHAR(100) NOT NULL,
    company_code INTEGER NOT NULL,
    owner INTEGER NOT NULL,
    customs_document_type VARCHAR(10) NOT NULL,
    ppkek_number VARCHAR(50) NOT NULL,
    customs_registration_date DATE NOT NULL,
    outgoing_evidence_number VARCHAR(50) NOT NULL,
    outgoing_date DATE NOT NULL,
    invoice_number VARCHAR(50) NOT NULL,
    invoice_date DATE NOT NULL,
    recipient_name VARCHAR(200) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL,
    deleted_at TIMESTAMPTZ(6)
) PARTITION BY LIST (company_code);

-- Create partitions for each company
CREATE TABLE outgoing_goods_1370 PARTITION OF outgoing_goods
    FOR VALUES IN (1370)
    PARTITION BY RANGE (outgoing_date);

CREATE TABLE outgoing_goods_1310 PARTITION OF outgoing_goods
    FOR VALUES IN (1310)
    PARTITION BY RANGE (outgoing_date);

CREATE TABLE outgoing_goods_1380 PARTITION OF outgoing_goods
    FOR VALUES IN (1380)
    PARTITION BY RANGE (outgoing_date);

-- Create date range partitions for company 1370 (2025)
CREATE TABLE outgoing_goods_1370_2025_q1 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');

CREATE TABLE outgoing_goods_1370_2025_q2 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');

CREATE TABLE outgoing_goods_1370_2025_q3 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');

CREATE TABLE outgoing_goods_1370_2025_q4 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Create date range partitions for company 1310 (2026)
CREATE TABLE outgoing_goods_1310_2026_q1 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');

CREATE TABLE outgoing_goods_1310_2026_q2 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');

CREATE TABLE outgoing_goods_1310_2026_q3 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');

CREATE TABLE outgoing_goods_1310_2026_q4 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Create indexes
CREATE UNIQUE INDEX idx_outgoing_goods_wms_id ON outgoing_goods (company_code, wms_id, outgoing_date);
CREATE INDEX idx_outgoing_goods_company_code ON outgoing_goods (company_code);
CREATE INDEX idx_outgoing_goods_outgoing_date ON outgoing_goods (outgoing_date);
CREATE INDEX idx_outgoing_goods_ppkek_number ON outgoing_goods (ppkek_number);
CREATE INDEX idx_outgoing_goods_customs_document_type ON outgoing_goods (customs_document_type);
CREATE INDEX idx_outgoing_goods_outgoing_evidence_number ON outgoing_goods (outgoing_evidence_number);

-- ============================================================================
-- 6. ADJUSTMENTS PARTITIONING
-- ============================================================================

DROP TABLE IF EXISTS adjustments CASCADE;

CREATE TABLE adjustments (
    id SERIAL,
    wms_id VARCHAR(100) NOT NULL,
    company_code INTEGER NOT NULL,
    wms_doc_type VARCHAR(100),
    internal_evidence_number VARCHAR(50) NOT NULL,
    transaction_date DATE NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL,
    deleted_at TIMESTAMPTZ(6)
) PARTITION BY LIST (company_code);

-- Create partitions for each company
CREATE TABLE adjustments_1370 PARTITION OF adjustments
    FOR VALUES IN (1370)
    PARTITION BY RANGE (transaction_date);

CREATE TABLE adjustments_1310 PARTITION OF adjustments
    FOR VALUES IN (1310)
    PARTITION BY RANGE (transaction_date);

CREATE TABLE adjustments_1380 PARTITION OF adjustments
    FOR VALUES IN (1380)
    PARTITION BY RANGE (transaction_date);

-- Create date range partitions for company 1370 (2025)
CREATE TABLE adjustments_1370_2025_q1 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');

CREATE TABLE adjustments_1370_2025_q2 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');

CREATE TABLE adjustments_1370_2025_q3 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');

CREATE TABLE adjustments_1370_2025_q4 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Create date range partitions for company 1310 (2026)
CREATE TABLE adjustments_1310_2026_q1 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');

CREATE TABLE adjustments_1310_2026_q2 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');

CREATE TABLE adjustments_1310_2026_q3 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');

CREATE TABLE adjustments_1310_2026_q4 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Create indexes
CREATE UNIQUE INDEX idx_adjustments_wms_id ON adjustments (company_code, wms_id, transaction_date);
CREATE INDEX idx_adjustments_company_code ON adjustments (company_code);
CREATE INDEX idx_adjustments_transaction_date ON adjustments (transaction_date);
CREATE INDEX idx_adjustments_internal_evidence_number ON adjustments (internal_evidence_number);

-- ============================================================================
-- NOTES ON PARTITION MAINTENANCE
-- ============================================================================

-- To add new quarterly partitions (run before each quarter):
-- 
-- Example for Q1 2026:
-- CREATE TABLE incoming_goods_1370_2026_q1 PARTITION OF incoming_goods_1370
--     FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
-- 
-- CREATE TABLE material_usages_1370_2026_q1 PARTITION OF material_usages_1370
--     FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
-- 
-- (Repeat for all partitioned tables and companies)

-- To drop old partitions (after 5-year retention):
-- DROP TABLE incoming_goods_1370_2020_q1;

-- To verify partitions:
-- SELECT 
--     schemaname,
--     tablename,
--     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
-- FROM pg_tables
-- WHERE tablename LIKE '%_1370_%'
-- ORDER BY tablename;

-- ============================================================================
-- END OF PARTITIONING SETUP
-- ============================================================================
