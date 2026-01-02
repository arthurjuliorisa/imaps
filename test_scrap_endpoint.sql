-- Test Scrap Endpoint Query (dari stock_daily_snapshot)
-- Simulate: company_code = 1310, startDate = 2024-12-25, endDate = 2025-01-01

SELECT
  ROW_NUMBER() OVER (PARTITION BY sds.company_code ORDER BY sds.item_code, sds.snapshot_date) as no,
  sds.company_code,
  c.name as company_name,
  sds.item_code,
  sds.item_name,
  sds.item_type,
  sds.uom as unit,
  sds.snapshot_date,
  sds.opening_balance,
  sds.incoming_qty as "in",
  sds.outgoing_qty as "out",
  sds.adjustment_qty as adjustment,
  sds.closing_balance as ending
FROM stock_daily_snapshot sds
JOIN companies c ON sds.company_code = c.code
WHERE sds.company_code = 1310
  AND sds.item_type = 'SCRAP'
  AND sds.snapshot_date BETWEEN '2024-12-25'::DATE AND '2025-01-01'::DATE
ORDER BY sds.item_code, sds.snapshot_date;
