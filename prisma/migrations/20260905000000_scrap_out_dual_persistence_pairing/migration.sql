-- Deterministic Scrap OUT pairing. Historical rows are only bound when the
-- header and line matches are unique in both directions.
ALTER TABLE "outgoing_goods" ADD COLUMN "scrap_transaction_id" INTEGER;
ALTER TABLE "outgoing_good_items" ADD COLUMN "scrap_transaction_item_id" INTEGER;

WITH candidates AS (
  SELECT og.id AS outgoing_id, og.company_code, og.outgoing_date, st.id AS scrap_id,
    COUNT(*) OVER (PARTITION BY og.company_code, og.id, og.outgoing_date) AS scrap_count,
    COUNT(*) OVER (PARTITION BY st.company_code, st.id, st.transaction_date) AS outgoing_count
  FROM outgoing_goods og
  JOIN scrap_transactions st
    ON st.company_code = og.company_code
   AND st.transaction_date = og.outgoing_date
   AND st.transaction_type = 'OUT'
   AND st.document_number = og.outgoing_evidence_number
   AND ((st.deleted_at IS NULL) = (og.deleted_at IS NULL))
  WHERE EXISTS (
    SELECT 1 FROM outgoing_good_items ogi
    WHERE ogi.outgoing_good_id = og.id
      AND ogi.outgoing_good_company = og.company_code
      AND ogi.outgoing_good_date = og.outgoing_date
      AND ogi.item_type = 'SCRAP'
  )
), unique_pairs AS (
  SELECT outgoing_id, company_code, outgoing_date, scrap_id FROM candidates
  WHERE scrap_count = 1 AND outgoing_count = 1
)
UPDATE outgoing_goods og SET scrap_transaction_id = p.scrap_id
FROM unique_pairs p
WHERE og.company_code = p.company_code
  AND og.id = p.outgoing_id
  AND og.outgoing_date = p.outgoing_date;

WITH candidates AS (
  SELECT ogi.id AS outgoing_item_id, ogi.outgoing_good_company, ogi.outgoing_good_date,
    sti.id AS scrap_item_id,
    COUNT(*) OVER (PARTITION BY ogi.id) AS scrap_count,
    COUNT(*) OVER (PARTITION BY sti.id) AS outgoing_count
  FROM outgoing_good_items ogi
  JOIN outgoing_goods og
    ON og.company_code = ogi.outgoing_good_company
   AND og.id = ogi.outgoing_good_id
   AND og.outgoing_date = ogi.outgoing_good_date
  JOIN scrap_transaction_items sti
    ON sti.scrap_transaction_id = og.scrap_transaction_id
   AND sti.scrap_transaction_company = ogi.outgoing_good_company
   AND sti.scrap_transaction_date = ogi.outgoing_good_date
   AND sti.item_type = ogi.item_type
   AND sti.item_code = ogi.item_code
   AND sti.item_name = ogi.item_name
   AND sti.uom = ogi.uom
   AND sti.qty = ogi.qty
   AND sti.currency = ogi.currency
   AND sti.amount = ogi.amount
   AND ((sti.deleted_at IS NULL) = (ogi.deleted_at IS NULL))
  WHERE og.scrap_transaction_id IS NOT NULL AND ogi.item_type = 'SCRAP'
), unique_pairs AS (
  SELECT outgoing_item_id, outgoing_good_company, outgoing_good_date, scrap_item_id
  FROM candidates
  WHERE scrap_count = 1 AND outgoing_count = 1
)
UPDATE outgoing_good_items ogi SET scrap_transaction_item_id = p.scrap_item_id
FROM unique_pairs p
WHERE ogi.id = p.outgoing_item_id
  AND ogi.outgoing_good_company = p.outgoing_good_company
  AND ogi.outgoing_good_date = p.outgoing_good_date;

-- Include both levels of the outgoing_goods partition hierarchy. The date is
-- also part of the paired Scrap header key, preventing cross-company/date links.
CREATE UNIQUE INDEX "outgoing_goods_company_code_scrap_transaction_id_outgoing_d_key"
  ON "outgoing_goods"("company_code", "scrap_transaction_id", "outgoing_date");
CREATE UNIQUE INDEX "scrap_transaction_items_scrap_transaction_company_id_scrap__key"
  ON "scrap_transaction_items"("scrap_transaction_company", "id", "scrap_transaction_date");
CREATE UNIQUE INDEX "outgoing_good_items_outgoing_good_company_scrap_transaction_key"
  ON "outgoing_good_items"("outgoing_good_company", "scrap_transaction_item_id", "outgoing_good_date");
ALTER TABLE "outgoing_goods" ADD CONSTRAINT "outgoing_goods_company_code_scrap_transaction_id_outgoing__fkey"
  FOREIGN KEY ("company_code", "scrap_transaction_id", "outgoing_date")
  REFERENCES "scrap_transactions"("company_code", "id", "transaction_date")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outgoing_good_items" ADD CONSTRAINT "outgoing_good_items_outgoing_good_company_scrap_transactio_fkey"
  FOREIGN KEY ("outgoing_good_company", "scrap_transaction_item_id", "outgoing_good_date")
  REFERENCES "scrap_transaction_items"("scrap_transaction_company", "id", "scrap_transaction_date")
  ON DELETE RESTRICT ON UPDATE CASCADE;
