-- ============================================================================
-- SCHEMA MIGRATIONS
-- ============================================================================
-- Purpose: Apply schema changes that Prisma db push cannot handle automatically
--          due to partitioned tables, dependent views, and enum type conversions.
--
-- Run via: npm run deploy:sql
-- Or manually: psql -U postgres -d imaps -f scripts/sql/06_schema_migrations.sql
-- ============================================================================


-- ============================================================================
-- MIGRATION 001: Convert varchar columns to enum types
-- ============================================================================
-- Reason: Prisma schema defines CustomsDocumentType and CalculationMethod as
-- enums, but DB columns were created as varchar. This aligns DB with schema.
-- Blocked by: dependent reporting views must be dropped and recreated.
-- ============================================================================

DO $$
BEGIN

  -- Fix incoming_goods.customs_document_type: varchar -> CustomsDocumentType enum
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'incoming_goods'
      AND column_name = 'customs_document_type'
      AND data_type = 'character varying'
  ) THEN
    DROP VIEW IF EXISTS vw_laporan_pemasukan;

    ALTER TABLE incoming_goods
      ALTER COLUMN customs_document_type TYPE "CustomsDocumentType"
      USING customs_document_type::"CustomsDocumentType";

    RAISE NOTICE 'Altered incoming_goods.customs_document_type to CustomsDocumentType enum';
  ELSE
    RAISE NOTICE 'incoming_goods.customs_document_type already correct type, skipping';
  END IF;

  -- Fix outgoing_goods.customs_document_type: varchar -> CustomsDocumentType enum
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'outgoing_goods'
      AND column_name = 'customs_document_type'
      AND data_type = 'character varying'
  ) THEN
    DROP VIEW IF EXISTS vw_laporan_pengeluaran;

    ALTER TABLE outgoing_goods
      ALTER COLUMN customs_document_type TYPE "CustomsDocumentType"
      USING customs_document_type::"CustomsDocumentType";

    RAISE NOTICE 'Altered outgoing_goods.customs_document_type to CustomsDocumentType enum';
  ELSE
    RAISE NOTICE 'outgoing_goods.customs_document_type already correct type, skipping';
  END IF;

  -- Fix stock_daily_snapshot.calculation_method: varchar -> calculation_method enum
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_daily_snapshot'
      AND column_name = 'calculation_method'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE stock_daily_snapshot
      ALTER COLUMN calculation_method TYPE calculation_method
      USING calculation_method::calculation_method;

    RAISE NOTICE 'Altered stock_daily_snapshot.calculation_method to calculation_method enum';
  ELSE
    RAISE NOTICE 'stock_daily_snapshot.calculation_method already correct type, skipping';
  END IF;

END $$;


-- ============================================================================
-- MIGRATION 002: Recreate reporting views after enum column changes
-- ============================================================================

CREATE OR REPLACE VIEW vw_laporan_pemasukan AS
 SELECT ig.id,
    ig.company_code,
    c.name AS company_name,
    ig.customs_document_type,
    ig.ppkek_number AS cust_doc_registration_no,
    ig.customs_registration_date AS reg_date,
    ig.incoming_evidence_number AS doc_number,
    ig.incoming_date AS doc_date,
    ig.shipper_name,
    igi.item_type AS type_code,
    igi.item_code,
    (COALESCE(it.name_id, ''::character varying))::character varying(100) AS item_code_bahasa,
    igi.item_name,
    igi.uom AS unit,
    igi.qty AS quantity,
    igi.currency,
    igi.amount AS value_amount,
    ig.created_at,
    ig.updated_at,
    ig.deleted_at
   FROM (((incoming_goods ig
     JOIN incoming_good_items igi ON (((ig.company_code = igi.incoming_good_company) AND (ig.id = igi.incoming_good_id) AND (ig.incoming_date = igi.incoming_good_date))))
     JOIN companies c ON ((ig.company_code = c.code)))
     LEFT JOIN item_types it ON (((igi.item_type)::text = (it.item_type_code)::text)))
  WHERE ((ig.deleted_at IS NULL) AND (igi.deleted_at IS NULL))
  ORDER BY ig.incoming_date DESC, ig.id, igi.id;

CREATE OR REPLACE VIEW vw_laporan_pengeluaran AS
 SELECT og.id,
    og.wms_id,
    og.company_code,
    c.name AS company_name,
    og.customs_document_type,
    og.ppkek_number AS cust_doc_registration_no,
    og.customs_registration_date AS reg_date,
    og.outgoing_evidence_number AS doc_number,
    og.outgoing_date AS doc_date,
    og.recipient_name,
    ogi.item_type AS type_code,
    ogi.item_code,
    (COALESCE(it.name_id, ''::character varying))::character varying(100) AS item_code_bahasa,
    ogi.item_name,
    ogi.uom AS unit,
    ogi.qty AS quantity,
    ogi.currency,
    ogi.amount AS value_amount,
    ogi.incoming_ppkek_numbers,
    og.created_at,
    og.updated_at,
    og.deleted_at
   FROM (((outgoing_goods og
     JOIN outgoing_good_items ogi ON (((og.company_code = ogi.outgoing_good_company) AND (og.id = ogi.outgoing_good_id) AND (og.outgoing_date = ogi.outgoing_good_date))))
     JOIN companies c ON ((og.company_code = c.code)))
     LEFT JOIN item_types it ON (((ogi.item_type)::text = (it.item_type_code)::text)))
  WHERE ((og.deleted_at IS NULL) AND (ogi.deleted_at IS NULL))
  ORDER BY og.outgoing_date DESC, og.id, ogi.id;


-- ============================================================================
-- MIGRATION 003: Create insw_integration_settings table
-- ============================================================================
-- Reason: New table for toggling INSW endpoint transmissions on/off.
-- Prisma db push cannot create this due to partitioned table conflicts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS insw_integration_settings (
  id            SERIAL PRIMARY KEY,
  endpoint_key  VARCHAR(50) NOT NULL UNIQUE,
  endpoint_name VARCHAR(100) NOT NULL,
  description   TEXT,
  is_enabled    BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  updated_by    VARCHAR(100)
);

-- Seed default data (idempotent via ON CONFLICT DO NOTHING)
INSERT INTO insw_integration_settings (endpoint_key, endpoint_name, description, is_enabled, updated_at)
VALUES
  ('PEMASUKAN',         'Pemasukan Barang',            'Transmisi data pemasukan barang ke INSW', true, NOW()),
  ('PENGELUARAN',       'Pengeluaran Barang',           'Transmisi data pengeluaran barang ke INSW', true, NOW()),
  ('MATERIAL_USAGE',    'Pemakaian Bahan',              'Transmisi data pemakaian bahan ke INSW', true, NOW()),
  ('PRODUCTION_OUTPUT', 'Hasil Produksi',               'Transmisi data hasil produksi ke INSW', true, NOW()),
  ('SCRAP_IN',          'Scrap Masuk',                  'Transmisi data scrap masuk ke INSW', true, NOW()),
  ('SCRAP_OUT',         'Scrap Keluar',                 'Transmisi data scrap keluar ke INSW', true, NOW()),
  ('CAPITAL_GOODS_OUT', 'Barang Modal Keluar',          'Transmisi data barang modal keluar ke INSW', true, NOW()),
  ('SALDO_AWAL',        'Saldo Awal',                   'Transmisi saldo awal ke INSW', true, NOW()),
  ('SALDO_AWAL_FINAL',  'Registrasi Final Saldo Awal',  'Lock dan finalisasi saldo awal ke INSW', true, NOW())
ON CONFLICT (endpoint_key) DO NOTHING;

-- ============================================================================
-- MIGRATION 004: Create insw_uom_mapping table
-- ============================================================================
-- Reason: DB-based UOM mapping for WMS -> INSW code conversion.
-- Prisma db push cannot create this due to partitioned table conflicts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS insw_uom_mapping (
  id          SERIAL PRIMARY KEY,
  wms_uom     VARCHAR(50) NOT NULL UNIQUE,
  insw_uom    VARCHAR(10) NOT NULL,
  description VARCHAR(255),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insw_uom_mapping_wms_uom ON insw_uom_mapping(wms_uom);
