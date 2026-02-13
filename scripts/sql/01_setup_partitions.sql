-- ============================================================================
-- POSTGRESQL PARTITIONING SETUP FOR iMAPS (FIXED FOR PERMISSIONS)
-- ============================================================================
-- This script creates partitioned tables for high-volume transactional data
-- Partitioning strategy: BY LIST (company_code) then BY RANGE (date fields)
-- 
-- IMPORTANT: Index names follow Prisma naming convention:
--   - Unique index: {table}_{col1}_{col2}_key
--   - Regular index: {table}_{column}_idx
-- 
-- IMPORTANT: This script converts parent tables to partitioned
-- NOTE: Uses CASCADE drops on parent tables only
--   - Parent tables are recreated as partitioned
--   - Child tables (with FK references) are NOT affected by CASCADE
--   - Reason: In PG12-14, FKs can't reference partitioned tables,
--            so child tables must be separate regular tables
-- After running: All tables remain intact, child tables still exist
--
-- FIXED: Added complete company 1380 partitions (2026 Q1-Q4)
-- ============================================================================

-- Set role to postgres for creating tables
SET ROLE postgres;

-- ============================================================================
-- GRANT INITIAL PRIVILEGES TO APPUSER
-- ============================================================================

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO appuser;
GRANT CREATE ON SCHEMA public TO appuser;

-- Grant privileges on existing tables
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO appuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO appuser;

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

-- Change owner to appuser
ALTER TABLE incoming_goods OWNER TO appuser;

-- Create partitions for each company
CREATE TABLE incoming_goods_1370 PARTITION OF incoming_goods
    FOR VALUES IN (1370)
    PARTITION BY RANGE (incoming_date);

ALTER TABLE incoming_goods_1370 OWNER TO appuser;

CREATE TABLE incoming_goods_1310 PARTITION OF incoming_goods
    FOR VALUES IN (1310)
    PARTITION BY RANGE (incoming_date);

ALTER TABLE incoming_goods_1310 OWNER TO appuser;

CREATE TABLE incoming_goods_1380 PARTITION OF incoming_goods
    FOR VALUES IN (1380)
    PARTITION BY RANGE (incoming_date);

ALTER TABLE incoming_goods_1380 OWNER TO appuser;

-- Create date range partitions for company 1370 (2025)
CREATE TABLE incoming_goods_1370_2025_q1 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE incoming_goods_1370_2025_q1 OWNER TO appuser;

CREATE TABLE incoming_goods_1370_2025_q2 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE incoming_goods_1370_2025_q2 OWNER TO appuser;

CREATE TABLE incoming_goods_1370_2025_q3 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE incoming_goods_1370_2025_q3 OWNER TO appuser;

CREATE TABLE incoming_goods_1370_2025_q4 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE incoming_goods_1370_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1370 (2026)
CREATE TABLE incoming_goods_1370_2026_q1 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE incoming_goods_1370_2026_q1 OWNER TO appuser;

CREATE TABLE incoming_goods_1370_2026_q2 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE incoming_goods_1370_2026_q2 OWNER TO appuser;

CREATE TABLE incoming_goods_1370_2026_q3 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE incoming_goods_1370_2026_q3 OWNER TO appuser;

CREATE TABLE incoming_goods_1370_2026_q4 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE incoming_goods_1370_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2025)
CREATE TABLE incoming_goods_1310_2025_q1 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE incoming_goods_1310_2025_q1 OWNER TO appuser;

CREATE TABLE incoming_goods_1310_2025_q2 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE incoming_goods_1310_2025_q2 OWNER TO appuser;

CREATE TABLE incoming_goods_1310_2025_q3 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE incoming_goods_1310_2025_q3 OWNER TO appuser;

CREATE TABLE incoming_goods_1310_2025_q4 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE incoming_goods_1310_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2026)
CREATE TABLE incoming_goods_1310_2026_q1 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE incoming_goods_1310_2026_q1 OWNER TO appuser;

CREATE TABLE incoming_goods_1310_2026_q2 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE incoming_goods_1310_2026_q2 OWNER TO appuser;

CREATE TABLE incoming_goods_1310_2026_q3 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE incoming_goods_1310_2026_q3 OWNER TO appuser;

CREATE TABLE incoming_goods_1310_2026_q4 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE incoming_goods_1310_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2025)
CREATE TABLE incoming_goods_1380_2025_q1 PARTITION OF incoming_goods_1380
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE incoming_goods_1380_2025_q1 OWNER TO appuser;

CREATE TABLE incoming_goods_1380_2025_q2 PARTITION OF incoming_goods_1380
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE incoming_goods_1380_2025_q2 OWNER TO appuser;

CREATE TABLE incoming_goods_1380_2025_q3 PARTITION OF incoming_goods_1380
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE incoming_goods_1380_2025_q3 OWNER TO appuser;

CREATE TABLE incoming_goods_1380_2025_q4 PARTITION OF incoming_goods_1380
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE incoming_goods_1380_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2026)
CREATE TABLE incoming_goods_1380_2026_q1 PARTITION OF incoming_goods_1380
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE incoming_goods_1380_2026_q1 OWNER TO appuser;

CREATE TABLE incoming_goods_1380_2026_q2 PARTITION OF incoming_goods_1380
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE incoming_goods_1380_2026_q2 OWNER TO appuser;

CREATE TABLE incoming_goods_1380_2026_q3 PARTITION OF incoming_goods_1380
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE incoming_goods_1380_2026_q3 OWNER TO appuser;

CREATE TABLE incoming_goods_1380_2026_q4 PARTITION OF incoming_goods_1380
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE incoming_goods_1380_2026_q4 OWNER TO appuser;

-- Create indexes with Prisma naming convention
CREATE UNIQUE INDEX incoming_goods_company_code_wms_id_incoming_date_key ON incoming_goods (company_code, wms_id, incoming_date);
CREATE UNIQUE INDEX incoming_goods_company_code_id_incoming_date_key ON incoming_goods (company_code, id, incoming_date);
CREATE INDEX incoming_goods_wms_id_idx ON incoming_goods (wms_id);
CREATE INDEX incoming_goods_company_code_idx ON incoming_goods (company_code);
CREATE INDEX incoming_goods_incoming_date_idx ON incoming_goods (incoming_date);
CREATE INDEX incoming_goods_ppkek_number_idx ON incoming_goods (ppkek_number);
CREATE INDEX incoming_goods_customs_document_type_idx ON incoming_goods (customs_document_type);
CREATE INDEX incoming_goods_incoming_evidence_number_idx ON incoming_goods (incoming_evidence_number);

-- ============================================================================
-- 2. MATERIAL USAGE PARTITIONING
-- ============================================================================

DROP TABLE IF EXISTS material_usages CASCADE;

CREATE TABLE material_usages (
    id SERIAL,
    wms_id VARCHAR(100) NOT NULL,
    company_code INTEGER NOT NULL,
    owner INTEGER NOT NULL,
    work_order_number VARCHAR(50),
    cost_center_number VARCHAR(100),
    internal_evidence_number VARCHAR(50) NOT NULL,
    transaction_date DATE NOT NULL,
    reversal VARCHAR(1),
    section VARCHAR(100),
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL,
    deleted_at TIMESTAMPTZ(6)
) PARTITION BY LIST (company_code);

ALTER TABLE material_usages OWNER TO appuser;

-- Create partitions for each company
CREATE TABLE material_usages_1370 PARTITION OF material_usages
    FOR VALUES IN (1370)
    PARTITION BY RANGE (transaction_date);
ALTER TABLE material_usages_1370 OWNER TO appuser;

CREATE TABLE material_usages_1310 PARTITION OF material_usages
    FOR VALUES IN (1310)
    PARTITION BY RANGE (transaction_date);
ALTER TABLE material_usages_1310 OWNER TO appuser;

CREATE TABLE material_usages_1380 PARTITION OF material_usages
    FOR VALUES IN (1380)
    PARTITION BY RANGE (transaction_date);
ALTER TABLE material_usages_1380 OWNER TO appuser;

-- Create date range partitions for company 1370 (2025)
CREATE TABLE material_usages_1370_2025_q1 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE material_usages_1370_2025_q1 OWNER TO appuser;

CREATE TABLE material_usages_1370_2025_q2 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE material_usages_1370_2025_q2 OWNER TO appuser;

CREATE TABLE material_usages_1370_2025_q3 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE material_usages_1370_2025_q3 OWNER TO appuser;

CREATE TABLE material_usages_1370_2025_q4 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE material_usages_1370_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1370 (2026)
CREATE TABLE material_usages_1370_2026_q1 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE material_usages_1370_2026_q1 OWNER TO appuser;

CREATE TABLE material_usages_1370_2026_q2 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE material_usages_1370_2026_q2 OWNER TO appuser;

CREATE TABLE material_usages_1370_2026_q3 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE material_usages_1370_2026_q3 OWNER TO appuser;

CREATE TABLE material_usages_1370_2026_q4 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE material_usages_1370_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2025)
CREATE TABLE material_usages_1310_2025_q1 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE material_usages_1310_2025_q1 OWNER TO appuser;

CREATE TABLE material_usages_1310_2025_q2 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE material_usages_1310_2025_q2 OWNER TO appuser;

CREATE TABLE material_usages_1310_2025_q3 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE material_usages_1310_2025_q3 OWNER TO appuser;

CREATE TABLE material_usages_1310_2025_q4 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE material_usages_1310_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2026)
CREATE TABLE material_usages_1310_2026_q1 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE material_usages_1310_2026_q1 OWNER TO appuser;

CREATE TABLE material_usages_1310_2026_q2 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE material_usages_1310_2026_q2 OWNER TO appuser;

CREATE TABLE material_usages_1310_2026_q3 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE material_usages_1310_2026_q3 OWNER TO appuser;

CREATE TABLE material_usages_1310_2026_q4 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE material_usages_1310_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2025)
CREATE TABLE material_usages_1380_2025_q1 PARTITION OF material_usages_1380
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE material_usages_1380_2025_q1 OWNER TO appuser;

CREATE TABLE material_usages_1380_2025_q2 PARTITION OF material_usages_1380
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE material_usages_1380_2025_q2 OWNER TO appuser;

CREATE TABLE material_usages_1380_2025_q3 PARTITION OF material_usages_1380
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE material_usages_1380_2025_q3 OWNER TO appuser;

CREATE TABLE material_usages_1380_2025_q4 PARTITION OF material_usages_1380
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE material_usages_1380_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2026)
CREATE TABLE material_usages_1380_2026_q1 PARTITION OF material_usages_1380
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE material_usages_1380_2026_q1 OWNER TO appuser;

CREATE TABLE material_usages_1380_2026_q2 PARTITION OF material_usages_1380
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE material_usages_1380_2026_q2 OWNER TO appuser;

CREATE TABLE material_usages_1380_2026_q3 PARTITION OF material_usages_1380
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE material_usages_1380_2026_q3 OWNER TO appuser;

CREATE TABLE material_usages_1380_2026_q4 PARTITION OF material_usages_1380
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE material_usages_1380_2026_q4 OWNER TO appuser;

-- Create indexes with Prisma naming convention
CREATE UNIQUE INDEX material_usages_company_code_wms_id_transaction_date_key ON material_usages (company_code, wms_id, transaction_date);
CREATE UNIQUE INDEX material_usages_company_code_id_transaction_date_key ON material_usages (company_code, id, transaction_date);
CREATE INDEX material_usages_wms_id_idx ON material_usages (wms_id);
CREATE INDEX material_usages_company_code_idx ON material_usages (company_code);
CREATE INDEX material_usages_transaction_date_idx ON material_usages (transaction_date);
CREATE INDEX material_usages_work_order_number_idx ON material_usages (work_order_number);
CREATE INDEX material_usages_cost_center_number_idx ON material_usages (cost_center_number);
CREATE INDEX material_usages_internal_evidence_number_idx ON material_usages (internal_evidence_number);

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

ALTER TABLE wip_balances OWNER TO appuser;

-- Create partitions for each company
CREATE TABLE wip_balances_1370 PARTITION OF wip_balances
    FOR VALUES IN (1370)
    PARTITION BY RANGE (stock_date);
ALTER TABLE wip_balances_1370 OWNER TO appuser;

CREATE TABLE wip_balances_1310 PARTITION OF wip_balances
    FOR VALUES IN (1310)
    PARTITION BY RANGE (stock_date);
ALTER TABLE wip_balances_1310 OWNER TO appuser;

CREATE TABLE wip_balances_1380 PARTITION OF wip_balances
    FOR VALUES IN (1380)
    PARTITION BY RANGE (stock_date);
ALTER TABLE wip_balances_1380 OWNER TO appuser;

-- Create date range partitions for company 1370 (2025)
CREATE TABLE wip_balances_1370_2025_q1 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE wip_balances_1370_2025_q1 OWNER TO appuser;

CREATE TABLE wip_balances_1370_2025_q2 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE wip_balances_1370_2025_q2 OWNER TO appuser;

CREATE TABLE wip_balances_1370_2025_q3 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE wip_balances_1370_2025_q3 OWNER TO appuser;

CREATE TABLE wip_balances_1370_2025_q4 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE wip_balances_1370_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1370 (2026)
CREATE TABLE wip_balances_1370_2026_q1 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE wip_balances_1370_2026_q1 OWNER TO appuser;

CREATE TABLE wip_balances_1370_2026_q2 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE wip_balances_1370_2026_q2 OWNER TO appuser;

CREATE TABLE wip_balances_1370_2026_q3 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE wip_balances_1370_2026_q3 OWNER TO appuser;

CREATE TABLE wip_balances_1370_2026_q4 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE wip_balances_1370_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2025)
CREATE TABLE wip_balances_1310_2025_q1 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE wip_balances_1310_2025_q1 OWNER TO appuser;

CREATE TABLE wip_balances_1310_2025_q2 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE wip_balances_1310_2025_q2 OWNER TO appuser;

CREATE TABLE wip_balances_1310_2025_q3 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE wip_balances_1310_2025_q3 OWNER TO appuser;

CREATE TABLE wip_balances_1310_2025_q4 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE wip_balances_1310_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2026)
CREATE TABLE wip_balances_1310_2026_q1 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE wip_balances_1310_2026_q1 OWNER TO appuser;

CREATE TABLE wip_balances_1310_2026_q2 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE wip_balances_1310_2026_q2 OWNER TO appuser;

CREATE TABLE wip_balances_1310_2026_q3 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE wip_balances_1310_2026_q3 OWNER TO appuser;

CREATE TABLE wip_balances_1310_2026_q4 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE wip_balances_1310_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2025)
CREATE TABLE wip_balances_1380_2025_q1 PARTITION OF wip_balances_1380
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE wip_balances_1380_2025_q1 OWNER TO appuser;

CREATE TABLE wip_balances_1380_2025_q2 PARTITION OF wip_balances_1380
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE wip_balances_1380_2025_q2 OWNER TO appuser;

CREATE TABLE wip_balances_1380_2025_q3 PARTITION OF wip_balances_1380
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE wip_balances_1380_2025_q3 OWNER TO appuser;

CREATE TABLE wip_balances_1380_2025_q4 PARTITION OF wip_balances_1380
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE wip_balances_1380_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2026)
CREATE TABLE wip_balances_1380_2026_q1 PARTITION OF wip_balances_1380
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE wip_balances_1380_2026_q1 OWNER TO appuser;

CREATE TABLE wip_balances_1380_2026_q2 PARTITION OF wip_balances_1380
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE wip_balances_1380_2026_q2 OWNER TO appuser;

CREATE TABLE wip_balances_1380_2026_q3 PARTITION OF wip_balances_1380
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE wip_balances_1380_2026_q3 OWNER TO appuser;

CREATE TABLE wip_balances_1380_2026_q4 PARTITION OF wip_balances_1380
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE wip_balances_1380_2026_q4 OWNER TO appuser;

-- Create indexes with Prisma naming convention
CREATE UNIQUE INDEX wip_balances_company_code_wms_id_stock_date_key ON wip_balances (company_code, wms_id, stock_date);
CREATE INDEX wip_balances_wms_id_idx ON wip_balances (wms_id);
CREATE INDEX wip_balances_company_code_idx ON wip_balances (company_code);
CREATE INDEX wip_balances_stock_date_idx ON wip_balances (stock_date);
CREATE INDEX wip_balances_item_code_idx ON wip_balances (item_code);
CREATE INDEX wip_balances_item_type_idx ON wip_balances (item_type);

-- ============================================================================
-- 4. PRODUCTION OUTPUT PARTITIONING
-- ============================================================================

DROP TABLE IF EXISTS production_outputs CASCADE;

CREATE TABLE production_outputs (
    id SERIAL,
    wms_id VARCHAR(100) NOT NULL,
    company_code INTEGER NOT NULL,
    owner INTEGER NOT NULL,
    internal_evidence_number VARCHAR(50) NOT NULL,
    transaction_date DATE NOT NULL,
    reversal VARCHAR(1),
    section VARCHAR(100),
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL,
    deleted_at TIMESTAMPTZ(6)
) PARTITION BY LIST (company_code);

ALTER TABLE production_outputs OWNER TO appuser;

-- Create partitions for each company
CREATE TABLE production_outputs_1370 PARTITION OF production_outputs
    FOR VALUES IN (1370)
    PARTITION BY RANGE (transaction_date);
ALTER TABLE production_outputs_1370 OWNER TO appuser;

CREATE TABLE production_outputs_1310 PARTITION OF production_outputs
    FOR VALUES IN (1310)
    PARTITION BY RANGE (transaction_date);
ALTER TABLE production_outputs_1310 OWNER TO appuser;

CREATE TABLE production_outputs_1380 PARTITION OF production_outputs
    FOR VALUES IN (1380)
    PARTITION BY RANGE (transaction_date);
ALTER TABLE production_outputs_1380 OWNER TO appuser;

-- Create date range partitions for company 1370 (2025)
CREATE TABLE production_outputs_1370_2025_q1 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE production_outputs_1370_2025_q1 OWNER TO appuser;

CREATE TABLE production_outputs_1370_2025_q2 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE production_outputs_1370_2025_q2 OWNER TO appuser;

CREATE TABLE production_outputs_1370_2025_q3 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE production_outputs_1370_2025_q3 OWNER TO appuser;

CREATE TABLE production_outputs_1370_2025_q4 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE production_outputs_1370_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1370 (2026)
CREATE TABLE production_outputs_1370_2026_q1 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE production_outputs_1370_2026_q1 OWNER TO appuser;

CREATE TABLE production_outputs_1370_2026_q2 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE production_outputs_1370_2026_q2 OWNER TO appuser;

CREATE TABLE production_outputs_1370_2026_q3 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE production_outputs_1370_2026_q3 OWNER TO appuser;

CREATE TABLE production_outputs_1370_2026_q4 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE production_outputs_1370_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2025)
CREATE TABLE production_outputs_1310_2025_q1 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE production_outputs_1310_2025_q1 OWNER TO appuser;

CREATE TABLE production_outputs_1310_2025_q2 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE production_outputs_1310_2025_q2 OWNER TO appuser;

CREATE TABLE production_outputs_1310_2025_q3 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE production_outputs_1310_2025_q3 OWNER TO appuser;

CREATE TABLE production_outputs_1310_2025_q4 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE production_outputs_1310_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2026)
CREATE TABLE production_outputs_1310_2026_q1 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE production_outputs_1310_2026_q1 OWNER TO appuser;

CREATE TABLE production_outputs_1310_2026_q2 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE production_outputs_1310_2026_q2 OWNER TO appuser;

CREATE TABLE production_outputs_1310_2026_q3 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE production_outputs_1310_2026_q3 OWNER TO appuser;

CREATE TABLE production_outputs_1310_2026_q4 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE production_outputs_1310_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2025)
CREATE TABLE production_outputs_1380_2025_q1 PARTITION OF production_outputs_1380
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE production_outputs_1380_2025_q1 OWNER TO appuser;

CREATE TABLE production_outputs_1380_2025_q2 PARTITION OF production_outputs_1380
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE production_outputs_1380_2025_q2 OWNER TO appuser;

CREATE TABLE production_outputs_1380_2025_q3 PARTITION OF production_outputs_1380
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE production_outputs_1380_2025_q3 OWNER TO appuser;

CREATE TABLE production_outputs_1380_2025_q4 PARTITION OF production_outputs_1380
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE production_outputs_1380_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2026)
CREATE TABLE production_outputs_1380_2026_q1 PARTITION OF production_outputs_1380
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE production_outputs_1380_2026_q1 OWNER TO appuser;

CREATE TABLE production_outputs_1380_2026_q2 PARTITION OF production_outputs_1380
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE production_outputs_1380_2026_q2 OWNER TO appuser;

CREATE TABLE production_outputs_1380_2026_q3 PARTITION OF production_outputs_1380
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE production_outputs_1380_2026_q3 OWNER TO appuser;

CREATE TABLE production_outputs_1380_2026_q4 PARTITION OF production_outputs_1380
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE production_outputs_1380_2026_q4 OWNER TO appuser;

-- Create indexes with Prisma naming convention
CREATE UNIQUE INDEX production_outputs_company_code_wms_id_transaction_date_key ON production_outputs (company_code, wms_id, transaction_date);
CREATE UNIQUE INDEX production_outputs_company_code_id_transaction_date_key ON production_outputs (company_code, id, transaction_date);
CREATE INDEX production_outputs_wms_id_idx ON production_outputs (wms_id);
CREATE INDEX production_outputs_company_code_idx ON production_outputs (company_code);
CREATE INDEX production_outputs_transaction_date_idx ON production_outputs (transaction_date);
CREATE INDEX production_outputs_internal_evidence_number_idx ON production_outputs (internal_evidence_number);

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

ALTER TABLE outgoing_goods OWNER TO appuser;

-- Create partitions for each company
CREATE TABLE outgoing_goods_1370 PARTITION OF outgoing_goods
    FOR VALUES IN (1370)
    PARTITION BY RANGE (outgoing_date);
ALTER TABLE outgoing_goods_1370 OWNER TO appuser;

CREATE TABLE outgoing_goods_1310 PARTITION OF outgoing_goods
    FOR VALUES IN (1310)
    PARTITION BY RANGE (outgoing_date);
ALTER TABLE outgoing_goods_1310 OWNER TO appuser;

CREATE TABLE outgoing_goods_1380 PARTITION OF outgoing_goods
    FOR VALUES IN (1380)
    PARTITION BY RANGE (outgoing_date);
ALTER TABLE outgoing_goods_1380 OWNER TO appuser;

-- Create date range partitions for company 1370 (2025)
CREATE TABLE outgoing_goods_1370_2025_q1 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE outgoing_goods_1370_2025_q1 OWNER TO appuser;

CREATE TABLE outgoing_goods_1370_2025_q2 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE outgoing_goods_1370_2025_q2 OWNER TO appuser;

CREATE TABLE outgoing_goods_1370_2025_q3 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE outgoing_goods_1370_2025_q3 OWNER TO appuser;

CREATE TABLE outgoing_goods_1370_2025_q4 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE outgoing_goods_1370_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1370 (2026)
CREATE TABLE outgoing_goods_1370_2026_q1 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE outgoing_goods_1370_2026_q1 OWNER TO appuser;

CREATE TABLE outgoing_goods_1370_2026_q2 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE outgoing_goods_1370_2026_q2 OWNER TO appuser;

CREATE TABLE outgoing_goods_1370_2026_q3 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE outgoing_goods_1370_2026_q3 OWNER TO appuser;

CREATE TABLE outgoing_goods_1370_2026_q4 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE outgoing_goods_1370_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2025)
CREATE TABLE outgoing_goods_1310_2025_q1 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE outgoing_goods_1310_2025_q1 OWNER TO appuser;

CREATE TABLE outgoing_goods_1310_2025_q2 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE outgoing_goods_1310_2025_q2 OWNER TO appuser;

CREATE TABLE outgoing_goods_1310_2025_q3 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE outgoing_goods_1310_2025_q3 OWNER TO appuser;

CREATE TABLE outgoing_goods_1310_2025_q4 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE outgoing_goods_1310_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2026)
CREATE TABLE outgoing_goods_1310_2026_q1 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE outgoing_goods_1310_2026_q1 OWNER TO appuser;

CREATE TABLE outgoing_goods_1310_2026_q2 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE outgoing_goods_1310_2026_q2 OWNER TO appuser;

CREATE TABLE outgoing_goods_1310_2026_q3 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE outgoing_goods_1310_2026_q3 OWNER TO appuser;

CREATE TABLE outgoing_goods_1310_2026_q4 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE outgoing_goods_1310_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2025)
CREATE TABLE outgoing_goods_1380_2025_q1 PARTITION OF outgoing_goods_1380
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE outgoing_goods_1380_2025_q1 OWNER TO appuser;

CREATE TABLE outgoing_goods_1380_2025_q2 PARTITION OF outgoing_goods_1380
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE outgoing_goods_1380_2025_q2 OWNER TO appuser;

CREATE TABLE outgoing_goods_1380_2025_q3 PARTITION OF outgoing_goods_1380
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE outgoing_goods_1380_2025_q3 OWNER TO appuser;

CREATE TABLE outgoing_goods_1380_2025_q4 PARTITION OF outgoing_goods_1380
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE outgoing_goods_1380_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2026)
CREATE TABLE outgoing_goods_1380_2026_q1 PARTITION OF outgoing_goods_1380
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE outgoing_goods_1380_2026_q1 OWNER TO appuser;

CREATE TABLE outgoing_goods_1380_2026_q2 PARTITION OF outgoing_goods_1380
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE outgoing_goods_1380_2026_q2 OWNER TO appuser;

CREATE TABLE outgoing_goods_1380_2026_q3 PARTITION OF outgoing_goods_1380
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE outgoing_goods_1380_2026_q3 OWNER TO appuser;

CREATE TABLE outgoing_goods_1380_2026_q4 PARTITION OF outgoing_goods_1380
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE outgoing_goods_1380_2026_q4 OWNER TO appuser;

-- Create indexes with Prisma naming convention
CREATE UNIQUE INDEX outgoing_goods_company_code_wms_id_outgoing_date_key ON outgoing_goods (company_code, wms_id, outgoing_date);
CREATE UNIQUE INDEX outgoing_goods_company_code_id_outgoing_date_key ON outgoing_goods (company_code, id, outgoing_date);
CREATE INDEX outgoing_goods_wms_id_idx ON outgoing_goods (wms_id);
CREATE INDEX outgoing_goods_company_code_idx ON outgoing_goods (company_code);
CREATE INDEX outgoing_goods_outgoing_date_idx ON outgoing_goods (outgoing_date);
CREATE INDEX outgoing_goods_ppkek_number_idx ON outgoing_goods (ppkek_number);
CREATE INDEX outgoing_goods_customs_document_type_idx ON outgoing_goods (customs_document_type);
CREATE INDEX outgoing_goods_outgoing_evidence_number_idx ON outgoing_goods (outgoing_evidence_number);

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

ALTER TABLE adjustments OWNER TO appuser;

-- Create partitions for each company
CREATE TABLE adjustments_1370 PARTITION OF adjustments
    FOR VALUES IN (1370)
    PARTITION BY RANGE (transaction_date);
ALTER TABLE adjustments_1370 OWNER TO appuser;

CREATE TABLE adjustments_1310 PARTITION OF adjustments
    FOR VALUES IN (1310)
    PARTITION BY RANGE (transaction_date);
ALTER TABLE adjustments_1310 OWNER TO appuser;

CREATE TABLE adjustments_1380 PARTITION OF adjustments
    FOR VALUES IN (1380)
    PARTITION BY RANGE (transaction_date);
ALTER TABLE adjustments_1380 OWNER TO appuser;

-- Create date range partitions for company 1370 (2025)
CREATE TABLE adjustments_1370_2025_q1 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE adjustments_1370_2025_q1 OWNER TO appuser;

CREATE TABLE adjustments_1370_2025_q2 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE adjustments_1370_2025_q2 OWNER TO appuser;

CREATE TABLE adjustments_1370_2025_q3 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE adjustments_1370_2025_q3 OWNER TO appuser;

CREATE TABLE adjustments_1370_2025_q4 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE adjustments_1370_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1370 (2026)
CREATE TABLE adjustments_1370_2026_q1 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE adjustments_1370_2026_q1 OWNER TO appuser;

CREATE TABLE adjustments_1370_2026_q2 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE adjustments_1370_2026_q2 OWNER TO appuser;

CREATE TABLE adjustments_1370_2026_q3 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE adjustments_1370_2026_q3 OWNER TO appuser;

CREATE TABLE adjustments_1370_2026_q4 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE adjustments_1370_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2025)
CREATE TABLE adjustments_1310_2025_q1 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE adjustments_1310_2025_q1 OWNER TO appuser;

CREATE TABLE adjustments_1310_2025_q2 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE adjustments_1310_2025_q2 OWNER TO appuser;

CREATE TABLE adjustments_1310_2025_q3 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE adjustments_1310_2025_q3 OWNER TO appuser;

CREATE TABLE adjustments_1310_2025_q4 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE adjustments_1310_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1310 (2026)
CREATE TABLE adjustments_1310_2026_q1 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE adjustments_1310_2026_q1 OWNER TO appuser;

CREATE TABLE adjustments_1310_2026_q2 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE adjustments_1310_2026_q2 OWNER TO appuser;

CREATE TABLE adjustments_1310_2026_q3 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE adjustments_1310_2026_q3 OWNER TO appuser;

CREATE TABLE adjustments_1310_2026_q4 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE adjustments_1310_2026_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2025)
CREATE TABLE adjustments_1380_2025_q1 PARTITION OF adjustments_1380
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
ALTER TABLE adjustments_1380_2025_q1 OWNER TO appuser;

CREATE TABLE adjustments_1380_2025_q2 PARTITION OF adjustments_1380
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
ALTER TABLE adjustments_1380_2025_q2 OWNER TO appuser;

CREATE TABLE adjustments_1380_2025_q3 PARTITION OF adjustments_1380
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
ALTER TABLE adjustments_1380_2025_q3 OWNER TO appuser;

CREATE TABLE adjustments_1380_2025_q4 PARTITION OF adjustments_1380
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE adjustments_1380_2025_q4 OWNER TO appuser;

-- Create date range partitions for company 1380 (2026)
CREATE TABLE adjustments_1380_2026_q1 PARTITION OF adjustments_1380
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
ALTER TABLE adjustments_1380_2026_q1 OWNER TO appuser;

CREATE TABLE adjustments_1380_2026_q2 PARTITION OF adjustments_1380
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
ALTER TABLE adjustments_1380_2026_q2 OWNER TO appuser;

CREATE TABLE adjustments_1380_2026_q3 PARTITION OF adjustments_1380
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
ALTER TABLE adjustments_1380_2026_q3 OWNER TO appuser;

CREATE TABLE adjustments_1380_2026_q4 PARTITION OF adjustments_1380
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
ALTER TABLE adjustments_1380_2026_q4 OWNER TO appuser;

-- Create indexes with Prisma naming convention
CREATE UNIQUE INDEX adjustments_company_code_wms_id_transaction_date_key ON adjustments (company_code, wms_id, transaction_date);
CREATE UNIQUE INDEX adjustments_company_code_id_transaction_date_key ON adjustments (company_code, id, transaction_date);
CREATE INDEX adjustments_wms_id_idx ON adjustments (wms_id);
CREATE INDEX adjustments_company_code_idx ON adjustments (company_code);
CREATE INDEX adjustments_transaction_date_idx ON adjustments (transaction_date);
CREATE INDEX adjustments_internal_evidence_number_idx ON adjustments (internal_evidence_number);

-- ============================================================================
-- 7. STOCK DAILY SNAPSHOT PARTITIONING
-- ============================================================================
-- Drop existing non-partitioned table and recreate as partitioned (by year)
DROP TABLE IF EXISTS stock_daily_snapshot CASCADE;

CREATE TABLE stock_daily_snapshot (
    id BIGSERIAL,
    company_code INTEGER NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    opening_balance DECIMAL(15, 3) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(15, 3) NOT NULL DEFAULT 0,
    incoming_qty DECIMAL(15, 3) NOT NULL DEFAULT 0,
    outgoing_qty DECIMAL(15, 3) NOT NULL DEFAULT 0,
    production_qty DECIMAL(15, 3) NOT NULL DEFAULT 0,
    material_usage_qty DECIMAL(15, 3) NOT NULL DEFAULT 0,
    adjustment_qty DECIMAL(15, 3) NOT NULL DEFAULT 0,
    wip_balance_qty DECIMAL(15, 3),
    snapshot_date DATE NOT NULL,
    calculated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    calculation_method VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL,
    PRIMARY KEY (id, snapshot_date)
) PARTITION BY RANGE (snapshot_date);

ALTER TABLE stock_daily_snapshot OWNER TO appuser;

-- Create yearly partitions for historical data
CREATE TABLE stock_daily_snapshot_2024 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
ALTER TABLE stock_daily_snapshot_2024 OWNER TO appuser;

CREATE TABLE stock_daily_snapshot_2025 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
ALTER TABLE stock_daily_snapshot_2025 OWNER TO appuser;

CREATE TABLE stock_daily_snapshot_2026 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
ALTER TABLE stock_daily_snapshot_2026 OWNER TO appuser;

-- Create indexes with Prisma naming convention
-- UNIQUE INDEX for ON CONFLICT support with UOM
CREATE UNIQUE INDEX stock_daily_snapshot_uom_company_item_snapshot_key 
    ON stock_daily_snapshot (company_code, item_type, item_code, uom, snapshot_date);
CREATE INDEX stock_snapshot_company_date_idx 
    ON stock_daily_snapshot (company_code, snapshot_date);
CREATE INDEX stock_snapshot_item_date_idx 
    ON stock_daily_snapshot (item_type, snapshot_date);
CREATE INDEX stock_snapshot_date_idx 
    ON stock_daily_snapshot (snapshot_date);

-- ============================================================================
-- GRANT FINAL PRIVILEGES TO APPUSER
-- ============================================================================
-- NOTE: Traceability tables (work_order_material_consumption, work_order_fg_production,
-- outgoing_fg_production_traceability) are now created by Prisma during 'prisma db push'.
-- stock_daily_snapshot is recreated here as a partitioned table (see section 7 above).
-- ============================================================================

-- Grant all privileges on all tables (including partitions)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO appuser;

-- Grant all privileges on all sequences
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO appuser;

-- Grant default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO appuser;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO appuser;

-- Reset role
RESET ROLE;

-- ============================================================================
-- NOTES ON PARTITION MAINTENANCE
-- ============================================================================

-- To add new quarterly partitions (run before each quarter):
-- 
-- Example for Q1 2026:
-- CREATE TABLE incoming_goods_1370_2026_q1 PARTITION OF incoming_goods_1370
--     FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
-- ALTER TABLE incoming_goods_1370_2026_q1 OWNER TO appuser;
-- 
-- CREATE TABLE material_usages_1370_2026_q1 PARTITION OF material_usages_1370
--     FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
-- ALTER TABLE material_usages_1370_2026_q1 OWNER TO appuser;
-- 
-- (Repeat for all partitioned tables and companies)

-- To drop old partitions (after 5-year retention):
-- DROP TABLE incoming_goods_1370_2020_q1;

-- To verify partitions:
-- SELECT 
--     schemaname,
--     tablename,
--     tableowner,
--     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
-- FROM pg_tables
-- WHERE tablename LIKE '%_1370_%'
-- ORDER BY tablename;

-- ============================================================================
-- END OF PARTITIONING SETUP
-- ============================================================================