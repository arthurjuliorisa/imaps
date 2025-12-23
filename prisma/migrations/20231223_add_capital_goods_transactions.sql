-- Migration: Add Capital Goods Transactions Tables
-- Date: 2023-12-23
-- Description: Add tables for incoming capital goods and outgoing scrap capital goods

-- ============================================================================
-- INCOMING CAPITAL GOODS - Header Table
-- ============================================================================
-- This table stores incoming capital goods purchase/acquisition transactions
-- Supports batch transactions grouped by date + document number
-- ============================================================================

CREATE TABLE IF NOT EXISTS incoming_capital_goods (
    id SERIAL PRIMARY KEY,
    company_code INTEGER NOT NULL,
    transaction_date DATE NOT NULL,
    document_number VARCHAR(100) NOT NULL,
    remarks VARCHAR(1000),
    timestamp TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),

    CONSTRAINT incoming_capital_goods_company_fkey
        FOREIGN KEY (company_code)
        REFERENCES companies(code)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT incoming_capital_goods_company_id_date_key
        UNIQUE (company_code, id, transaction_date)
);

-- Indexes for incoming_capital_goods
CREATE INDEX IF NOT EXISTS incoming_capital_goods_company_code_idx
    ON incoming_capital_goods(company_code);

CREATE INDEX IF NOT EXISTS incoming_capital_goods_transaction_date_idx
    ON incoming_capital_goods(transaction_date);

CREATE INDEX IF NOT EXISTS incoming_capital_goods_document_number_idx
    ON incoming_capital_goods(document_number);

-- ============================================================================
-- INCOMING CAPITAL GOOD ITEMS - Line Items Table
-- ============================================================================
-- Stores individual line items for incoming capital goods transactions
-- Each item represents a capital good item being purchased/acquired
-- ============================================================================

CREATE TABLE IF NOT EXISTS incoming_capital_good_items (
    id SERIAL PRIMARY KEY,
    incoming_capital_good_id INTEGER NOT NULL,
    incoming_capital_good_company INTEGER NOT NULL,
    incoming_capital_good_date DATE NOT NULL,
    item_type VARCHAR(10) NOT NULL, -- HIBE_M, HIBE_E, HIBE_T
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    qty DECIMAL(15, 3) NOT NULL,
    currency VARCHAR(10) NOT NULL, -- Using VARCHAR instead of ENUM for compatibility
    amount DECIMAL(18, 4) NOT NULL,
    remarks VARCHAR(500),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),

    CONSTRAINT incoming_capital_good_items_parent_fkey
        FOREIGN KEY (incoming_capital_good_company, incoming_capital_good_id, incoming_capital_good_date)
        REFERENCES incoming_capital_goods(company_code, id, transaction_date)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indexes for incoming_capital_good_items
CREATE INDEX IF NOT EXISTS incoming_capital_good_items_good_id_idx
    ON incoming_capital_good_items(incoming_capital_good_id);

CREATE INDEX IF NOT EXISTS incoming_capital_good_items_composite_idx
    ON incoming_capital_good_items(
        incoming_capital_good_id,
        incoming_capital_good_company,
        incoming_capital_good_date
    );

CREATE INDEX IF NOT EXISTS incoming_capital_good_items_item_code_idx
    ON incoming_capital_good_items(item_code);

CREATE INDEX IF NOT EXISTS incoming_capital_good_items_item_type_idx
    ON incoming_capital_good_items(item_type);

-- ============================================================================
-- OUTGOING SCRAP CAPITAL GOODS - Header Table
-- ============================================================================
-- This table stores capital goods scrap/disposal transactions
-- Supports batch transactions for scrapping multiple capital goods items
-- ============================================================================

CREATE TABLE IF NOT EXISTS outgoing_scrap_capital_goods (
    id SERIAL PRIMARY KEY,
    company_code INTEGER NOT NULL,
    transaction_date DATE NOT NULL,
    document_number VARCHAR(100) NOT NULL,
    disposal_method VARCHAR(100), -- e.g., "Sold as scrap", "Destroyed", "Donated"
    remarks VARCHAR(1000),
    timestamp TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),

    CONSTRAINT outgoing_scrap_capital_goods_company_fkey
        FOREIGN KEY (company_code)
        REFERENCES companies(code)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT outgoing_scrap_capital_goods_company_id_date_key
        UNIQUE (company_code, id, transaction_date)
);

-- Indexes for outgoing_scrap_capital_goods
CREATE INDEX IF NOT EXISTS outgoing_scrap_capital_goods_company_code_idx
    ON outgoing_scrap_capital_goods(company_code);

CREATE INDEX IF NOT EXISTS outgoing_scrap_capital_goods_transaction_date_idx
    ON outgoing_scrap_capital_goods(transaction_date);

CREATE INDEX IF NOT EXISTS outgoing_scrap_capital_goods_document_number_idx
    ON outgoing_scrap_capital_goods(document_number);

-- ============================================================================
-- OUTGOING SCRAP CAPITAL GOOD ITEMS - Line Items Table
-- ============================================================================
-- Stores individual line items for capital goods scrap transactions
-- Each item represents a capital good being scrapped/disposed
-- ============================================================================

CREATE TABLE IF NOT EXISTS outgoing_scrap_capital_good_items (
    id SERIAL PRIMARY KEY,
    outgoing_scrap_capital_good_id INTEGER NOT NULL,
    outgoing_scrap_capital_good_company INTEGER NOT NULL,
    outgoing_scrap_capital_good_date DATE NOT NULL,
    item_type VARCHAR(10) NOT NULL, -- HIBE_M, HIBE_E, HIBE_T
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    qty DECIMAL(15, 3) NOT NULL,
    currency VARCHAR(10) NOT NULL, -- Using VARCHAR instead of ENUM for compatibility
    amount DECIMAL(18, 4) NOT NULL, -- Original value or scrap value
    scrap_reason VARCHAR(500),
    remarks VARCHAR(500),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ(6),

    CONSTRAINT outgoing_scrap_capital_good_items_parent_fkey
        FOREIGN KEY (outgoing_scrap_capital_good_company, outgoing_scrap_capital_good_id, outgoing_scrap_capital_good_date)
        REFERENCES outgoing_scrap_capital_goods(company_code, id, transaction_date)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indexes for outgoing_scrap_capital_good_items
CREATE INDEX IF NOT EXISTS oscg_items_good_id_idx
    ON outgoing_scrap_capital_good_items(outgoing_scrap_capital_good_id);

CREATE INDEX IF NOT EXISTS oscg_items_composite_idx
    ON outgoing_scrap_capital_good_items(
        outgoing_scrap_capital_good_id,
        outgoing_scrap_capital_good_company,
        outgoing_scrap_capital_good_date
    );

CREATE INDEX IF NOT EXISTS oscg_items_item_code_idx
    ON outgoing_scrap_capital_good_items(item_code);

CREATE INDEX IF NOT EXISTS oscg_items_item_type_idx
    ON outgoing_scrap_capital_good_items(item_type);

-- ============================================================================
-- TRIGGER: Auto-update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to new tables
CREATE TRIGGER update_incoming_capital_goods_updated_at
    BEFORE UPDATE ON incoming_capital_goods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_incoming_capital_good_items_updated_at
    BEFORE UPDATE ON incoming_capital_good_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_outgoing_scrap_capital_goods_updated_at
    BEFORE UPDATE ON outgoing_scrap_capital_goods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_outgoing_scrap_capital_good_items_updated_at
    BEFORE UPDATE ON outgoing_scrap_capital_good_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE incoming_capital_goods IS
    'Header table for incoming capital goods purchase/acquisition transactions. Groups line items by date + document number.';

COMMENT ON TABLE incoming_capital_good_items IS
    'Line items for incoming capital goods. Each row represents a capital good item (HIBE_M/HIBE_E/HIBE_T) being purchased/acquired.';

COMMENT ON TABLE outgoing_scrap_capital_goods IS
    'Header table for capital goods scrap/disposal transactions. Groups scrap items by date + document number.';

COMMENT ON TABLE outgoing_scrap_capital_good_items IS
    'Line items for scrap capital goods. Each row represents a capital good item being scrapped/disposed.';

COMMENT ON COLUMN outgoing_scrap_capital_goods.disposal_method IS
    'Method of disposal (e.g., Sold as scrap, Destroyed, Donated, etc.)';

COMMENT ON COLUMN outgoing_scrap_capital_good_items.amount IS
    'Can represent original value or scrap recovery value depending on business requirements';

COMMENT ON COLUMN outgoing_scrap_capital_good_items.scrap_reason IS
    'Reason for scrapping (e.g., Damaged, Obsolete, End of life, etc.)';
