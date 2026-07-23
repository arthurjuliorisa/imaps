-- Reconcile non-facility customs storage for incoming and outgoing goods.
-- This migration is intentionally idempotent-friendly because incoming_goods
-- may already have been hotfixed in production before this Prisma migration.

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
