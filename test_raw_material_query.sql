-- Test Raw Material Query - Simulasi Frontend Request
-- Company: 1310
-- FIXED: Sekarang seharusnya data muncul dari periode manapun

\echo '===== TEST 1: Periode dengan snapshot sebelum range (2024-12-25 to 2025-01-01) ====='

SELECT
  no,
  company_code,
  company_name,
  item_code,
  item_name,
  item_type,
  opening_balance as beginning,
  quantity_received as inflow,
  quantity_issued_outgoing as outflow,
  closing_balance as ending,
  remarks
FROM fn_calculate_lpj_bahan_baku(
  ARRAY['ROH', 'HALB', 'HIBE'],
  '2024-12-25'::DATE,
  '2025-01-01'::DATE
)
WHERE company_code = 1310
  AND (item_type IN ('ROH', 'HIBE') 
       OR (item_type = 'HALB' AND (quantity_received > 0 OR opening_balance > 0)))
ORDER BY item_code;

\echo ''
\echo '===== TEST 2: FIXED - Periode SETELAH snapshot (3 Dec 2025 to 2 Jan 2026) ====='
\echo 'Seharusnya sekarang data MUNCUL dengan opening balance dari 1 Jan 2025'

SELECT
  no,
  company_code,
  company_name,
  item_code,
  item_name,
  item_type,
  opening_balance as beginning,
  quantity_received as inflow,
  quantity_issued_outgoing as outflow,
  closing_balance as ending,
  remarks
FROM fn_calculate_lpj_bahan_baku(
  ARRAY['ROH', 'HALB', 'HIBE'],
  '2025-12-03'::DATE,
  '2026-01-02'::DATE
)
WHERE company_code = 1310
  AND (item_type IN ('ROH', 'HIBE') 
       OR (item_type = 'HALB' AND (quantity_received > 0 OR opening_balance > 0)))
ORDER BY item_code;

\echo ''
\echo '===== TEST 3: Edge case - Far future date (2026-06-01 to 2026-12-31) ====='
\echo 'Seharusnya tetap muncul dengan opening balance dari last snapshot'

SELECT
  no,
  company_code,
  company_name,
  item_code,
  item_name,
  item_type,
  opening_balance as beginning,
  quantity_received as inflow,
  quantity_issued_outgoing as outflow,
  closing_balance as ending,
  remarks
FROM fn_calculate_lpj_bahan_baku(
  ARRAY['ROH', 'HALB', 'HIBE'],
  '2026-06-01'::DATE,
  '2026-12-31'::DATE
)
WHERE company_code = 1310
  AND (item_type IN ('ROH', 'HIBE') 
       OR (item_type = 'HALB' AND (quantity_received > 0 OR opening_balance > 0)))
ORDER BY item_code;
