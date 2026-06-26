-- =============================================================================
-- iMAPS Production Hotfix
-- Incoming Goods nullable invoice number and invoice date
--
-- Safe production hotfix command:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/sql/production/20260625_incoming_goods_nullable_invoice_hotfix.sql
--
-- This patch is non-destructive and idempotent:
--   - validates public.incoming_goods and both invoice columns;
--   - drops NOT NULL only when still present on the partitioned parent;
--   - recursively verifies every currently attached partition;
--   - changes no rows, values, indexes, constraints, ownership, views, or
--     partition attachments.
--
-- DO NOT run scripts/sql/01_setup_partitions.sql for this change.
-- That bootstrap script drops and recreates partitioned tables.
-- =============================================================================

SET lock_timeout = '10s';

DO $$
DECLARE
  v_parent_oid oid;
  v_invoice_number_not_null boolean;
  v_invoice_date_not_null boolean;
  v_invoice_number_type text;
  v_invoice_date_type text;
  v_partition_count integer;
  v_partition_column_count integer;
  v_not_null_partition_column_count integer;
BEGIN
  RAISE NOTICE
    'Running Incoming Goods nullable invoice hotfix on database % as user %',
    current_database(),
    current_user;

  SELECT c.oid
  INTO v_parent_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relname = 'incoming_goods'
    AND c.relkind = 'p';

  IF v_parent_oid IS NULL THEN
    RAISE EXCEPTION
      'Expected public.incoming_goods to exist as a partitioned parent table';
  END IF;

  SELECT a.attnotnull, format_type(a.atttypid, a.atttypmod)
  INTO v_invoice_number_not_null, v_invoice_number_type
  FROM pg_attribute a
  WHERE a.attrelid = v_parent_oid
    AND a.attname = 'invoice_number'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Expected column public.incoming_goods.invoice_number is missing';
  END IF;

  IF v_invoice_number_type <> 'character varying(50)' THEN
    RAISE EXCEPTION
      'Unexpected type for public.incoming_goods.invoice_number: %',
      v_invoice_number_type;
  END IF;

  SELECT a.attnotnull, format_type(a.atttypid, a.atttypmod)
  INTO v_invoice_date_not_null, v_invoice_date_type
  FROM pg_attribute a
  WHERE a.attrelid = v_parent_oid
    AND a.attname = 'invoice_date'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Expected column public.incoming_goods.invoice_date is missing';
  END IF;

  IF v_invoice_date_type <> 'date' THEN
    RAISE EXCEPTION
      'Unexpected type for public.incoming_goods.invoice_date: %',
      v_invoice_date_type;
  END IF;

  IF v_invoice_number_not_null THEN
    EXECUTE
      'ALTER TABLE public.incoming_goods ALTER COLUMN invoice_number DROP NOT NULL';
    RAISE NOTICE 'Dropped NOT NULL from public.incoming_goods.invoice_number';
  ELSE
    RAISE NOTICE 'public.incoming_goods.invoice_number is already nullable';
  END IF;

  IF v_invoice_date_not_null THEN
    EXECUTE
      'ALTER TABLE public.incoming_goods ALTER COLUMN invoice_date DROP NOT NULL';
    RAISE NOTICE 'Dropped NOT NULL from public.incoming_goods.invoice_date';
  ELSE
    RAISE NOTICE 'public.incoming_goods.invoice_date is already nullable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = v_parent_oid
      AND a.attname IN ('invoice_number', 'invoice_date')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attnotnull
  ) THEN
    RAISE EXCEPTION
      'Parent postcondition failed: Incoming Goods invoice columns remain NOT NULL';
  END IF;

  WITH RECURSIVE incoming_goods_partitions AS (
    SELECT child.oid AS partition_oid
    FROM pg_inherits i
    JOIN pg_class child ON child.oid = i.inhrelid
    WHERE i.inhparent = v_parent_oid

    UNION ALL

    SELECT child.oid AS partition_oid
    FROM incoming_goods_partitions parent_partition
    JOIN pg_inherits i ON i.inhparent = parent_partition.partition_oid
    JOIN pg_class child ON child.oid = i.inhrelid
  )
  SELECT COUNT(*)
  INTO v_partition_count
  FROM incoming_goods_partitions;

  IF v_partition_count = 0 THEN
    RAISE EXCEPTION
      'Expected public.incoming_goods to have attached partitions';
  END IF;

  WITH RECURSIVE incoming_goods_partitions AS (
    SELECT child.oid AS partition_oid
    FROM pg_inherits i
    JOIN pg_class child ON child.oid = i.inhrelid
    WHERE i.inhparent = v_parent_oid

    UNION ALL

    SELECT child.oid AS partition_oid
    FROM incoming_goods_partitions parent_partition
    JOIN pg_inherits i ON i.inhparent = parent_partition.partition_oid
    JOIN pg_class child ON child.oid = i.inhrelid
  )
  SELECT
    COUNT(*) FILTER (
      WHERE a.attname IN ('invoice_number', 'invoice_date')
        AND a.attnum > 0
        AND NOT a.attisdropped
    ),
    COUNT(*) FILTER (
      WHERE a.attname IN ('invoice_number', 'invoice_date')
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attnotnull
    )
  INTO
    v_partition_column_count,
    v_not_null_partition_column_count
  FROM incoming_goods_partitions p
  LEFT JOIN pg_attribute a ON a.attrelid = p.partition_oid;

  IF v_partition_column_count <> v_partition_count * 2 THEN
    RAISE EXCEPTION
      'Partition postcondition failed: expected % invoice columns across % partitions, found %',
      v_partition_count * 2,
      v_partition_count,
      v_partition_column_count;
  END IF;

  IF v_not_null_partition_column_count <> 0 THEN
    RAISE EXCEPTION
      'Partition postcondition failed: % invoice column(s) remain NOT NULL',
      v_not_null_partition_column_count;
  END IF;

  RAISE NOTICE
    'Incoming Goods nullable invoice hotfix verified across % attached partition(s)',
    v_partition_count;
END $$;

-- Manual pre/post-deployment evidence should compare:
--   SELECT COUNT(*) FROM public.incoming_goods;
--   SELECT
--     COUNT(*) FILTER (WHERE invoice_number IS NULL) AS null_invoice_number,
--     COUNT(*) FILTER (WHERE invoice_date IS NULL) AS null_invoice_date
--   FROM public.incoming_goods;
-- plus pg_indexes, pg_constraint, pg_inherits, ownership, and partition bounds.
