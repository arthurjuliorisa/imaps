-- Migration: Scrap and Capital Goods Refactor
-- Date: 2025-01-01
-- Description:
--   1. Remove incoming_capital_goods and outgoing_scrap_capital_goods tables
--   2. Create new scrap_transactions tables
--   3. Fix CustomsDocumentType enum
--   4. Add uom column to stock_daily_snapshot if missing

-- ============================================================================
-- STEP 1: Handle CustomsDocumentType enum conversion
-- ============================================================================

-- Create the enum if it doesn't exist
DO $$ BEGIN
    CREATE TYPE "CustomsDocumentType" AS ENUM ('BC23', 'BC27', 'BC40', 'BC30', 'BC25', 'BC261', 'BC262');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Convert incoming_goods.customs_document_type to enum (if it's currently varchar)
DO $$ BEGIN
    -- First, alter the column to use the enum type
    ALTER TABLE incoming_goods
    ALTER COLUMN customs_document_type TYPE "CustomsDocumentType"
    USING customs_document_type::text::"CustomsDocumentType";
EXCEPTION
    WHEN OTHERS THEN
        -- If it fails, the column might already be an enum
        RAISE NOTICE 'incoming_goods.customs_document_type already an enum or conversion failed';
END $$;

-- Convert outgoing_goods.customs_document_type to enum (if it's currently varchar)
DO $$ BEGIN
    ALTER TABLE outgoing_goods
    ALTER COLUMN customs_document_type TYPE "CustomsDocumentType"
    USING customs_document_type::text::"CustomsDocumentType";
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'outgoing_goods.customs_document_type already an enum or conversion failed';
END $$;

-- ============================================================================
-- STEP 2: Add uom column to stock_daily_snapshot if missing
-- ============================================================================

-- Add uom column with a default value first (to handle existing rows)
DO $$ BEGIN
    ALTER TABLE stock_daily_snapshot
    ADD COLUMN IF NOT EXISTS uom VARCHAR(20) DEFAULT 'PCS';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'uom column already exists or could not be added';
END $$;

-- Update existing rows with uom from items table (if possible)
UPDATE stock_daily_snapshot sds
SET uom = i.uom
FROM items i
WHERE sds.item_code = i.item_code
  AND sds.company_code = i.company_code
  AND sds.uom = 'PCS'; -- Only update default values

-- Remove default after data is populated
ALTER TABLE stock_daily_snapshot
ALTER COLUMN uom DROP DEFAULT;

-- Make sure the column is NOT NULL
ALTER TABLE stock_daily_snapshot
ALTER COLUMN uom SET NOT NULL;

-- ============================================================================
-- STEP 3: Drop old capital goods tables
-- ============================================================================

-- Drop foreign key constraints first
ALTER TABLE IF EXISTS incoming_capital_good_items
DROP CONSTRAINT IF EXISTS incoming_capital_good_items_incoming_capital_good_company_fkey;

ALTER TABLE IF EXISTS outgoing_scrap_capital_good_items
DROP CONSTRAINT IF EXISTS outgoing_scrap_capital_good_items_outgoing_scrap_capital_goo_fkey;

-- Drop the detail tables
DROP TABLE IF EXISTS incoming_capital_good_items CASCADE;
DROP TABLE IF EXISTS outgoing_scrap_capital_good_items CASCADE;

-- Drop the header tables
DROP TABLE IF EXISTS incoming_capital_goods CASCADE;
DROP TABLE IF EXISTS outgoing_scrap_capital_goods CASCADE;

-- ============================================================================
-- STEP 4: Create new scrap_transactions tables
-- ============================================================================

-- Create scrap_transactions header table
CREATE TABLE IF NOT EXISTS scrap_transactions (
    id SERIAL PRIMARY KEY,
    company_code INTEGER NOT NULL,
    transaction_date DATE NOT NULL,
    transaction_type VARCHAR(10) NOT NULL, -- 'IN' or 'OUT'
    document_number VARCHAR(100) NOT NULL,
    source VARCHAR(200), -- For IN transactions
    recipient_name VARCHAR(200), -- For OUT transactions
    disposal_method VARCHAR(100), -- For OUT: "Sold as scrap", "Destroyed", "Donated"
    remarks VARCHAR(1000),
    timestamp TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),

    CONSTRAINT scrap_transactions_company_fkey
        FOREIGN KEY (company_code) REFERENCES companies(code),
    CONSTRAINT scrap_transactions_company_code_id_transaction_date_key
        UNIQUE (company_code, id, transaction_date)
);

-- Create indexes for scrap_transactions
CREATE INDEX IF NOT EXISTS scrap_transactions_company_code_idx ON scrap_transactions(company_code);
CREATE INDEX IF NOT EXISTS scrap_transactions_transaction_date_idx ON scrap_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS scrap_transactions_document_number_idx ON scrap_transactions(document_number);
CREATE INDEX IF NOT EXISTS scrap_transactions_transaction_type_idx ON scrap_transactions(transaction_type);

-- Create scrap_transaction_items detail table
CREATE TABLE IF NOT EXISTS scrap_transaction_items (
    id SERIAL PRIMARY KEY,
    scrap_transaction_id INTEGER NOT NULL,
    scrap_transaction_company INTEGER NOT NULL,
    scrap_transaction_date DATE NOT NULL,
    item_type VARCHAR(10) NOT NULL DEFAULT 'SCRAP',
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    qty DECIMAL(15, 3) NOT NULL,
    currency "Currency" NOT NULL,
    amount DECIMAL(18, 4) NOT NULL,
    scrap_reason VARCHAR(500),
    remarks VARCHAR(500),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),

    CONSTRAINT scrap_transaction_items_scrap_transaction_fkey
        FOREIGN KEY (scrap_transaction_company, scrap_transaction_id, scrap_transaction_date)
        REFERENCES scrap_transactions(company_code, id, transaction_date)
        ON DELETE CASCADE
);

-- Create indexes for scrap_transaction_items
CREATE INDEX IF NOT EXISTS scrap_transaction_items_scrap_transaction_id_idx
    ON scrap_transaction_items(scrap_transaction_id);
CREATE INDEX IF NOT EXISTS scrap_transaction_items_scrap_transaction_composite_idx
    ON scrap_transaction_items(scrap_transaction_id, scrap_transaction_company, scrap_transaction_date);
CREATE INDEX IF NOT EXISTS scrap_transaction_items_item_code_idx
    ON scrap_transaction_items(item_code);
CREATE INDEX IF NOT EXISTS scrap_transaction_items_item_type_idx
    ON scrap_transaction_items(item_type);

-- ============================================================================
-- STEP 5: Update companies table foreign key relation
-- ============================================================================

-- Remove old foreign key relations from companies (if they exist)
-- Note: These will be automatically dropped when the tables are dropped

-- The scrap_transactions relation to companies is already created via the FK constraint above
