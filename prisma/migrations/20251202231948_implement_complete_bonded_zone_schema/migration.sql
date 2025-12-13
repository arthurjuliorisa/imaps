-- ============================================================================
-- iMAPS Database Schema v2.0 Migration
-- Complete schema for KEK/Bonded Zone Compliance & Stock Management
-- ============================================================================
-- IMPORTANT: This migration preserves existing User, Menu, UserAccessMenu, and ActivityLog tables
-- All existing authentication and authorization data will be retained
-- ============================================================================

-- Step 1: Add indexes to existing tables for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username");
CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");
CREATE INDEX IF NOT EXISTS "Menu_parentId_idx" ON "Menu"("parentId");
CREATE INDEX IF NOT EXISTS "UserAccessMenu_userId_idx" ON "UserAccessMenu"("userId");
CREATE INDEX IF NOT EXISTS "UserAccessMenu_menuId_idx" ON "UserAccessMenu"("menuId");

-- Step 2: Alter existing tables to add VARCHAR constraints
-- ============================================================================
-- ActivityLog table updates
ALTER TABLE "ActivityLog" ALTER COLUMN "action" TYPE VARCHAR(100);
ALTER TABLE "ActivityLog" ALTER COLUMN "ipAddress" TYPE VARCHAR(45);
ALTER TABLE "ActivityLog" ALTER COLUMN "userAgent" TYPE TEXT;

-- Currency table updates
ALTER TABLE "Currency" ALTER COLUMN "code" TYPE VARCHAR(10);
ALTER TABLE "Currency" ALTER COLUMN "name" TYPE VARCHAR(50);
CREATE INDEX IF NOT EXISTS "Currency_code_idx" ON "Currency"("code");

-- Customer table updates
ALTER TABLE "Customer" ALTER COLUMN "code" TYPE VARCHAR(50);
ALTER TABLE "Customer" ALTER COLUMN "name" TYPE VARCHAR(200);
CREATE INDEX IF NOT EXISTS "Customer_code_idx" ON "Customer"("code");

-- Supplier table updates
ALTER TABLE "Supplier" ALTER COLUMN "code" TYPE VARCHAR(50);
ALTER TABLE "Supplier" ALTER COLUMN "name" TYPE VARCHAR(200);
CREATE INDEX IF NOT EXISTS "Supplier_code_idx" ON "Supplier"("code");

-- UOM table updates
ALTER TABLE "UOM" ALTER COLUMN "code" TYPE VARCHAR(20);
ALTER TABLE "UOM" ALTER COLUMN "name" TYPE VARCHAR(100);
CREATE INDEX IF NOT EXISTS "UOM_code_idx" ON "UOM"("code");

-- Step 3: Drop old conflicting types and create new ENUM types
-- ============================================================================

-- Drop old enum types first (will be replaced with new ItemTypeCode enum)
DROP TYPE IF EXISTS "ItemType" CASCADE;
DROP TYPE IF EXISTS "BeginningStockType" CASCADE;

-- ItemTypeCode enum for proper item classification
CREATE TYPE "ItemTypeCode" AS ENUM (
  'ROH',      -- Raw Materials (Bahan Baku)
  'HALB',     -- Work in Progress / Semi-Finished (Barang Setengah Jadi)
  'FERT',     -- Finished Goods (Hasil Produksi)
  'HIBE_M',   -- Capital Goods - Machinery (Barang Modal - Mesin)
  'HIBE_E',   -- Capital Goods - Engineering (Barang Modal - Teknik)
  'HIBE_T',   -- Capital Goods - Tools (Barang Modal - Alat)
  'HIBE',     -- Capital Goods - General (Barang Modal - Umum)
  'SCRAP',    -- Production Scrap/Waste (Barang Sisa)
  'DIEN'      -- Services (Jasa)
);

-- AdjustmentType enum for stock corrections
CREATE TYPE "AdjustmentType" AS ENUM ('GAIN', 'LOSS');

-- CalculationMethod enum for stock calculation approaches
CREATE TYPE "CalculationMethod" AS ENUM ('TRANSACTION', 'WIP_SNAPSHOT');

-- RecalcStatus enum for snapshot recalculation queue
CREATE TYPE "RecalcStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- JobType enum for batch processing
CREATE TYPE "JobType" AS ENUM ('HOURLY_BATCH', 'EOD_SNAPSHOT', 'RECALC_QUEUE', 'MANUAL_TRIGGER');

-- JobStatus enum for batch processing status
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- Step 4: Create new master data tables
-- ============================================================================

-- Company master table
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "companyName" VARCHAR(200) NOT NULL,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Company_companyCode_key" ON "Company"("companyCode");
CREATE INDEX "Company_companyCode_idx" ON "Company"("companyCode");

-- ItemType master table
CREATE TABLE "ItemType" (
    "id" TEXT NOT NULL,
    "itemTypeCode" "ItemTypeCode" NOT NULL,
    "itemTypeName" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ItemType_itemTypeCode_key" ON "ItemType"("itemTypeCode");
CREATE INDEX "ItemType_itemTypeCode_idx" ON "ItemType"("itemTypeCode");

-- Step 5: Create beginning balance table
-- ============================================================================

CREATE TABLE "BeginningBalance" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "itemTypeCode" "ItemTypeCode" NOT NULL,
    "itemCode" VARCHAR(50) NOT NULL,
    "itemName" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "balanceQty" DECIMAL(15,2) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BeginningBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BeginningBalance_companyCode_itemCode_effectiveDate_key"
    ON "BeginningBalance"("companyCode", "itemCode", "effectiveDate");
CREATE INDEX "BeginningBalance_companyCode_idx" ON "BeginningBalance"("companyCode");
CREATE INDEX "BeginningBalance_itemTypeCode_idx" ON "BeginningBalance"("itemTypeCode");
CREATE INDEX "BeginningBalance_itemCode_idx" ON "BeginningBalance"("itemCode");
CREATE INDEX "BeginningBalance_effectiveDate_idx" ON "BeginningBalance"("effectiveDate");

-- Step 6: Create incoming goods tables (Header-Details pattern)
-- ============================================================================

CREATE TABLE "IncomingHeader" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "trxDate" DATE NOT NULL,
    "wmsId" VARCHAR(100) NOT NULL,
    "customsDocumentType" VARCHAR(10) NOT NULL,
    "ppkekNumber" VARCHAR(50) NOT NULL,
    "customsRegistrationDate" DATE NOT NULL,
    "incomingEvidenceNumber" VARCHAR(100) NOT NULL,
    "incomingDate" DATE NOT NULL,
    "shipperCode" VARCHAR(50) NOT NULL,
    "shipperName" VARCHAR(200) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomingHeader_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncomingHeader_wmsId_key" ON "IncomingHeader"("wmsId");
CREATE INDEX "IncomingHeader_companyCode_trxDate_idx" ON "IncomingHeader"("companyCode", "trxDate");
CREATE INDEX "IncomingHeader_wmsId_idx" ON "IncomingHeader"("wmsId");
CREATE INDEX "IncomingHeader_incomingDate_idx" ON "IncomingHeader"("incomingDate");
CREATE INDEX "IncomingHeader_ppkekNumber_idx" ON "IncomingHeader"("ppkekNumber");

CREATE TABLE "IncomingDetail" (
    "id" BIGSERIAL NOT NULL,
    "headerId" BIGINT NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "trxDate" DATE NOT NULL,
    "itemTypeCode" "ItemTypeCode" NOT NULL,
    "itemCode" VARCHAR(50) NOT NULL,
    "itemName" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomingDetail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncomingDetail_companyCode_trxDate_itemTypeCode_idx"
    ON "IncomingDetail"("companyCode", "trxDate", "itemTypeCode");
CREATE INDEX "IncomingDetail_itemCode_idx" ON "IncomingDetail"("itemCode");
CREATE INDEX "IncomingDetail_headerId_idx" ON "IncomingDetail"("headerId");

ALTER TABLE "IncomingDetail" ADD CONSTRAINT "IncomingDetail_headerId_fkey"
    FOREIGN KEY ("headerId") REFERENCES "IncomingHeader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 7: Create outgoing goods tables (Header-Details pattern)
-- ============================================================================

CREATE TABLE "OutgoingHeader" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "trxDate" DATE NOT NULL,
    "wmsId" VARCHAR(100) NOT NULL,
    "customsDocumentType" VARCHAR(10) NOT NULL,
    "ppkekNumber" VARCHAR(50) NOT NULL,
    "customsRegistrationDate" DATE NOT NULL,
    "outgoingEvidenceNumber" VARCHAR(100) NOT NULL,
    "outgoingDate" DATE NOT NULL,
    "recipientCode" VARCHAR(50) NOT NULL,
    "recipientName" VARCHAR(200) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutgoingHeader_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutgoingHeader_wmsId_key" ON "OutgoingHeader"("wmsId");
CREATE INDEX "OutgoingHeader_companyCode_trxDate_idx" ON "OutgoingHeader"("companyCode", "trxDate");
CREATE INDEX "OutgoingHeader_wmsId_idx" ON "OutgoingHeader"("wmsId");
CREATE INDEX "OutgoingHeader_outgoingDate_idx" ON "OutgoingHeader"("outgoingDate");
CREATE INDEX "OutgoingHeader_ppkekNumber_idx" ON "OutgoingHeader"("ppkekNumber");

CREATE TABLE "OutgoingDetail" (
    "id" BIGSERIAL NOT NULL,
    "headerId" BIGINT NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "trxDate" DATE NOT NULL,
    "itemTypeCode" "ItemTypeCode" NOT NULL,
    "itemCode" VARCHAR(50) NOT NULL,
    "itemName" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutgoingDetail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutgoingDetail_companyCode_trxDate_itemTypeCode_idx"
    ON "OutgoingDetail"("companyCode", "trxDate", "itemTypeCode");
CREATE INDEX "OutgoingDetail_itemCode_idx" ON "OutgoingDetail"("itemCode");
CREATE INDEX "OutgoingDetail_headerId_idx" ON "OutgoingDetail"("headerId");

ALTER TABLE "OutgoingDetail" ADD CONSTRAINT "OutgoingDetail_headerId_fkey"
    FOREIGN KEY ("headerId") REFERENCES "OutgoingHeader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 8: Create material usage tables (Header-Details pattern)
-- ============================================================================

CREATE TABLE "MaterialUsageHeader" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "trxDate" DATE NOT NULL,
    "wmsId" VARCHAR(100) NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialUsageHeader_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialUsageHeader_wmsId_key" ON "MaterialUsageHeader"("wmsId");
CREATE INDEX "MaterialUsageHeader_companyCode_trxDate_idx" ON "MaterialUsageHeader"("companyCode", "trxDate");
CREATE INDEX "MaterialUsageHeader_wmsId_idx" ON "MaterialUsageHeader"("wmsId");

CREATE TABLE "MaterialUsageDetail" (
    "id" BIGSERIAL NOT NULL,
    "headerId" BIGINT NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "trxDate" DATE NOT NULL,
    "itemTypeCode" "ItemTypeCode" NOT NULL,
    "itemCode" VARCHAR(50) NOT NULL,
    "itemName" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,2) NOT NULL,
    "ppkekNumber" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialUsageDetail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialUsageDetail_companyCode_trxDate_itemTypeCode_idx"
    ON "MaterialUsageDetail"("companyCode", "trxDate", "itemTypeCode");
CREATE INDEX "MaterialUsageDetail_itemCode_idx" ON "MaterialUsageDetail"("itemCode");
CREATE INDEX "MaterialUsageDetail_ppkekNumber_idx" ON "MaterialUsageDetail"("ppkekNumber");
CREATE INDEX "MaterialUsageDetail_headerId_idx" ON "MaterialUsageDetail"("headerId");

ALTER TABLE "MaterialUsageDetail" ADD CONSTRAINT "MaterialUsageDetail_headerId_fkey"
    FOREIGN KEY ("headerId") REFERENCES "MaterialUsageHeader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 9: Create finished goods production tables (Header-Details pattern)
-- ============================================================================

CREATE TABLE "FinishedGoodsProductionHeader" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "trxDate" DATE NOT NULL,
    "wmsId" VARCHAR(100) NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinishedGoodsProductionHeader_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinishedGoodsProductionHeader_wmsId_key" ON "FinishedGoodsProductionHeader"("wmsId");
CREATE INDEX "FinishedGoodsProductionHeader_companyCode_trxDate_idx"
    ON "FinishedGoodsProductionHeader"("companyCode", "trxDate");
CREATE INDEX "FinishedGoodsProductionHeader_wmsId_idx" ON "FinishedGoodsProductionHeader"("wmsId");

CREATE TABLE "FinishedGoodsProductionDetail" (
    "id" BIGSERIAL NOT NULL,
    "headerId" BIGINT NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "trxDate" DATE NOT NULL,
    "productionWmsId" VARCHAR(100) NOT NULL,
    "itemCode" VARCHAR(50) NOT NULL,
    "itemName" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,2) NOT NULL,
    "workOrderNumbers" VARCHAR(50)[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinishedGoodsProductionDetail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinishedGoodsProductionDetail_productionWmsId_itemCode_key"
    ON "FinishedGoodsProductionDetail"("productionWmsId", "itemCode");
CREATE INDEX "FinishedGoodsProductionDetail_companyCode_trxDate_idx"
    ON "FinishedGoodsProductionDetail"("companyCode", "trxDate");
CREATE INDEX "FinishedGoodsProductionDetail_itemCode_idx" ON "FinishedGoodsProductionDetail"("itemCode");
CREATE INDEX "FinishedGoodsProductionDetail_productionWmsId_idx"
    ON "FinishedGoodsProductionDetail"("productionWmsId");
CREATE INDEX "FinishedGoodsProductionDetail_headerId_idx" ON "FinishedGoodsProductionDetail"("headerId");

ALTER TABLE "FinishedGoodsProductionDetail" ADD CONSTRAINT "FinishedGoodsProductionDetail_headerId_fkey"
    FOREIGN KEY ("headerId") REFERENCES "FinishedGoodsProductionHeader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 10: Create WIP balance table
-- ============================================================================

CREATE TABLE "WipBalance" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "trxDate" DATE NOT NULL,
    "itemTypeCode" "ItemTypeCode" NOT NULL,
    "itemCode" VARCHAR(50) NOT NULL,
    "itemName" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,2) NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WipBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WipBalance_companyCode_trxDate_itemCode_key"
    ON "WipBalance"("companyCode", "trxDate", "itemCode");
CREATE INDEX "WipBalance_companyCode_trxDate_idx" ON "WipBalance"("companyCode", "trxDate");
CREATE INDEX "WipBalance_itemCode_idx" ON "WipBalance"("itemCode");

-- Step 11: Create adjustment table
-- ============================================================================

CREATE TABLE "Adjustment" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "trxDate" DATE NOT NULL,
    "itemTypeCode" "ItemTypeCode" NOT NULL,
    "itemCode" VARCHAR(50) NOT NULL,
    "itemName" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "adjustmentType" "AdjustmentType" NOT NULL,
    "adjustedQty" DECIMAL(15,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedBy" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Adjustment_companyCode_trxDate_idx" ON "Adjustment"("companyCode", "trxDate");
CREATE INDEX "Adjustment_itemCode_idx" ON "Adjustment"("itemCode");
CREATE INDEX "Adjustment_adjustmentType_idx" ON "Adjustment"("adjustmentType");

-- Step 12: Create stock daily snapshot table (CORE)
-- ============================================================================

CREATE TABLE "StockDailySnapshot" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "itemTypeCode" "ItemTypeCode" NOT NULL,
    "itemCode" VARCHAR(50) NOT NULL,
    "itemName" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "openingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "incomingQty" DECIMAL(15,2),
    "outgoingQty" DECIMAL(15,2),
    "materialUsageQty" DECIMAL(15,2),
    "productionQty" DECIMAL(15,2),
    "adjustmentQty" DECIMAL(15,2),
    "wipBalanceQty" DECIMAL(15,2),
    "closingBalance" DECIMAL(15,2) NOT NULL,
    "calculationMethod" "CalculationMethod" NOT NULL DEFAULT 'TRANSACTION',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockDailySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockDailySnapshot_companyCode_itemCode_snapshotDate_key"
    ON "StockDailySnapshot"("companyCode", "itemCode", "snapshotDate");
CREATE INDEX "StockDailySnapshot_companyCode_snapshotDate_idx"
    ON "StockDailySnapshot"("companyCode", "snapshotDate");
CREATE INDEX "StockDailySnapshot_itemTypeCode_idx" ON "StockDailySnapshot"("itemTypeCode");
CREATE INDEX "StockDailySnapshot_itemCode_idx" ON "StockDailySnapshot"("itemCode");
CREATE INDEX "StockDailySnapshot_snapshotDate_idx" ON "StockDailySnapshot"("snapshotDate");
CREATE INDEX "StockDailySnapshot_calculationMethod_idx" ON "StockDailySnapshot"("calculationMethod");

-- Step 13: Create traceability tables
-- ============================================================================

CREATE TABLE "WorkOrderMaterialConsumption" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "workOrderNumber" VARCHAR(50) NOT NULL,
    "materialUsageDetailId" BIGINT NOT NULL,
    "itemCode" VARCHAR(50) NOT NULL,
    "qty" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderMaterialConsumption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkOrderMaterialConsumption_companyCode_workOrderNumber_idx"
    ON "WorkOrderMaterialConsumption"("companyCode", "workOrderNumber");
CREATE INDEX "WorkOrderMaterialConsumption_materialUsageDetailId_idx"
    ON "WorkOrderMaterialConsumption"("materialUsageDetailId");
CREATE INDEX "WorkOrderMaterialConsumption_itemCode_idx" ON "WorkOrderMaterialConsumption"("itemCode");

ALTER TABLE "WorkOrderMaterialConsumption" ADD CONSTRAINT "WorkOrderMaterialConsumption_materialUsageDetailId_fkey"
    FOREIGN KEY ("materialUsageDetailId") REFERENCES "MaterialUsageDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkOrderFgProduction" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "workOrderNumber" VARCHAR(50) NOT NULL,
    "finishedGoodsProductionDetailId" BIGINT NOT NULL,
    "itemCode" VARCHAR(50) NOT NULL,
    "qty" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderFgProduction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkOrderFgProduction_companyCode_workOrderNumber_idx"
    ON "WorkOrderFgProduction"("companyCode", "workOrderNumber");
CREATE INDEX "WorkOrderFgProduction_finishedGoodsProductionDetailId_idx"
    ON "WorkOrderFgProduction"("finishedGoodsProductionDetailId");
CREATE INDEX "WorkOrderFgProduction_itemCode_idx" ON "WorkOrderFgProduction"("itemCode");

ALTER TABLE "WorkOrderFgProduction" ADD CONSTRAINT "WorkOrderFgProduction_finishedGoodsProductionDetailId_fkey"
    FOREIGN KEY ("finishedGoodsProductionDetailId") REFERENCES "FinishedGoodsProductionDetail"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OutgoingFgProductionTraceability" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "outgoingDetailId" BIGINT NOT NULL,
    "finishedGoodsProductionDetailId" BIGINT NOT NULL,
    "productionWmsId" VARCHAR(100) NOT NULL,
    "itemCode" VARCHAR(50) NOT NULL,
    "qty" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutgoingFgProductionTraceability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutgoingFgProductionTraceability_companyCode_idx"
    ON "OutgoingFgProductionTraceability"("companyCode");
CREATE INDEX "OutgoingFgProductionTraceability_outgoingDetailId_idx"
    ON "OutgoingFgProductionTraceability"("outgoingDetailId");
CREATE INDEX "OutgoingFgProductionTraceability_finishedGoodsProductionDetailId_idx"
    ON "OutgoingFgProductionTraceability"("finishedGoodsProductionDetailId");
CREATE INDEX "OutgoingFgProductionTraceability_productionWmsId_idx"
    ON "OutgoingFgProductionTraceability"("productionWmsId");
CREATE INDEX "OutgoingFgProductionTraceability_itemCode_idx"
    ON "OutgoingFgProductionTraceability"("itemCode");

ALTER TABLE "OutgoingFgProductionTraceability" ADD CONSTRAINT "OutgoingFgProductionTraceability_outgoingDetailId_fkey"
    FOREIGN KEY ("outgoingDetailId") REFERENCES "OutgoingDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutgoingFgProductionTraceability"
    ADD CONSTRAINT "OutgoingFgProductionTraceability_finishedGoodsProductionDetailId_fkey"
    FOREIGN KEY ("finishedGoodsProductionDetailId") REFERENCES "FinishedGoodsProductionDetail"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 14: Create snapshot recalculation queue
-- ============================================================================

CREATE TABLE "SnapshotRecalcQueue" (
    "id" BIGSERIAL NOT NULL,
    "companyCode" VARCHAR(50) NOT NULL,
    "recalcDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "RecalcStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnapshotRecalcQueue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SnapshotRecalcQueue_companyCode_recalcDate_idx"
    ON "SnapshotRecalcQueue"("companyCode", "recalcDate");
CREATE INDEX "SnapshotRecalcQueue_status_priority_idx" ON "SnapshotRecalcQueue"("status", "priority");
CREATE INDEX "SnapshotRecalcQueue_createdAt_idx" ON "SnapshotRecalcQueue"("createdAt");

-- Step 15: Create batch processing log
-- ============================================================================

CREATE TABLE "BatchProcessingLog" (
    "id" BIGSERIAL NOT NULL,
    "jobType" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "triggeredBy" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchProcessingLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BatchProcessingLog_jobType_idx" ON "BatchProcessingLog"("jobType");
CREATE INDEX "BatchProcessingLog_status_idx" ON "BatchProcessingLog"("status");
CREATE INDEX "BatchProcessingLog_startedAt_idx" ON "BatchProcessingLog"("startedAt");
CREATE INDEX "BatchProcessingLog_completedAt_idx" ON "BatchProcessingLog"("completedAt");

-- Step 16: Drop old tables (PRESERVE DATA FIRST - see migration guide)
-- ============================================================================
-- IMPORTANT: These tables contain data that needs to be migrated first
-- See the DATA_MIGRATION_GUIDE.md for proper data migration steps
-- ============================================================================

-- Old enum types already dropped at the beginning of migration

-- Drop old tables (after data has been migrated to new tables)
-- Uncomment these lines ONLY after completing data migration:

-- DROP TABLE IF EXISTS "BeginningStock" CASCADE;
-- DROP TABLE IF EXISTS "ScrapItem" CASCADE;
-- DROP TABLE IF EXISTS "ScrapMutation" CASCADE;
-- DROP TABLE IF EXISTS "ScrapMaster" CASCADE;
-- DROP TABLE IF EXISTS "WIPRecord" CASCADE;
-- DROP TABLE IF EXISTS "CapitalGoodsMutation" CASCADE;
-- DROP TABLE IF EXISTS "ProductionMutation" CASCADE;
-- DROP TABLE IF EXISTS "RawMaterialMutation" CASCADE;
-- DROP TABLE IF EXISTS "OutgoingDocument" CASCADE;
-- DROP TABLE IF EXISTS "IncomingDocument" CASCADE;
-- DROP TABLE IF EXISTS "Item" CASCADE;

-- Step 17: Insert default master data
-- ============================================================================

-- Insert default ItemType master data
INSERT INTO "ItemType" ("id", "itemTypeCode", "itemTypeName", "description", "createdAt", "updatedAt") VALUES
    (gen_random_uuid()::text, 'ROH', 'Raw Materials', 'Bahan Baku - Materials that will be used in production', NOW(), NOW()),
    (gen_random_uuid()::text, 'HALB', 'Work in Progress', 'Barang Setengah Jadi - Semi-finished goods in production', NOW(), NOW()),
    (gen_random_uuid()::text, 'FERT', 'Finished Goods', 'Hasil Produksi - Final products ready for sale', NOW(), NOW()),
    (gen_random_uuid()::text, 'HIBE_M', 'Capital Goods - Machinery', 'Barang Modal Mesin - Production machinery and equipment', NOW(), NOW()),
    (gen_random_uuid()::text, 'HIBE_E', 'Capital Goods - Engineering', 'Barang Modal Teknik - Engineering equipment', NOW(), NOW()),
    (gen_random_uuid()::text, 'HIBE_T', 'Capital Goods - Tools', 'Barang Modal Alat - Production tools', NOW(), NOW()),
    (gen_random_uuid()::text, 'HIBE', 'Capital Goods - General', 'Barang Modal Umum - General capital goods', NOW(), NOW()),
    (gen_random_uuid()::text, 'SCRAP', 'Production Scrap', 'Barang Sisa - Production waste and scrap', NOW(), NOW()),
    (gen_random_uuid()::text, 'DIEN', 'Services', 'Jasa - Service items', NOW(), NOW())
ON CONFLICT ("itemTypeCode") DO NOTHING;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
-- Next steps:
-- 1. Review the DATA_MIGRATION_GUIDE.md for data migration instructions
-- 2. Run data migration scripts to populate new tables from old tables
-- 3. Verify data integrity in new tables
-- 4. Drop old tables (uncomment DROP TABLE statements above)
-- 5. Generate new Prisma client: npx prisma generate
-- ============================================================================
