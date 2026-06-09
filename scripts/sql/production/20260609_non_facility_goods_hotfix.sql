-- =============================================================================
-- iMAPS Production Hotfix
-- Stage 2: Non-Facility Goods Handling
--
-- Safe production hotfix command:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/sql/production/20260609_non_facility_goods_hotfix.sql
--
-- This patch is non-destructive:
--   - adds incoming_goods.is_non_facility if missing;
--   - relaxes incoming_goods customs document/date NOT NULL constraints;
--   - verifies existing incoming_goods partitions inherited the new column;
--   - updates only the views required for Stage 2 visibility/filtering.
--
-- PostgreSQL declarative partitioning requires column additions and inherited
-- column constraint changes to be applied to the partitioned parent table.
-- =============================================================================

ALTER TABLE incoming_goods
  ADD COLUMN IF NOT EXISTS is_non_facility BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE incoming_goods
  ALTER COLUMN customs_document_type DROP NOT NULL,
  ALTER COLUMN customs_registration_date DROP NOT NULL;

DO $$
DECLARE
  missing_count integer;
BEGIN
  WITH RECURSIVE incoming_goods_partitions AS (
    SELECT
      child.oid AS child_oid,
      child.relname AS child_table_name,
      child_namespace.nspname AS child_schema_name
    FROM pg_inherits
    JOIN pg_class child ON child.oid = pg_inherits.inhrelid
    JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
    WHERE pg_inherits.inhparent = 'incoming_goods'::regclass

    UNION ALL

    SELECT
      child.oid AS child_oid,
      child.relname AS child_table_name,
      child_namespace.nspname AS child_schema_name
    FROM incoming_goods_partitions parent_partition
    JOIN pg_inherits ON pg_inherits.inhparent = parent_partition.child_oid
    JOIN pg_class child ON child.oid = pg_inherits.inhrelid
    JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
  )
  SELECT COUNT(*)
  INTO missing_count
  FROM incoming_goods_partitions p
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = p.child_schema_name
      AND c.table_name = p.child_table_name
      AND c.column_name = 'is_non_facility'
  );

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Some incoming_goods partitions do not have is_non_facility column';
  END IF;
END $$;

CREATE OR REPLACE VIEW vw_laporan_pemasukan AS
SELECT
    ig.id,
    ig.company_code,
    c.name as company_name,
    c.company_type,
    ig.customs_document_type,
    ig.ppkek_number as cust_doc_registration_no,
    ig.customs_registration_date as reg_date,
    ig.incoming_evidence_number as doc_number,
    ig.incoming_date as doc_date,
    ig.shipper_name,
    ig.wms_id,
    igi.item_type as type_code,
    igi.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    igi.item_name,
    igi.uom as unit,
    igi.qty as quantity,
    igi.currency,
    igi.amount as value_amount,
    ig.created_at,
    ig.updated_at,
    ig.deleted_at,
    ig.is_non_facility
FROM incoming_goods ig
JOIN incoming_good_items igi ON ig.company_code = igi.incoming_good_company
    AND ig.id = igi.incoming_good_id
    AND ig.incoming_date = igi.incoming_good_date
JOIN companies c ON ig.company_code = c.code
LEFT JOIN item_types it ON igi.item_type = it.item_type_code
WHERE ig.deleted_at IS NULL
  AND igi.deleted_at IS NULL
ORDER BY ig.incoming_date DESC, ig.id, igi.id;

CREATE OR REPLACE VIEW vw_internal_outgoing AS
SELECT
    mu.id,
    mu.wms_id,
    mu.company_code,
    c.name as company_name,
    c.company_type,
    mu.internal_evidence_number,
    mu.transaction_date,
    mu.section,
    mui.item_type as type_code,
    mui.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    mui.item_name,
    mui.uom as unit,
    mui.qty as quantity,
    mui.amount as value_amount,
    'MATERIAL_USAGE'::VARCHAR(50) as source_type,
    'material_usage_items'::VARCHAR(100) as source_table,
    mui.id as source_item_id,
    mui.ppkek_number,
    (mui.ppkek_number = 'N') as is_non_facility
FROM material_usages mu
JOIN material_usage_items mui ON mu.company_code = mui.material_usage_company
    AND mu.id = mui.material_usage_id
    AND mu.transaction_date = mui.material_usage_date
JOIN companies c ON mu.company_code = c.code
LEFT JOIN item_types it ON mui.item_type = it.item_type_code
WHERE mu.deleted_at IS NULL
  AND mui.deleted_at IS NULL
  AND mu.reversal IS NULL

UNION ALL

SELECT
    po.id,
    po.wms_id,
    po.company_code,
    c.name as company_name,
    c.company_type,
    po.internal_evidence_number,
    po.transaction_date,
    po.section,
    poi.item_type as type_code,
    poi.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    poi.item_name,
    poi.uom as unit,
    poi.qty as quantity,
    poi.amount as value_amount,
    'PRODUCTION_OUTPUT_REVERSAL'::VARCHAR(50) as source_type,
    'production_output_items'::VARCHAR(100) as source_table,
    poi.id as source_item_id,
    NULL::VARCHAR(50) as ppkek_number,
    false as is_non_facility
FROM production_outputs po
JOIN production_output_items poi ON po.company_code = poi.production_output_company
    AND po.id = poi.production_output_id
    AND po.transaction_date = poi.production_output_date
JOIN companies c ON po.company_code = c.code
LEFT JOIN item_types it ON poi.item_type = it.item_type_code
WHERE po.deleted_at IS NULL
  AND poi.deleted_at IS NULL
  AND po.reversal = 'Y'

UNION ALL

SELECT
    st.id,
    st.document_number as wms_id,
    st.company_code,
    c.name as company_name,
    c.company_type,
    st.document_number::VARCHAR(50) as internal_evidence_number,
    st.transaction_date,
    'General Section'::VARCHAR(100) as section,
    sti.item_type as type_code,
    sti.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    sti.item_name,
    sti.uom as unit,
    sti.qty as quantity,
    sti.amount::NUMERIC(19,4) as value_amount,
    'SCRAP_TRANSACTION'::VARCHAR(50) as source_type,
    'scrap_transaction_items'::VARCHAR(100) as source_table,
    sti.id as source_item_id,
    NULL::VARCHAR(50) as ppkek_number,
    false as is_non_facility
FROM scrap_transactions st
JOIN scrap_transaction_items sti ON st.company_code = sti.scrap_transaction_company
    AND st.id = sti.scrap_transaction_id
    AND st.transaction_date = sti.scrap_transaction_date
JOIN companies c ON st.company_code = c.code
LEFT JOIN item_types it ON sti.item_type = it.item_type_code
WHERE st.transaction_type = 'OUT'
  AND st.deleted_at IS NULL
  AND sti.deleted_at IS NULL

ORDER BY transaction_date DESC, company_code, id;

COMMENT ON VIEW vw_laporan_pemasukan IS 'Report #1: Goods Receiving Report - includes non-facility marker for backend visibility filtering';
COMMENT ON VIEW vw_internal_outgoing IS 'Report #9: Internal Outgoing - includes source metadata and non-facility marker for backend visibility filtering';
