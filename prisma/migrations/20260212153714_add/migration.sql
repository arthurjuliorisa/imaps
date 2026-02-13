-- CreateEnum
CREATE TYPE "wms_stock_opname_status" AS ENUM ('ACTIVE', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "wms_stock_opnames" (
    "id" BIGSERIAL NOT NULL,
    "wms_id" VARCHAR(100) NOT NULL,
    "company_code" INTEGER NOT NULL,
    "owner" INTEGER,
    "document_date" DATE NOT NULL,
    "status" "wms_stock_opname_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),

    CONSTRAINT "wms_stock_opnames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms_stock_opname_items" (
    "id" BIGSERIAL NOT NULL,
    "wms_stock_opname_id" BIGINT NOT NULL,
    "company_code" INTEGER NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "beginning_qty" DECIMAL(15,3) NOT NULL,
    "incoming_qty_on_date" DECIMAL(15,3) NOT NULL,
    "outgoing_qty_on_date" DECIMAL(15,3) NOT NULL,
    "system_qty" DECIMAL(15,3) NOT NULL,
    "physical_qty" DECIMAL(15,3) NOT NULL,
    "variance_qty" DECIMAL(15,3) NOT NULL,
    "adjustment_qty_signed" DECIMAL(15,3) NOT NULL,
    "adjustment_type" VARCHAR(10),
    "uom" VARCHAR(20) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wms_stock_opname_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wms_stock_opnames_status_idx" ON "wms_stock_opnames"("status");

-- CreateIndex
CREATE INDEX "wms_stock_opnames_company_code_document_date_idx" ON "wms_stock_opnames"("company_code", "document_date");

-- CreateIndex
CREATE INDEX "wms_stock_opnames_created_at_idx" ON "wms_stock_opnames"("created_at");

-- CreateIndex
CREATE INDEX "wms_stock_opnames_wms_id_idx" ON "wms_stock_opnames"("wms_id");

-- CreateIndex
CREATE UNIQUE INDEX "wms_stock_opnames_company_code_wms_id_key" ON "wms_stock_opnames"("company_code", "wms_id");

-- CreateIndex
CREATE INDEX "wms_stock_opname_items_wms_stock_opname_id_idx" ON "wms_stock_opname_items"("wms_stock_opname_id");

-- CreateIndex
CREATE INDEX "wms_stock_opname_items_company_code_item_code_idx" ON "wms_stock_opname_items"("company_code", "item_code");

-- CreateIndex
CREATE INDEX "wms_stock_opname_items_item_type_idx" ON "wms_stock_opname_items"("item_type");

-- CreateIndex
CREATE INDEX "wms_stock_opname_items_company_code_idx" ON "wms_stock_opname_items"("company_code");

-- AddForeignKey
ALTER TABLE "wms_stock_opnames" ADD CONSTRAINT "wms_stock_opnames_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_stock_opname_items" ADD CONSTRAINT "wms_stock_opname_items_wms_stock_opname_id_fkey" FOREIGN KEY ("wms_stock_opname_id") REFERENCES "wms_stock_opnames"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_stock_opname_items" ADD CONSTRAINT "wms_stock_opname_items_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE CASCADE ON UPDATE CASCADE;
