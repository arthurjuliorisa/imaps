-- Test Scrap Query
-- Check if fn_calculate_lpj_barang_sisa function exists and works

\echo '===== TEST 1: Check function exists ====='
SELECT routine_name, routine_type FROM information_schema.routines 
WHERE routine_name = 'fn_calculate_lpj_barang_sisa';

\echo ''
\echo '===== TEST 2: Check scrap transaction data ====='
SELECT COUNT(*) as scrap_transaction_count FROM scrap_transactions;
SELECT COUNT(*) as scrap_item_count FROM scrap_transaction_items;

\echo ''
\echo '===== TEST 3: Sample scrap data ====='
SELECT 
  st.company_code,
  st.id,
  st.transaction_type,
  st.transaction_date,
  sti.item_code,
  sti.item_name,
  sti.qty
FROM scrap_transaction_items sti
JOIN scrap_transactions st ON 
  sti.scrap_transaction_company = st.company_code 
  AND sti.scrap_transaction_id = st.id
  AND sti.scrap_transaction_date = st.transaction_date
WHERE sti.deleted_at IS NULL AND st.deleted_at IS NULL
LIMIT 5;

\echo ''
\echo '===== TEST 4: Test function with current date range ====='
SELECT 
  no,
  company_code,
  company_name,
  item_code,
  item_name,
  item_type,
  opening_balance,
  quantity_received,
  quantity_issued_outgoing,
  closing_balance,
  remarks
FROM fn_calculate_lpj_barang_sisa(
  ARRAY['SCRAP'],
  DATE_TRUNC('year', CURRENT_DATE)::DATE,
  CURRENT_DATE
)
LIMIT 10;

\echo ''
\echo '===== TEST 5: Test function with custom date range (like frontend) ====='
SELECT 
  no,
  company_code,
  company_name,
  item_code,
  item_name,
  opening_balance,
  quantity_received,
  quantity_issued_outgoing,
  closing_balance
FROM fn_calculate_lpj_barang_sisa(
  ARRAY['SCRAP'],
  '2024-12-25'::DATE,
  '2026-01-02'::DATE
)
LIMIT 10;
