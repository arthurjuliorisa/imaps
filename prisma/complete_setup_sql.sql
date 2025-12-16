-- ============================================================================
-- COMPLETE DATABASE SETUP FOR iMAPS - SINGLE FILE EXECUTION
-- ============================================================================
-- File: prisma/complete_setup.sql
-- Purpose: Complete database setup including parent tables, child tables, 
--          partitions, traceability, functions, and views
-- 
-- IMPORTANT: This replaces the need for multiple prisma db push commands
-- Run this ONCE after initial Vercel deployment
-- ============================================================================

-- ============================================================================
-- STEP 1: CLEAN SLATE (Optional - uncomment if needed)
-- ============================================================================

-- DROP SCHEMA public CASCADE;
-- CREATE SCHEMA public;
-- GRANT ALL ON SCHEMA public TO postgres;
-- GRANT ALL ON SCHEMA public TO public;

-- ============================================================================
-- STEP 2: CREATE ENUMS
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE item_type AS ENUM ('ROH', 'HALB', 'FERT', 'HIBE', 'HIBE_M', 'HIBE_E', 'HIBE_T', 'SCRAP');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE adjustment_type AS ENUM ('GAIN', 'LOSS');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE calculation_method AS ENUM ('TRANSACTION', 'WIP_SNAPSHOT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE recalc_status AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- STEP 3: CREATE NON-PARTITIONED REFERENCE TABLES
-- ============================================================================

-- Companies table
DROP TABLE IF EXISTS companies CASCADE;
CREATE TABLE companies (
    code INTEGER PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6)
);

-- Items master table
DROP TABLE IF EXISTS items CASCADE;
CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    company_code INTEGER NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT uk_items_company_code UNIQUE (company_code, item_code),
    CONSTRAINT fk_items_company FOREIGN KEY (company_code) 
        REFERENCES companies(code) ON DELETE CASCADE
);

CREATE INDEX idx_items_company_code ON items(company_code);
CREATE INDEX idx_items_item_type ON items(item_type);
CREATE INDEX idx_items_item_code ON items(item_code);

-- Beginning balances
DROP TABLE IF EXISTS beginning_balances CASCADE;
CREATE TABLE beginning_balances (
    id SERIAL PRIMARY KEY,
    company_code INTEGER NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    qty DECIMAL(15,3) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT uk_beginning_balances UNIQUE (company_code, item_code),
    CONSTRAINT fk_beginning_balances_company FOREIGN KEY (company_code) 
        REFERENCES companies(code) ON DELETE CASCADE
);

CREATE INDEX idx_beginning_balances_company ON beginning_balances(company_code);

-- ============================================================================
-- STEP 4: CREATE PARTITIONED PARENT TABLES
-- ============================================================================

-- 4.1 INCOMING GOODS (Partitioned)
-- ============================================================================
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
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT fk_incoming_goods_company FOREIGN KEY (company_code) 
        REFERENCES companies(code) ON DELETE CASCADE
) PARTITION BY LIST (company_code);

-- Create partitions for incoming_goods
CREATE TABLE incoming_goods_1370 PARTITION OF incoming_goods
    FOR VALUES IN (1370) PARTITION BY RANGE (incoming_date);

CREATE TABLE incoming_goods_1310 PARTITION OF incoming_goods
    FOR VALUES IN (1310) PARTITION BY RANGE (incoming_date);

CREATE TABLE incoming_goods_1380 PARTITION OF incoming_goods
    FOR VALUES IN (1380) PARTITION BY RANGE (incoming_date);

-- Create date range partitions for 1370 (2025)
CREATE TABLE incoming_goods_1370_2025_q1 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE incoming_goods_1370_2025_q2 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE incoming_goods_1370_2025_q3 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE incoming_goods_1370_2025_q4 PARTITION OF incoming_goods_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Create date range partitions for 1310 (2026)
CREATE TABLE incoming_goods_1310_2026_q1 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE incoming_goods_1310_2026_q2 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE incoming_goods_1310_2026_q3 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE incoming_goods_1310_2026_q4 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Indexes for incoming_goods
CREATE UNIQUE INDEX incoming_goods_company_code_wms_id_incoming_date_key 
    ON incoming_goods (company_code, wms_id, incoming_date);
CREATE UNIQUE INDEX incoming_goods_company_code_id_incoming_date_key 
    ON incoming_goods (company_code, id, incoming_date);
CREATE INDEX incoming_goods_wms_id_idx ON incoming_goods (wms_id);
CREATE INDEX incoming_goods_company_code_idx ON incoming_goods (company_code);
CREATE INDEX incoming_goods_incoming_date_idx ON incoming_goods (incoming_date);
CREATE INDEX incoming_goods_ppkek_number_idx ON incoming_goods (ppkek_number);

-- 4.2 OUTGOING GOODS (Partitioned)
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
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT fk_outgoing_goods_company FOREIGN KEY (company_code) 
        REFERENCES companies(code) ON DELETE CASCADE
) PARTITION BY LIST (company_code);

-- Create partitions for outgoing_goods
CREATE TABLE outgoing_goods_1370 PARTITION OF outgoing_goods
    FOR VALUES IN (1370) PARTITION BY RANGE (outgoing_date);
CREATE TABLE outgoing_goods_1310 PARTITION OF outgoing_goods
    FOR VALUES IN (1310) PARTITION BY RANGE (outgoing_date);
CREATE TABLE outgoing_goods_1380 PARTITION OF outgoing_goods
    FOR VALUES IN (1380) PARTITION BY RANGE (outgoing_date);

-- Date range partitions for 1370
CREATE TABLE outgoing_goods_1370_2025_q1 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE outgoing_goods_1370_2025_q2 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE outgoing_goods_1370_2025_q3 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE outgoing_goods_1370_2025_q4 PARTITION OF outgoing_goods_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Date range partitions for 1310
CREATE TABLE outgoing_goods_1310_2026_q1 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE outgoing_goods_1310_2026_q2 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE outgoing_goods_1310_2026_q3 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE outgoing_goods_1310_2026_q4 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Indexes
CREATE UNIQUE INDEX outgoing_goods_company_code_wms_id_outgoing_date_key 
    ON outgoing_goods (company_code, wms_id, outgoing_date);
CREATE UNIQUE INDEX outgoing_goods_company_code_id_outgoing_date_key 
    ON outgoing_goods (company_code, id, outgoing_date);
CREATE INDEX outgoing_goods_wms_id_idx ON outgoing_goods (wms_id);
CREATE INDEX outgoing_goods_company_code_idx ON outgoing_goods (company_code);
CREATE INDEX outgoing_goods_outgoing_date_idx ON outgoing_goods (outgoing_date);
CREATE INDEX outgoing_goods_ppkek_number_idx ON outgoing_goods (ppkek_number);

-- 4.3 MATERIAL USAGES (Partitioned)
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
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT fk_material_usages_company FOREIGN KEY (company_code) 
        REFERENCES companies(code) ON DELETE CASCADE
) PARTITION BY LIST (company_code);

-- Create partitions
CREATE TABLE material_usages_1370 PARTITION OF material_usages
    FOR VALUES IN (1370) PARTITION BY RANGE (transaction_date);
CREATE TABLE material_usages_1310 PARTITION OF material_usages
    FOR VALUES IN (1310) PARTITION BY RANGE (transaction_date);
CREATE TABLE material_usages_1380 PARTITION OF material_usages
    FOR VALUES IN (1380) PARTITION BY RANGE (transaction_date);

-- Date ranges for 1370
CREATE TABLE material_usages_1370_2025_q1 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE material_usages_1370_2025_q2 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE material_usages_1370_2025_q3 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE material_usages_1370_2025_q4 PARTITION OF material_usages_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Date ranges for 1310
CREATE TABLE material_usages_1310_2026_q1 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE material_usages_1310_2026_q2 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE material_usages_1310_2026_q3 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE material_usages_1310_2026_q4 PARTITION OF material_usages_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Indexes
CREATE UNIQUE INDEX material_usages_company_code_wms_id_transaction_date_key 
    ON material_usages (company_code, wms_id, transaction_date);
CREATE UNIQUE INDEX material_usages_company_code_id_transaction_date_key 
    ON material_usages (company_code, id, transaction_date);
CREATE INDEX material_usages_wms_id_idx ON material_usages (wms_id);
CREATE INDEX material_usages_company_code_idx ON material_usages (company_code);
CREATE INDEX material_usages_transaction_date_idx ON material_usages (transaction_date);
CREATE INDEX material_usages_work_order_number_idx ON material_usages (work_order_number);

-- 4.4 PRODUCTION OUTPUTS (Partitioned)
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
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT fk_production_outputs_company FOREIGN KEY (company_code) 
        REFERENCES companies(code) ON DELETE CASCADE
) PARTITION BY LIST (company_code);

-- Create partitions
CREATE TABLE production_outputs_1370 PARTITION OF production_outputs
    FOR VALUES IN (1370) PARTITION BY RANGE (transaction_date);
CREATE TABLE production_outputs_1310 PARTITION OF production_outputs
    FOR VALUES IN (1310) PARTITION BY RANGE (transaction_date);
CREATE TABLE production_outputs_1380 PARTITION OF production_outputs
    FOR VALUES IN (1380) PARTITION BY RANGE (transaction_date);

-- Date ranges for 1370
CREATE TABLE production_outputs_1370_2025_q1 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE production_outputs_1370_2025_q2 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE production_outputs_1370_2025_q3 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE production_outputs_1370_2025_q4 PARTITION OF production_outputs_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Date ranges for 1310
CREATE TABLE production_outputs_1310_2026_q1 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE production_outputs_1310_2026_q2 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE production_outputs_1310_2026_q3 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE production_outputs_1310_2026_q4 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Indexes
CREATE UNIQUE INDEX production_outputs_company_code_wms_id_transaction_date_key 
    ON production_outputs (company_code, wms_id, transaction_date);
CREATE UNIQUE INDEX production_outputs_company_code_id_transaction_date_key 
    ON production_outputs (company_code, id, transaction_date);
CREATE INDEX production_outputs_wms_id_idx ON production_outputs (wms_id);
CREATE INDEX production_outputs_company_code_idx ON production_outputs (company_code);
CREATE INDEX production_outputs_transaction_date_idx ON production_outputs (transaction_date);

-- 4.5 WIP BALANCES (Partitioned)
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
    qty DECIMAL(15,3) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT fk_wip_balances_company FOREIGN KEY (company_code) 
        REFERENCES companies(code) ON DELETE CASCADE
) PARTITION BY LIST (company_code);

-- Create partitions
CREATE TABLE wip_balances_1370 PARTITION OF wip_balances
    FOR VALUES IN (1370) PARTITION BY RANGE (stock_date);
CREATE TABLE wip_balances_1310 PARTITION OF wip_balances
    FOR VALUES IN (1310) PARTITION BY RANGE (stock_date);
CREATE TABLE wip_balances_1380 PARTITION OF wip_balances
    FOR VALUES IN (1380) PARTITION BY RANGE (stock_date);

-- Date ranges for 1370
CREATE TABLE wip_balances_1370_2025_q1 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE wip_balances_1370_2025_q2 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE wip_balances_1370_2025_q3 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE wip_balances_1370_2025_q4 PARTITION OF wip_balances_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Date ranges for 1310
CREATE TABLE wip_balances_1310_2026_q1 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE wip_balances_1310_2026_q2 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE wip_balances_1310_2026_q3 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE wip_balances_1310_2026_q4 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Indexes
CREATE UNIQUE INDEX wip_balances_company_code_wms_id_stock_date_key 
    ON wip_balances (company_code, wms_id, stock_date);
CREATE INDEX wip_balances_wms_id_idx ON wip_balances (wms_id);
CREATE INDEX wip_balances_company_code_idx ON wip_balances (company_code);
CREATE INDEX wip_balances_stock_date_idx ON wip_balances (stock_date);
CREATE INDEX wip_balances_item_code_idx ON wip_balances (item_code);

-- 4.6 ADJUSTMENTS (Partitioned)
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
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT fk_adjustments_company FOREIGN KEY (company_code) 
        REFERENCES companies(code) ON DELETE CASCADE
) PARTITION BY LIST (company_code);

-- Create partitions
CREATE TABLE adjustments_1370 PARTITION OF adjustments
    FOR VALUES IN (1370) PARTITION BY RANGE (transaction_date);
CREATE TABLE adjustments_1310 PARTITION OF adjustments
    FOR VALUES IN (1310) PARTITION BY RANGE (transaction_date);
CREATE TABLE adjustments_1380 PARTITION OF adjustments
    FOR VALUES IN (1380) PARTITION BY RANGE (transaction_date);

-- Date ranges for 1370
CREATE TABLE adjustments_1370_2025_q1 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE adjustments_1370_2025_q2 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE adjustments_1370_2025_q3 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE adjustments_1370_2025_q4 PARTITION OF adjustments_1370
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Date ranges for 1310
CREATE TABLE adjustments_1310_2026_q1 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE adjustments_1310_2026_q2 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE adjustments_1310_2026_q3 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE adjustments_1310_2026_q4 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Indexes
CREATE UNIQUE INDEX adjustments_company_code_wms_id_transaction_date_key 
    ON adjustments (company_code, wms_id, transaction_date);
CREATE UNIQUE INDEX adjustments_company_code_id_transaction_date_key 
    ON adjustments (company_code, id, transaction_date);
CREATE INDEX adjustments_wms_id_idx ON adjustments (wms_id);
CREATE INDEX adjustments_company_code_idx ON adjustments (company_code);
CREATE INDEX adjustments_transaction_date_idx ON adjustments (transaction_date);

-- ============================================================================
-- STEP 5: CREATE CHILD/DETAIL TABLES (NON-PARTITIONED)
-- ============================================================================

-- 5.1 INCOMING GOOD ITEMS
-- ============================================================================
DROP TABLE IF EXISTS incoming_good_items CASCADE;

CREATE TABLE incoming_good_items (
    id SERIAL PRIMARY KEY,
    incoming_good_id INTEGER NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    qty DECIMAL(15,3) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT chk_incoming_good_items_qty CHECK (qty > 0),
    CONSTRAINT chk_incoming_good_items_amount CHECK (amount >= 0)
);

CREATE INDEX idx_incoming_good_items_good_id ON incoming_good_items(incoming_good_id);
CREATE INDEX idx_incoming_good_items_item_code ON incoming_good_items(item_code);
CREATE INDEX idx_incoming_good_items_item_type ON incoming_good_items(item_type);

COMMENT ON TABLE incoming_good_items IS 'Detail items for incoming goods';

-- 5.2 OUTGOING GOOD ITEMS
-- ============================================================================
DROP TABLE IF EXISTS outgoing_good_items CASCADE;

CREATE TABLE outgoing_good_items (
    id SERIAL PRIMARY KEY,
    outgoing_good_id INTEGER NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    qty DECIMAL(15,3) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    production_output_wms_ids TEXT[],
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT chk_outgoing_good_items_qty CHECK (qty > 0),
    CONSTRAINT chk_outgoing_good_items_amount CHECK (amount >= 0)
);

CREATE INDEX idx_outgoing_good_items_good_id ON outgoing_good_items(outgoing_good_id);
CREATE INDEX idx_outgoing_good_items_item_code ON outgoing_good_items(item_code);
CREATE INDEX idx_outgoing_good_items_item_type ON outgoing_good_items(item_type);

COMMENT ON TABLE outgoing_good_items IS 'Detail items for outgoing goods';

-- 5.3 MATERIAL USAGE ITEMS
-- ============================================================================
DROP TABLE IF EXISTS material_usage_items CASCADE;

CREATE TABLE material_usage_items (
    id SERIAL PRIMARY KEY,
    material_usage_id INTEGER NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    qty DECIMAL(15,3) NOT NULL,
    ppkek_number VARCHAR(50),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT chk_material_usage_items_qty CHECK (qty > 0)
);

CREATE INDEX idx_material_usage_items_usage_id ON material_usage_items(material_usage_id);
CREATE INDEX idx_material_usage_items_item_code ON material_usage_items(item_code);
CREATE INDEX idx_material_usage_items_item_type ON material_usage_items(item_type);
CREATE INDEX idx_material_usage_items_ppkek ON material_usage_items(ppkek_number) 
    WHERE ppkek_number IS NOT NULL;

COMMENT ON TABLE material_usage_items IS 'Detail items for material usages';

-- 5.4 PRODUCTION OUTPUT ITEMS
-- ============================================================================
DROP TABLE IF EXISTS production_output_items CASCADE;

CREATE TABLE production_output_items (
    id SERIAL PRIMARY KEY,
    production_output_id INTEGER NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    qty DECIMAL(15,3) NOT NULL,
    work_order_numbers TEXT[],
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT chk_production_output_items_qty CHECK (qty > 0),
    CONSTRAINT chk_production_output_items_type CHECK (item_type IN ('FERT', 'HALB', 'SCRAP'))
);

CREATE INDEX idx_production_output_items_output_id ON production_output_items(production_output_id);
CREATE INDEX idx_production_output_items_item_code ON production_output_items(item_code);
CREATE INDEX idx_production_output_items_item_type ON production_output_items(item_type);

COMMENT ON TABLE production_output_items IS 'Detail items for production outputs';

-- 5.5 ADJUSTMENT ITEMS
-- ============================================================================
DROP TABLE IF EXISTS adjustment_items CASCADE;

CREATE TABLE adjustment_items (
    id SERIAL PRIMARY KEY,
    adjustment_id INTEGER NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    adjustment_type adjustment_type NOT NULL,
    qty DECIMAL(15,3) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),
    CONSTRAINT chk_adjustment_items_qty CHECK (qty > 0)
);

CREATE INDEX idx_adjustment_items_adjustment_id ON adjustment_items(adjustment_id);
CREATE INDEX idx_adjustment_items_item_code ON adjustment_items(item_code);
CREATE INDEX idx_adjustment_items_item_type ON adjustment_items(item_type);
CREATE INDEX idx_adjustment_items_adjustment_type ON adjustment_items(adjustment_type);

COMMENT ON TABLE adjustment_items IS 'Detail items for adjustments (gains/losses)';

-- ============================================================================
-- STEP 6: CREATE TRACEABILITY TABLES (from 05_traceability_tables.sql)
-- ============================================================================

-- 6.1 OUTGOING FG PRODUCTION TRACEABILITY
-- ============================================================================
DROP TABLE IF EXISTS outgoing_fg_production_traceability CASCADE;

CREATE TABLE outgoing_fg_production_traceability (
    id BIGSERIAL NOT NULL,
    outgoing_good_item_id INTEGER NOT NULL,
    outgoing_wms_id VARCHAR(100) NOT NULL,
    production_wms_id VARCHAR(100) NOT NULL,
    company_code INTEGER NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    trx_date DATE NOT NULL,
    allocated_qty DECIMAL(15,3),
    allocation_notes TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_outgoing_fg_trace_qty CHECK (allocated_qty IS NULL OR allocated_qty > 0)
) PARTITION BY RANGE (trx_date);

-- Create partitions (2025-2026)
CREATE TABLE outgoing_fg_production_traceability_2025_q1 
    PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE outgoing_fg_production_traceability_2025_q2 
    PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE outgoing_fg_production_traceability_2025_q3 
    PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE outgoing_fg_production_traceability_2025_q4 
    PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
CREATE TABLE outgoing_fg_production_traceability_2026_q1 
    PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE outgoing_fg_production_traceability_2026_q2 
    PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE outgoing_fg_production_traceability_2026_q3 
    PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE outgoing_fg_production_traceability_2026_q4 
    PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Indexes
CREATE INDEX idx_outgoing_fg_trace_outgoing_wms 
    ON outgoing_fg_production_traceability (outgoing_wms_id, trx_date);
CREATE INDEX idx_outgoing_fg_trace_production_wms 
    ON outgoing_fg_production_traceability (production_wms_id, trx_date);
CREATE INDEX idx_outgoing_fg_trace_company 
    ON outgoing_fg_production_traceability (company_code, trx_date);
CREATE INDEX idx_outgoing_fg_trace_item 
    ON outgoing_fg_production_traceability (item_code, trx_date);

-- 6.2 WORK ORDER MATERIAL CONSUMPTION
-- ============================================================================
DROP TABLE IF EXISTS work_order_material_consumption CASCADE;

CREATE TABLE work_order_material_consumption (
    id BIGSERIAL NOT NULL,
    material_usage_id INTEGER NOT NULL,
    material_usage_item_id INTEGER NOT NULL,
    material_usage_wms_id VARCHAR(100) NOT NULL,
    work_order_number VARCHAR(50) NOT NULL,
    company_code INTEGER NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    ppkek_number VARCHAR(50),
    qty_consumed DECIMAL(15,3) NOT NULL,
    trx_date DATE NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_work_order_material_qty CHECK (qty_consumed > 0)
) PARTITION BY RANGE (trx_date);

-- Create partitions
CREATE TABLE work_order_material_consumption_2025_q1 
    PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE work_order_material_consumption_2025_q2 
    PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE work_order_material_consumption_2025_q3 
    PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE work_order_material_consumption_2025_q4 
    PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
CREATE TABLE work_order_material_consumption_2026_q1 
    PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE work_order_material_consumption_2026_q2 
    PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE work_order_material_consumption_2026_q3 
    PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE work_order_material_consumption_2026_q4 
    PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Indexes
CREATE INDEX idx_work_order_material_wms 
    ON work_order_material_consumption (material_usage_wms_id, trx_date);
CREATE INDEX idx_work_order_material_wo 
    ON work_order_material_consumption (work_order_number, trx_date);
CREATE INDEX idx_work_order_material_company 
    ON work_order_material_consumption (company_code, trx_date);
CREATE INDEX idx_work_order_material_ppkek 
    ON work_order_material_consumption (ppkek_number, trx_date) 
    WHERE ppkek_number IS NOT NULL;

-- 6.3 WORK ORDER FG PRODUCTION
-- ============================================================================
DROP TABLE IF EXISTS work_order_fg_production CASCADE;

CREATE TABLE work_order_fg_production (
    id BIGSERIAL NOT NULL,
    production_output_id INTEGER NOT NULL,
    production_output_item_id INTEGER NOT NULL,
    production_wms_id VARCHAR(100) NOT NULL,
    work_order_number VARCHAR(50) NOT NULL,
    company_code INTEGER NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    qty_produced DECIMAL(15,3) NOT NULL,
    trx_date DATE NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_work_order_fg_production_item_type CHECK (item_type IN ('FERT', 'HALB')),
    CONSTRAINT chk_work_order_fg_production_qty CHECK (qty_produced > 0)
) PARTITION BY RANGE (trx_date);

-- Create partitions
CREATE TABLE work_order_fg_production_2025_q1 
    PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE work_order_fg_production_2025_q2 
    PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE work_order_fg_production_2025_q3 
    PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE work_order_fg_production_2025_q4 
    PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
CREATE TABLE work_order_fg_production_2026_q1 
    PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE work_order_fg_production_2026_q2 
    PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE work_order_fg_production_2026_q3 
    PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE work_order_fg_production_2026_q4 
    PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Indexes
CREATE INDEX idx_work_order_fg_wms 
    ON work_order_fg_production (production_wms_id, trx_date);
CREATE INDEX idx_work_order_fg_wo 
    ON work_order_fg_production (work_order_number, trx_date);
CREATE INDEX idx_work_order_fg_company 
    ON work_order_fg_production (company_code, trx_date);
CREATE INDEX idx_work_order_fg_item 
    ON work_order_fg_production (item_code, trx_date);

-- 6.4 STOCK DAILY SNAPSHOT
-- ============================================================================
DROP TABLE IF EXISTS stock_daily_snapshot CASCADE;

CREATE TABLE stock_daily_snapshot (
    id BIGSERIAL NOT NULL,
    company_code INTEGER NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    opening_balance DECIMAL(15,3) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(15,3) NOT NULL DEFAULT 0,
    incoming_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
    outgoing_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
    production_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
    material_usage_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
    adjustment_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
    wip_balance_qty DECIMAL(15,3),
    snapshot_date DATE NOT NULL,
    calculated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    calculation_method calculation_method NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_stock_snapshot UNIQUE (company_code, item_type, item_code, snapshot_date)
) PARTITION BY RANGE (snapshot_date);

-- Create partitions
CREATE TABLE stock_daily_snapshot_2025_q1 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE stock_daily_snapshot_2025_q2 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE stock_daily_snapshot_2025_q3 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE stock_daily_snapshot_2025_q4 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
CREATE TABLE stock_daily_snapshot_2026_q1 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE stock_daily_snapshot_2026_q2 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE stock_daily_snapshot_2026_q3 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE stock_daily_snapshot_2026_q4 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Indexes
CREATE INDEX idx_stock_snapshot_company ON stock_daily_snapshot (company_code, snapshot_date);
CREATE INDEX idx_stock_snapshot_item_type ON stock_daily_snapshot (item_type, snapshot_date);
CREATE INDEX idx_stock_snapshot_item ON stock_daily_snapshot (item_code, snapshot_date);

-- 6.5 SNAPSHOT RECALC QUEUE
-- ============================================================================
DROP TABLE IF EXISTS snapshot_recalc_queue CASCADE;

CREATE TABLE snapshot_recalc_queue (
    id BIGSERIAL PRIMARY KEY,
    company_code INTEGER NOT NULL,
    item_type VARCHAR(10),
    item_code VARCHAR(50),
    recalc_date DATE NOT NULL,
    status recalc_status NOT NULL DEFAULT 'PENDING',
    priority INTEGER NOT NULL DEFAULT 0,
    reason VARCHAR(500),
    queued_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ(6),
    completed_at TIMESTAMPTZ(6),
    error_message TEXT,
    CONSTRAINT fk_snapshot_recalc_company FOREIGN KEY (company_code) 
        REFERENCES companies(code) ON DELETE CASCADE
);

CREATE INDEX idx_recalc_queue_status 
    ON snapshot_recalc_queue (status, priority DESC, queued_at);
CREATE INDEX idx_recalc_queue_company 
    ON snapshot_recalc_queue (company_code, recalc_date);

-- ============================================================================
-- STEP 7: CREATE UTILITY FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 8: CREATE TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- This is included in 08_functions.sql but we add some here
CREATE TRIGGER trg_outgoing_fg_trace_updated_at
    BEFORE UPDATE ON outgoing_fg_production_traceability
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_stock_daily_snapshot_updated_at
    BEFORE UPDATE ON stock_daily_snapshot
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- END OF COMPLETE SETUP
-- ============================================================================

-- Verification query
SELECT 
    'Tables created successfully. Run these to verify:' as message
UNION ALL
SELECT '1. SELECT tablename FROM pg_tables WHERE schemaname = ''public'' ORDER BY tablename;'
UNION ALL
SELECT '2. SELECT * FROM companies;'
UNION ALL  
SELECT '3. SELECT * FROM items LIMIT 10;';

RAISE NOTICE 'Database setup complete! Remember to:';
RAISE NOTICE '1. Run 08_functions.sql for calculation functions';
RAISE NOTICE '2. Run create_views.sql for reporting views';
RAISE NOTICE '3. Run seed script to populate initial data';