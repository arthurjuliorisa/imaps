-- =============================================================================
-- iMAPS Payload-Driven Item Description Sync Audit
-- Purpose: SELECT-only verification after the function-only hotfix is deployed.
--
-- This audit intentionally does not call get_latest_stock_item_name(...).
-- Runtime description sync is driven by the accepted WMS payload item_name.
-- =============================================================================

-- 1. Verify helper exists.
SELECT proname
FROM pg_proc
WHERE proname = 'sync_item_description_from_payload';

-- 2. Verify no WIP quantity rows in SDS.
SELECT COUNT(*)
FROM stock_daily_snapshot
WHERE calculation_method = 'WIP_SNAPSHOT';

-- 3. Verify SDS rows after material usage retransmit.
SELECT
  snapshot_date,
  item_name,
  opening_balance,
  closing_balance,
  material_usage_qty,
  updated_at
FROM stock_daily_snapshot
WHERE company_code = 1310
  AND item_type = 'HALB'
  AND item_code = 'SA-1310-204'
  AND uom = 'PCS'
ORDER BY snapshot_date;

-- 4. Verify WIP rows for same identity.
SELECT
  stock_date,
  item_name,
  qty,
  updated_at
FROM wip_balances
WHERE company_code = 1310
  AND item_type = 'HALB'
  AND item_code = 'SA-1310-204'
  AND uom = 'PCS'
ORDER BY stock_date;
