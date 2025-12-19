-- =============================================================================
-- iMAPS Database Schema - Traceability Tables
-- File: 05_traceability_tables.sql
-- Purpose: Junction tables, calculation tables, and recalc queue
-- Compatible with: schema.prisma v2.4 + setup_partitions.sql
-- =============================================================================

-- =============================================================================
-- ENUMS (if not exists)
-- =============================================================================

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

-- =============================================================================
-- UTILITY FUNCTION: update_updated_at_column
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. OUTGOING FG/HALB PRODUCTION TRACEABILITY (Junction Table)
-- =============================================================================
-- Links outgoing FERT/HALB items to their production batches for PPKEK traceability

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'outgoing_fg_production_traceability') THEN
        DROP TABLE outgoing_fg_production_traceability CASCADE;
    END IF;
END $$;

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

COMMENT ON TABLE outgoing_fg_production_traceability IS 'Many-to-Many: Outgoing FERT/HALB to Production batches for PPKEK traceability';
COMMENT ON COLUMN outgoing_fg_production_traceability.production_wms_id IS 'Links to production_outputs.wms_id';
COMMENT ON COLUMN outgoing_fg_production_traceability.allocated_qty IS 'Optional: Qty from this production batch';
COMMENT ON COLUMN outgoing_fg_production_traceability.outgoing_good_item_id IS 'FK to outgoing_good_items.id';

-- =============================================================================
-- 2. WORK ORDER MATERIAL CONSUMPTION (Traceability)
-- =============================================================================
-- Tracks which materials (with PPKEK) were used in which work orders

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_order_material_consumption') THEN
        DROP TABLE work_order_material_consumption CASCADE;
    END IF;
END $$;

CREATE TABLE work_order_material_consumption (
    id BIGSERIAL NOT NULL,
    material_usage_id INTEGER NOT NULL,
    material_usage_item_id INTEGER NOT NULL,
    material_usage_wms_id VARCHAR(100) NOT NULL,
    work_order_number VARCHAR(50) NOT NULL,
    company_code INTEGER NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    ppkek_number VARCHAR(50), -- NULLABLE (materials from adjustments may not have PPKEK)
    qty_consumed DECIMAL(15,3) NOT NULL,
    trx_date DATE NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_work_order_material_qty CHECK (qty_consumed > 0)
) PARTITION BY RANGE (trx_date);

COMMENT ON TABLE work_order_material_consumption IS 'Raw materials to Work orders traceability (PPKEK tracking)';
COMMENT ON COLUMN work_order_material_consumption.ppkek_number IS 'PPKEK for traceability (nullable for adjustment-sourced materials)';
COMMENT ON COLUMN work_order_material_consumption.material_usage_id IS 'FK to material_usages.id';
COMMENT ON COLUMN work_order_material_consumption.material_usage_item_id IS 'FK to material_usage_items.id';

-- =============================================================================
-- 3. WORK ORDER FG/HALB PRODUCTION (Traceability)
-- =============================================================================
-- Tracks which work orders produced which FERT/HALB items

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_order_fg_production') THEN
        DROP TABLE work_order_fg_production CASCADE;
    END IF;
END $$;

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

COMMENT ON TABLE work_order_fg_production IS 'Work orders to Finished/Semifinished goods traceability';
COMMENT ON COLUMN work_order_fg_production.item_type IS 'FERT or HALB only';
COMMENT ON COLUMN work_order_fg_production.production_output_id IS 'FK to production_outputs.id';
COMMENT ON COLUMN work_order_fg_production.production_output_item_id IS 'FK to production_output_items.id';

-- =============================================================================
-- 4. STOCK DAILY SNAPSHOT (Calculation Table)
-- =============================================================================
-- Calculated daily stock balance for all inventory items

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_daily_snapshot') THEN
        DROP TABLE stock_daily_snapshot CASCADE;
    END IF;
END $$;

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
    adjustment_qty DECIMAL(15,3) NOT NULL DEFAULT 0, -- Can be positive (GAIN) or negative (LOSS)
    wip_balance_qty DECIMAL(15,3), -- For HALB only (snapshot-based)
    snapshot_date DATE NOT NULL,
    calculated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    calculation_method calculation_method NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_stock_snapshot UNIQUE (company_code, item_type, item_code, snapshot_date)
) PARTITION BY RANGE (snapshot_date);

COMMENT ON TABLE stock_daily_snapshot IS 'Calculated daily stock balance for all inventory items';
COMMENT ON COLUMN stock_daily_snapshot.adjustment_qty IS 'Adjustment quantity (+ for GAIN, - for LOSS)';
COMMENT ON COLUMN stock_daily_snapshot.wip_balance_qty IS 'WIP balance (HALB only, snapshot-based)';
COMMENT ON COLUMN stock_daily_snapshot.calculation_method IS 'TRANSACTION or WIP_SNAPSHOT';

-- Calculation Logic:
-- ROH: opening + incoming - material_usage +/- adjustment
-- HALB: wip_balance_qty (snapshot-based)
-- FERT: opening + production - outgoing +/- adjustment
-- HIBE/HIBE_M/HIBE_E/HIBE_T: opening + incoming - material_usage - outgoing +/- adjustment
-- SCRAP: opening + incoming - outgoing +/- adjustment

-- =============================================================================
-- 5. SNAPSHOT RECALCULATION QUEUE
-- =============================================================================
-- Queue for recalculating stock snapshots (backdated transactions)

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'snapshot_recalc_queue') THEN
        DROP TABLE snapshot_recalc_queue CASCADE;
    END IF;
END $$;

CREATE TABLE snapshot_recalc_queue (
    id BIGSERIAL PRIMARY KEY,
    company_code INTEGER NOT NULL,
    item_type VARCHAR(10), -- NULL = all types
    item_code VARCHAR(50), -- NULL = all items
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

COMMENT ON TABLE snapshot_recalc_queue IS 'Queue for recalculating stock snapshots (backdated transactions)';
COMMENT ON COLUMN snapshot_recalc_queue.priority IS 'Priority (higher = more urgent, default 0)';
COMMENT ON COLUMN snapshot_recalc_queue.item_type IS 'NULL = recalculate all item types';
COMMENT ON COLUMN snapshot_recalc_queue.item_code IS 'NULL = recalculate all items';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- outgoing_fg_production_traceability indexes
CREATE INDEX idx_outgoing_fg_trace_outgoing_wms ON outgoing_fg_production_traceability (outgoing_wms_id, trx_date);
CREATE INDEX idx_outgoing_fg_trace_production_wms ON outgoing_fg_production_traceability (production_wms_id, trx_date);
CREATE INDEX idx_outgoing_fg_trace_company ON outgoing_fg_production_traceability (company_code, trx_date);
CREATE INDEX idx_outgoing_fg_trace_item ON outgoing_fg_production_traceability (item_code, trx_date);

-- work_order_material_consumption indexes
CREATE INDEX idx_work_order_material_wms ON work_order_material_consumption (material_usage_wms_id, trx_date);
CREATE INDEX idx_work_order_material_wo ON work_order_material_consumption (work_order_number, trx_date);
CREATE INDEX idx_work_order_material_company ON work_order_material_consumption (company_code, trx_date);
CREATE INDEX idx_work_order_material_ppkek ON work_order_material_consumption (ppkek_number, trx_date) WHERE ppkek_number IS NOT NULL;

-- work_order_fg_production indexes
CREATE INDEX idx_work_order_fg_wms ON work_order_fg_production (production_wms_id, trx_date);
CREATE INDEX idx_work_order_fg_wo ON work_order_fg_production (work_order_number, trx_date);
CREATE INDEX idx_work_order_fg_company ON work_order_fg_production (company_code, trx_date);
CREATE INDEX idx_work_order_fg_item ON work_order_fg_production (item_code, trx_date);

-- stock_daily_snapshot indexes
CREATE INDEX idx_stock_snapshot_company ON stock_daily_snapshot (company_code, snapshot_date);
CREATE INDEX idx_stock_snapshot_item_type ON stock_daily_snapshot (item_type, snapshot_date);
CREATE INDEX idx_stock_snapshot_item ON stock_daily_snapshot (item_code, snapshot_date);

-- snapshot_recalc_queue indexes
CREATE INDEX idx_recalc_queue_status ON snapshot_recalc_queue (status, priority DESC, queued_at);
CREATE INDEX idx_recalc_queue_company ON snapshot_recalc_queue (company_code, recalc_date);

-- =============================================================================
-- TRIGGERS FOR UPDATED_AT
-- =============================================================================

CREATE TRIGGER trg_outgoing_fg_trace_updated_at
    BEFORE UPDATE ON outgoing_fg_production_traceability
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_stock_daily_snapshot_updated_at
    BEFORE UPDATE ON stock_daily_snapshot
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- PARTITIONS (Company 1310 for 2026 - Development)
-- =============================================================================
-- Note: Add partitions for other companies (1370, 1380) in production

-- outgoing_fg_production_traceability partitions (2026)
CREATE TABLE outgoing_fg_production_traceability_2026_q1 PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE outgoing_fg_production_traceability_2026_q2 PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE outgoing_fg_production_traceability_2026_q3 PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE outgoing_fg_production_traceability_2026_q4 PARTITION OF outgoing_fg_production_traceability
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- work_order_material_consumption partitions (2026)
CREATE TABLE work_order_material_consumption_2026_q1 PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE work_order_material_consumption_2026_q2 PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE work_order_material_consumption_2026_q3 PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE work_order_material_consumption_2026_q4 PARTITION OF work_order_material_consumption
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- work_order_fg_production partitions (2026)
CREATE TABLE work_order_fg_production_2026_q1 PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE work_order_fg_production_2026_q2 PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE work_order_fg_production_2026_q3 PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE work_order_fg_production_2026_q4 PARTITION OF work_order_fg_production
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- stock_daily_snapshot partitions (2026)
CREATE TABLE stock_daily_snapshot_2026_q1 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE stock_daily_snapshot_2026_q2 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE stock_daily_snapshot_2026_q3 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE stock_daily_snapshot_2026_q4 PARTITION OF stock_daily_snapshot
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- =============================================================================
-- GRANT PERMISSIONS TO APPUSER
-- =============================================================================

-- Grant permissions on all traceability tables to appuser
GRANT SELECT, INSERT, UPDATE, DELETE ON outgoing_fg_production_traceability TO appuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON work_order_material_consumption TO appuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON work_order_fg_production TO appuser;

-- Grant permissions on stock_daily_snapshot table and all its partitions
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_daily_snapshot TO appuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON snapshot_recalc_queue TO appuser;

-- Grant permissions on all tables in public schema (covers all partitions)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appuser;

-- Grant sequence permissions for BIGSERIAL columns
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO appuser;

-- Grant ownership of all public schema objects to appuser
-- This prevents "must be owner of table" errors when executing functions
REASSIGN OWNED BY postgres TO appuser;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Verify partitions created
-- SELECT tablename FROM pg_tables 
-- WHERE tablename LIKE '%_2026_%' AND schemaname = 'public'
-- ORDER BY tablename;

-- Verify ENUMs created
-- SELECT enumlabel FROM pg_enum e
-- JOIN pg_type t ON e.enumtypid = t.oid
-- WHERE t.typname IN ('calculation_method', 'recalc_status')
-- ORDER BY t.typname, e.enumsortorder;

-- =============================================================================
-- END OF FILE
-- =============================================================================
