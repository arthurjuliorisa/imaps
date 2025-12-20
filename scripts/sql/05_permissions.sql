-- =============================================================================
-- iMAPS Database Schema - Permissions & Grants
-- File: 05_permissions.sql
-- Purpose: Grant necessary privileges to application user for functions and tables
-- Run as: superuser or database owner
-- Version: 2.0 - With conditional checks for robustness
-- =============================================================================

-- NOTE: Replace 'appuser' with your actual application database user
-- IMPORTANT: This script must be run AFTER 03_functions.sql has been executed
-- Run all scripts in this order:
--   1. 00_init_database.sql
--   2. 01_setup_partitions.sql
--   3. 02_traceability_tables.sql
--   4. 03_functions.sql
--   5. 04_create_views.sql
--   6. 05_permissions.sql (this file)

-- =============================================================================
-- 1. FUNCTION EXECUTION GRANTS (Conditional)
-- =============================================================================

-- Grant EXECUTE privilege on snapshot/recalculation functions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'ensure_stock_daily_snapshot_partition') THEN
    GRANT EXECUTE ON FUNCTION ensure_stock_daily_snapshot_partition(DATE) TO appuser;
    RAISE NOTICE 'Granted EXECUTE on ensure_stock_daily_snapshot_partition';
  ELSE
    RAISE WARNING 'Function ensure_stock_daily_snapshot_partition not found - skipping grant';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'calculate_stock_snapshot' AND routine_type = 'FUNCTION') THEN
    GRANT EXECUTE ON FUNCTION calculate_stock_snapshot(INTEGER, DATE) TO appuser;
    RAISE NOTICE 'Granted EXECUTE on calculate_stock_snapshot';
  ELSE
    RAISE WARNING 'Function calculate_stock_snapshot not found - skipping grant';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'calculate_stock_snapshot_range') THEN
    GRANT EXECUTE ON FUNCTION calculate_stock_snapshot_range(INTEGER, DATE, DATE) TO appuser;
    RAISE NOTICE 'Granted EXECUTE on calculate_stock_snapshot_range';
  ELSE
    RAISE WARNING 'Function calculate_stock_snapshot_range not found - skipping grant';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'queue_snapshot_recalculation' AND routine_type = 'FUNCTION') THEN
    GRANT EXECUTE ON FUNCTION queue_snapshot_recalculation(INTEGER, DATE, CHARACTER VARYING, CHARACTER VARYING, CHARACTER VARYING, INTEGER) TO appuser;
    RAISE NOTICE 'Granted EXECUTE on queue_snapshot_recalculation';
  ELSE
    RAISE WARNING 'Function queue_snapshot_recalculation not found - skipping grant';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'process_recalc_queue') THEN
    GRANT EXECUTE ON FUNCTION process_recalc_queue(INTEGER) TO appuser;
    RAISE NOTICE 'Granted EXECUTE on process_recalc_queue';
  ELSE
    RAISE WARNING 'Function process_recalc_queue not found - skipping grant';
  END IF;
END $$;

-- Grant EXECUTE privilege on traceability functions (Conditional)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'populate_work_order_material_consumption' AND routine_type = 'FUNCTION') THEN
    GRANT EXECUTE ON FUNCTION populate_work_order_material_consumption(CHARACTER VARYING) TO appuser;
    RAISE NOTICE 'Granted EXECUTE on populate_work_order_material_consumption';
  ELSE
    RAISE WARNING 'Function populate_work_order_material_consumption not found - skipping grant';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'populate_work_order_fg_production' AND routine_type = 'FUNCTION') THEN
    GRANT EXECUTE ON FUNCTION populate_work_order_fg_production(CHARACTER VARYING) TO appuser;
    RAISE NOTICE 'Granted EXECUTE on populate_work_order_fg_production';
  ELSE
    RAISE WARNING 'Function populate_work_order_fg_production not found - skipping grant';
  END IF;
END $$;

-- =============================================================================
-- 2. TABLE PERMISSION GRANTS (Conditional)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_daily_snapshot') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON stock_daily_snapshot TO appuser;
    RAISE NOTICE 'Granted permissions on stock_daily_snapshot';
  ELSE
    RAISE WARNING 'Table stock_daily_snapshot not found - skipping grant';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'snapshot_recalc_queue') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON snapshot_recalc_queue TO appuser;
    RAISE NOTICE 'Granted permissions on snapshot_recalc_queue';
  ELSE
    RAISE WARNING 'Table snapshot_recalc_queue not found - skipping grant';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_order_material_consumption') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON work_order_material_consumption TO appuser;
    RAISE NOTICE 'Granted permissions on work_order_material_consumption';
  ELSE
    RAISE WARNING 'Table work_order_material_consumption not found - skipping grant';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_order_fg_production') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON work_order_fg_production TO appuser;
    RAISE NOTICE 'Granted permissions on work_order_fg_production';
  ELSE
    RAISE WARNING 'Table work_order_fg_production not found - skipping grant';
  END IF;
END $$;

-- Grant USAGE on ALL sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO appuser;

-- =============================================================================
-- 3. DEFAULT PRIVILEGES (for future objects)
-- =============================================================================

-- Set default privileges for functions created in the future
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO appuser;

-- Set default privileges for tables created in the future
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO appuser;

-- Set default privileges for sequences created in the future
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO appuser;

-- =============================================================================
-- 4. VERIFICATION QUERIES (Run these to verify permissions)
-- =============================================================================

-- Check function permissions
-- SELECT grantee, privilege_type 
-- FROM information_schema.routine_privileges 
-- WHERE routine_name IN (
--   'ensure_stock_daily_snapshot_partition',
--   'calculate_stock_snapshot',
--   'queue_snapshot_recalculation'
-- );

-- Check table permissions
-- SELECT grantee, privilege_type 
-- FROM information_schema.table_privileges 
-- WHERE table_name IN (
--   'stock_daily_snapshot',
--   'snapshot_recalc_queue'
-- );

-- Check current user
-- SELECT current_user;

-- =============================================================================
-- END OF FILE
-- =============================================================================
