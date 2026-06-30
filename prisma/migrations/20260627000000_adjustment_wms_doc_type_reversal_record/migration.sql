-- Preserve historical adjustment.wms_doc_type strings and add indexes used by
-- Adjustment and Reversal Record queries.
CREATE INDEX IF NOT EXISTS "adjustments_company_wms_doc_type_transaction_date_idx"
ON "adjustments" ("company_code", "wms_doc_type", "transaction_date");

CREATE INDEX IF NOT EXISTS "adjustments_company_transaction_date_idx"
ON "adjustments" ("company_code", "transaction_date");

CREATE INDEX IF NOT EXISTS "adjustment_items_stockcount_identity_idx"
ON "adjustment_items" ("stockcount_order_number", "item_type", "item_code", "uom");
