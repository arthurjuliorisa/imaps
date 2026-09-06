-- Run after the Phase 2 migration. This is read-only and intentionally reports
-- unresolved historical data instead of guessing a pair.
WITH scrap_outgoing AS (
  SELECT og.id, og.company_code, og.outgoing_date, og.outgoing_evidence_number,
    og.scrap_transaction_id,
    COUNT(DISTINCT st.id) FILTER (
      WHERE st.transaction_type = 'OUT'
        AND st.document_number = og.outgoing_evidence_number
        AND st.transaction_date = og.outgoing_date
    ) AS candidate_count
  FROM outgoing_goods og
  JOIN outgoing_good_items ogi
    ON ogi.outgoing_good_company = og.company_code
   AND ogi.outgoing_good_id = og.id
   AND ogi.outgoing_good_date = og.outgoing_date
   AND ogi.item_type = 'SCRAP'
  LEFT JOIN scrap_transactions st
    ON st.company_code = og.company_code
   AND st.transaction_date = og.outgoing_date
  GROUP BY og.company_code, og.id, og.outgoing_date,
    og.outgoing_evidence_number, og.scrap_transaction_id
)
SELECT classification, COUNT(*) AS record_count
FROM (
  SELECT CASE
    WHEN scrap_transaction_id IS NOT NULL THEN 'deterministically_pairable'
    WHEN candidate_count = 0 THEN 'orphaned'
    ELSE 'ambiguous'
  END AS classification
  FROM scrap_outgoing
) classified
GROUP BY classification
ORDER BY classification;

-- Detail for remediation. NULL line references are never repaired implicitly.
SELECT og.company_code, og.id AS outgoing_good_id, og.outgoing_date,
  og.outgoing_evidence_number, og.scrap_transaction_id,
  COUNT(*) FILTER (WHERE ogi.scrap_transaction_item_id IS NULL) AS unpaired_line_count
FROM outgoing_goods og
JOIN outgoing_good_items ogi
  ON ogi.outgoing_good_company = og.company_code
 AND ogi.outgoing_good_id = og.id
 AND ogi.outgoing_good_date = og.outgoing_date
 AND ogi.item_type = 'SCRAP'
WHERE og.scrap_transaction_id IS NULL OR ogi.scrap_transaction_item_id IS NULL
GROUP BY og.company_code, og.id, og.outgoing_date, og.outgoing_evidence_number, og.scrap_transaction_id
ORDER BY og.company_code, og.outgoing_date, og.id;
