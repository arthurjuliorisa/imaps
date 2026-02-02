-- ============================================================================
-- Stock Opname Migration
-- Created: 2026-01-17
-- Description: Add tables for Stock Opname (Physical Inventory Count) feature
-- ============================================================================

-- Create enum for stock opname status
CREATE TYPE "stock_opname_status" AS ENUM ('OPEN', 'PROCESS', 'RELEASED');

-- Create stock_opnames table (header)
CREATE TABLE "stock_opnames" (
    "id" SERIAL PRIMARY KEY,
    "sto_number" VARCHAR(50) NOT NULL UNIQUE,
    "company_code" INTEGER NOT NULL,
    "sto_datetime" TIMESTAMPTZ(6) NOT NULL,
    "pic_name" VARCHAR(200),
    "status" "stock_opname_status" NOT NULL DEFAULT 'OPEN',
    "created_by" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    -- Foreign key constraint
    CONSTRAINT "fk_stock_opnames_company"
        FOREIGN KEY ("company_code")
        REFERENCES "companies"("code")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- Create indexes for stock_opnames (optimized for common queries)
CREATE INDEX "idx_stock_opnames_company_datetime" ON "stock_opnames"("company_code", "sto_datetime");
CREATE INDEX "idx_stock_opnames_sto_number" ON "stock_opnames"("sto_number");
CREATE INDEX "idx_stock_opnames_status" ON "stock_opnames"("status");
CREATE INDEX "idx_stock_opnames_created_at" ON "stock_opnames"("created_at");
CREATE INDEX "idx_stock_opnames_company_status_datetime" ON "stock_opnames"("company_code", "status", "sto_datetime");

-- Create stock_opname_items table (detail items)
CREATE TABLE "stock_opname_items" (
    "id" BIGSERIAL PRIMARY KEY,
    "stock_opname_id" INTEGER NOT NULL,
    "company_code" INTEGER NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "sto_qty" DECIMAL(15, 3) NOT NULL,
    "end_stock" DECIMAL(15, 3) NOT NULL,
    "variant" DECIMAL(15, 3) NOT NULL,
    "report_area" VARCHAR(100),
    "remark" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    -- Foreign key constraint
    CONSTRAINT "fk_stock_opname_items_stock_opname"
        FOREIGN KEY ("stock_opname_id")
        REFERENCES "stock_opnames"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    -- Unique constraint to prevent duplicate items in same STO
    CONSTRAINT "uk_stock_opname_items_sto_item"
        UNIQUE ("stock_opname_id", "item_code")
);

-- Create indexes for stock_opname_items (optimized for common queries)
CREATE INDEX "idx_stock_opname_items_stock_opname_id" ON "stock_opname_items"("stock_opname_id");
CREATE INDEX "idx_stock_opname_items_item_code" ON "stock_opname_items"("item_code");
CREATE INDEX "idx_stock_opname_items_item_type" ON "stock_opname_items"("item_type");
CREATE INDEX "idx_stock_opname_items_company_code" ON "stock_opname_items"("company_code");
CREATE INDEX "idx_stock_opname_items_company_item" ON "stock_opname_items"("company_code", "item_code");
CREATE INDEX "idx_stock_opname_items_variant" ON "stock_opname_items"("variant");

-- Add comments for documentation
COMMENT ON TABLE "stock_opnames" IS 'Stock Opname header table for physical inventory count';
COMMENT ON TABLE "stock_opname_items" IS 'Stock Opname detail items with variance tracking';
COMMENT ON COLUMN "stock_opnames"."sto_number" IS 'Stock Opname number in format: STO-YYYYMMDD-XXX';
COMMENT ON COLUMN "stock_opnames"."sto_datetime" IS 'Date and time when physical stock count was performed';
COMMENT ON COLUMN "stock_opnames"."pic_name" IS 'Person in charge of the stock opname (optional)';
COMMENT ON COLUMN "stock_opnames"."status" IS 'OPEN=Draft/Editable, PROCESS=Under Review, RELEASED=Finalized';
COMMENT ON COLUMN "stock_opname_items"."sto_qty" IS 'Physical count quantity (actual stock counted)';
COMMENT ON COLUMN "stock_opname_items"."end_stock" IS 'System calculated stock at STO datetime (from LPJ mutasi)';
COMMENT ON COLUMN "stock_opname_items"."variant" IS 'Variance: sto_qty - end_stock (positive=surplus, negative=shortage)';
COMMENT ON COLUMN "stock_opname_items"."report_area" IS 'Optional warehouse area/location';

-- Create trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_stock_opnames_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_stock_opnames_updated_at
    BEFORE UPDATE ON "stock_opnames"
    FOR EACH ROW
    EXECUTE FUNCTION update_stock_opnames_updated_at();

CREATE TRIGGER trigger_stock_opname_items_updated_at
    BEFORE UPDATE ON "stock_opname_items"
    FOR EACH ROW
    EXECUTE FUNCTION update_stock_opnames_updated_at();

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON stock_opnames TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON stock_opname_items TO your_app_user;
-- GRANT USAGE ON SEQUENCE stock_opnames_id_seq TO your_app_user;
-- GRANT USAGE ON SEQUENCE stock_opname_items_id_seq TO your_app_user;
