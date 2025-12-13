-- =============================================================================
-- iMAPS v2.4.2 - Setup Partitioned Tables
-- This script drops existing tables and recreates them with partitioning support
-- =============================================================================

-- Drop all transaction tables (in correct order due to foreign keys)
DROP TABLE IF EXISTS outgoing_fg_production_traceability CASCADE;
DROP TABLE IF EXISTS work_order_material_consumption CASCADE;
DROP TABLE IF EXISTS work_order_fg_production CASCADE;
DROP TABLE IF EXISTS stock_daily_snapshot CASCADE;
DROP TABLE IF EXISTS snapshot_recalc_queue CASCADE;
DROP TABLE IF EXISTS adjustment_details CASCADE;
DROP TABLE IF EXISTS adjustments CASCADE;
DROP TABLE IF EXISTS finished_goods_production_details CASCADE;
DROP TABLE IF EXISTS finished_goods_production_headers CASCADE;
DROP TABLE IF EXISTS material_usage_details CASCADE;
DROP TABLE IF EXISTS material_usage_headers CASCADE;
DROP TABLE IF EXISTS outgoing_details CASCADE;
DROP TABLE IF EXISTS outgoing_headers CASCADE;
DROP TABLE IF EXISTS incoming_details CASCADE;
DROP TABLE IF EXISTS incoming_headers CASCADE;
DROP TABLE IF EXISTS wip_balance CASCADE;

-- Now we'll run the partitioned table creation scripts
-- These will be loaded from the separate SQL files
