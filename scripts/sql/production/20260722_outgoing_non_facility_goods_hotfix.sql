-- =============================================================================
-- iMAPS Production Hotfix
-- Non-Facility N Marker for Incoming and Outgoing Goods
--
-- Safe production command:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/sql/production/20260722_outgoing_non_facility_goods_hotfix.sql
--
-- Deployment order:
--   1. Apply this SQL before deploying application code that writes outgoing
--      non-facility rows.
--   2. Deploy application code.
--   3. Run the normal Prisma migration deploy when available.
--
-- Rollback considerations:
--   - The schema changes are additive/relaxed and intentionally non-destructive.
--   - Rolling back application code can leave the columns in place safely.
--   - Do not drop is_non_facility during rollback; historical rows may depend on it.
--
-- Historical remediation:
--   - This script does not auto-classify existing outgoing rows.
--   - If a legacy source can prove the full N/N/N marker for specific rows,
--     remediate only those rows explicitly, for example:
--       UPDATE outgoing_goods
--       SET is_non_facility = true,
--           customs_document_type = NULL,
--           customs_registration_date = NULL
--       WHERE company_code = <company_code>
--         AND wms_id = ANY(ARRAY[<known_wms_ids>])
--         AND ppkek_number = 'N';
-- =============================================================================

ALTER TABLE incoming_goods
  ADD COLUMN IF NOT EXISTS is_non_facility BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE incoming_goods
  ALTER COLUMN customs_document_type DROP NOT NULL,
  ALTER COLUMN customs_registration_date DROP NOT NULL;

ALTER TABLE outgoing_goods
  ADD COLUMN IF NOT EXISTS is_non_facility BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE outgoing_goods
  ALTER COLUMN customs_document_type DROP NOT NULL,
  ALTER COLUMN customs_registration_date DROP NOT NULL;

DO $$
DECLARE
  dependent_count integer;
BEGIN
  SELECT COUNT(*)
  INTO dependent_count
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid = d.objid
  JOIN pg_class dependent_view ON dependent_view.oid = r.ev_class
  WHERE d.refobjid IN ('vw_laporan_pemasukan'::regclass, 'vw_laporan_pengeluaran'::regclass)
    AND dependent_view.oid NOT IN ('vw_laporan_pemasukan'::regclass, 'vw_laporan_pengeluaran'::regclass);

  IF dependent_count > 0 THEN
    RAISE NOTICE 'Dependent views detected for laporan views; using append-only CREATE OR REPLACE VIEW definitions';
  END IF;
END $$;

DO $$
DECLARE
  missing_count integer;
BEGIN
  WITH RECURSIVE incoming_goods_partitions AS (
    SELECT child.oid AS child_oid, child.relname AS child_table_name, child_namespace.nspname AS child_schema_name
    FROM pg_inherits
    JOIN pg_class child ON child.oid = pg_inherits.inhrelid
    JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
    WHERE pg_inherits.inhparent = 'incoming_goods'::regclass
    UNION ALL
    SELECT child.oid AS child_oid, child.relname AS child_table_name, child_namespace.nspname AS child_schema_name
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

DO $$
DECLARE
  missing_count integer;
BEGIN
  WITH RECURSIVE outgoing_goods_partitions AS (
    SELECT child.oid AS child_oid, child.relname AS child_table_name, child_namespace.nspname AS child_schema_name
    FROM pg_inherits
    JOIN pg_class child ON child.oid = pg_inherits.inhrelid
    JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
    WHERE pg_inherits.inhparent = 'outgoing_goods'::regclass
    UNION ALL
    SELECT child.oid AS child_oid, child.relname AS child_table_name, child_namespace.nspname AS child_schema_name
    FROM outgoing_goods_partitions parent_partition
    JOIN pg_inherits ON pg_inherits.inhparent = parent_partition.child_oid
    JOIN pg_class child ON child.oid = pg_inherits.inhrelid
    JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
  )
  SELECT COUNT(*)
  INTO missing_count
  FROM outgoing_goods_partitions p
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = p.child_schema_name
      AND c.table_name = p.child_table_name
      AND c.column_name = 'is_non_facility'
  );

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Some outgoing_goods partitions do not have is_non_facility column';
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

CREATE OR REPLACE VIEW vw_laporan_pengeluaran AS
SELECT 
    og.id,
    og.wms_id,
    og.company_code,
    c.name as company_name,
    c.company_type,
    og.customs_document_type,
    og.ppkek_number as cust_doc_registration_no,
    og.customs_registration_date as reg_date,
    og.outgoing_evidence_number as doc_number,
    og.outgoing_date as doc_date,
    og.recipient_name,
    ogi.item_type as type_code,
    ogi.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    ogi.item_name,
    ogi.uom as unit,
    ogi.qty as quantity,
    ogi.currency,
    ogi.amount as value_amount,
    ogi.incoming_ppkek_numbers,
    og.created_at,
    og.updated_at,
    og.deleted_at,
    og.is_non_facility
FROM outgoing_goods og
JOIN outgoing_good_items ogi ON og.company_code = ogi.outgoing_good_company
    AND og.id = ogi.outgoing_good_id
    AND og.outgoing_date = ogi.outgoing_good_date
JOIN companies c ON og.company_code = c.code
LEFT JOIN item_types it ON ogi.item_type = it.item_type_code
WHERE og.deleted_at IS NULL
  AND ogi.deleted_at IS NULL
ORDER BY og.outgoing_date DESC, og.id, ogi.id;

COMMENT ON VIEW vw_laporan_pemasukan IS 'Report #1: Goods Receiving Report - includes persisted non-facility marker for INSW document handling';
COMMENT ON VIEW vw_laporan_pengeluaran IS 'Report #2: Goods Issuance Report - includes persisted non-facility marker for INSW document handling';
