-- ============================================================================
-- ADD MISSING 2025 Q4 PARTITIONS FOR COMPANY 1310
-- ============================================================================
-- This script adds missing Q4 2025 partitions for company 1310 tables
-- Required for dates between 2025-10-01 and 2025-12-31
-- ============================================================================

SET ROLE postgres;

-- ============================================================================
-- 1. INCOMING GOODS 2025 Q4 PARTITION FOR COMPANY 1310
-- ============================================================================

CREATE TABLE IF NOT EXISTS incoming_goods_1310_2025_q4 PARTITION OF incoming_goods_1310
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE incoming_goods_1310_2025_q4 OWNER TO appuser;

-- ============================================================================
-- 2. OUTGOING GOODS 2025 Q4 PARTITION FOR COMPANY 1310
-- ============================================================================

CREATE TABLE IF NOT EXISTS outgoing_goods_1310_2025_q4 PARTITION OF outgoing_goods_1310
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE outgoing_goods_1310_2025_q4 OWNER TO appuser;

-- ============================================================================
-- 3. PRODUCTION OUTPUTS 2025 Q4 PARTITION FOR COMPANY 1310
-- ============================================================================

CREATE TABLE IF NOT EXISTS production_outputs_1310_2025_q4 PARTITION OF production_outputs_1310
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE production_outputs_1310_2025_q4 OWNER TO appuser;

-- ============================================================================
-- 4. WIP BALANCES 2025 Q4 PARTITION FOR COMPANY 1310
-- ============================================================================

CREATE TABLE IF NOT EXISTS wip_balances_1310_2025_q4 PARTITION OF wip_balances_1310
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE wip_balances_1310_2025_q4 OWNER TO appuser;

-- ============================================================================
-- 5. ADJUSTMENTS 2025 Q4 PARTITION FOR COMPANY 1310
-- ============================================================================

CREATE TABLE IF NOT EXISTS adjustments_1310_2025_q4 PARTITION OF adjustments_1310
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
ALTER TABLE adjustments_1310_2025_q4 OWNER TO appuser;

-- Grant all privileges
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO appuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO appuser;

RESET ROLE;

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================
-- Run this to verify partitions were created:
--
-- SELECT
--     schemaname,
--     tablename,
--     tableowner
-- FROM pg_tables
-- WHERE tablename LIKE '%_1310_2025_q4%'
-- ORDER BY tablename;
