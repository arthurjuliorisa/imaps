-- CreateEnum
CREATE TYPE "CustomsDocumentType" AS ENUM ('BC23', 'BC27', 'BC40', 'BC30', 'BC25', 'BC41', 'BC261', 'BC262', 'PPKEKTLDDP', 'PPKEKLDIN', 'PPKEKLDPOUT');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('GAIN', 'LOSS');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'IDR', 'CNY', 'EUR', 'JPY');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "company_type" AS ENUM ('BZ', 'SEZ', 'FTZ', 'REG');

-- CreateEnum
CREATE TYPE "calculation_method" AS ENUM ('TRANSACTION', 'WIP_SNAPSHOT');

-- CreateEnum
CREATE TYPE "stock_opname_status" AS ENUM ('OPEN', 'PROCESS', 'RELEASED');

-- CreateEnum
CREATE TYPE "wms_stock_opname_status" AS ENUM ('ACTIVE', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "beginning_balance_status" AS ENUM ('OPEN', 'TRANSMITTED_TO_INSW', 'LOCKED');

-- CreateEnum
CREATE TYPE "recalc_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "item_types" (
    "item_type_code" VARCHAR(10) NOT NULL,
    "name_en" VARCHAR(100) NOT NULL,
    "name_de" VARCHAR(100),
    "name_id" VARCHAR(100),
    "category" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "item_types_pkey" PRIMARY KEY ("item_type_code")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" SERIAL NOT NULL,
    "code" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "company_type" "company_type",
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" SERIAL NOT NULL,
    "company_code" INTEGER NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "hs_code" VARCHAR(20),
    "uom" VARCHAR(20) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(100) NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'USER',
    "company_code" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "parent_id" TEXT,
    "menu_name" VARCHAR(100) NOT NULL,
    "menu_path" VARCHAR(255),
    "menu_icon" VARCHAR(50),
    "menu_order" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_access_menus" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "menu_id" TEXT NOT NULL,
    "can_view" BOOLEAN NOT NULL DEFAULT true,
    "can_create" BOOLEAN NOT NULL DEFAULT false,
    "can_edit" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_access_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beginning_balances" (
    "id" SERIAL NOT NULL,
    "company_code" INTEGER NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "balance_date" DATE NOT NULL,
    "remarks" VARCHAR(1000),
    "status" "beginning_balance_status" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "beginning_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beginning_balance_ppkeks" (
    "id" SERIAL NOT NULL,
    "beginning_balance_id" INTEGER NOT NULL,
    "ppkek_number" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beginning_balance_ppkeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrap_items" (
    "id" SERIAL NOT NULL,
    "company_code" INTEGER NOT NULL,
    "scrap_code" VARCHAR(50) NOT NULL,
    "scrap_name" VARCHAR(200) NOT NULL,
    "scrap_description" VARCHAR(500),
    "uom" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "scrap_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrap_item_details" (
    "id" SERIAL NOT NULL,
    "scrap_item_id" INTEGER NOT NULL,
    "component_code" VARCHAR(50) NOT NULL,
    "component_name" VARCHAR(200) NOT NULL,
    "component_type" VARCHAR(10) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL,
    "percentage" DECIMAL(5,2),
    "remarks" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scrap_item_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "table_name" VARCHAR(100) NOT NULL,
    "record_id" INTEGER NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "changed_by" VARCHAR(100),
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" VARCHAR(50),
    "user_agent" VARCHAR(500),

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" VARCHAR(100),
    "company_code" INTEGER,
    "action" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'success',
    "metadata" JSONB,
    "ip_address" VARCHAR(50),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wms_transmission_logs" (
    "id" BIGSERIAL NOT NULL,
    "activity_log_id" BIGINT NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "wms_id" VARCHAR(100),
    "company_code" INTEGER,
    "transmission_status" VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    "error_type" VARCHAR(50),
    "summary" TEXT,
    "wms_request_payload" JSONB,
    "imaps_error_response" JSONB,
    "item_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW() + INTERVAL '90 days',

    CONSTRAINT "wms_transmission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_goods" (
    "id" SERIAL NOT NULL,
    "wms_id" VARCHAR(100) NOT NULL,
    "company_code" INTEGER NOT NULL,
    "owner" INTEGER NOT NULL,
    "customs_document_type" "CustomsDocumentType" NOT NULL,
    "ppkek_number" VARCHAR(50) NOT NULL,
    "customs_registration_date" DATE NOT NULL,
    "incoming_evidence_number" VARCHAR(50) NOT NULL,
    "incoming_date" DATE NOT NULL,
    "invoice_number" VARCHAR(50) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "shipper_name" VARCHAR(200) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "incoming_goods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_good_items" (
    "id" SERIAL NOT NULL,
    "incoming_good_id" INTEGER NOT NULL,
    "incoming_good_company" INTEGER NOT NULL,
    "incoming_good_date" DATE NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "hs_code" VARCHAR(20),
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "incoming_good_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_usages" (
    "id" SERIAL NOT NULL,
    "wms_id" VARCHAR(100) NOT NULL,
    "company_code" INTEGER NOT NULL,
    "owner" INTEGER NOT NULL,
    "work_order_number" VARCHAR(50),
    "cost_center_number" TEXT,
    "internal_evidence_number" VARCHAR(50) NOT NULL,
    "transaction_date" DATE NOT NULL,
    "reversal" VARCHAR(1),
    "section" VARCHAR(100),
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "material_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_usage_items" (
    "id" SERIAL NOT NULL,
    "material_usage_id" INTEGER NOT NULL,
    "material_usage_company" INTEGER NOT NULL,
    "material_usage_date" DATE NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "component_demand_qty" DECIMAL(15,3),
    "ppkek_number" VARCHAR(50),
    "amount" DECIMAL(19,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "material_usage_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wip_balances" (
    "id" SERIAL NOT NULL,
    "wms_id" VARCHAR(100) NOT NULL,
    "company_code" INTEGER NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "stock_date" DATE NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "wip_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_outputs" (
    "id" SERIAL NOT NULL,
    "wms_id" VARCHAR(100) NOT NULL,
    "company_code" INTEGER NOT NULL,
    "owner" INTEGER NOT NULL,
    "internal_evidence_number" VARCHAR(50) NOT NULL,
    "transaction_date" DATE NOT NULL,
    "reversal" VARCHAR(1),
    "section" VARCHAR(100),
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "production_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_output_items" (
    "id" SERIAL NOT NULL,
    "production_output_id" INTEGER NOT NULL,
    "production_output_company" INTEGER NOT NULL,
    "production_output_date" DATE NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "amount" DECIMAL(19,4),
    "work_order_number" VARCHAR(50) NOT NULL,
    "planned_production_qty" DECIMAL(15,3) NOT NULL,
    "identify_product" VARCHAR(1) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "production_output_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outgoing_goods" (
    "id" SERIAL NOT NULL,
    "wms_id" VARCHAR(100) NOT NULL,
    "company_code" INTEGER NOT NULL,
    "owner" INTEGER NOT NULL,
    "customs_document_type" "CustomsDocumentType" NOT NULL,
    "ppkek_number" VARCHAR(50) NOT NULL,
    "customs_registration_date" DATE NOT NULL,
    "outgoing_evidence_number" VARCHAR(50) NOT NULL,
    "outgoing_date" DATE NOT NULL,
    "invoice_number" VARCHAR(50) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "recipient_name" VARCHAR(200) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "outgoing_goods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outgoing_good_items" (
    "id" SERIAL NOT NULL,
    "outgoing_good_id" INTEGER NOT NULL,
    "outgoing_good_company" INTEGER NOT NULL,
    "outgoing_good_date" DATE NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "incoming_ppkek_numbers" VARCHAR(50)[],
    "hs_code" VARCHAR(20),
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "outgoing_good_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outgoing_work_order_allocations" (
    "id" SERIAL NOT NULL,
    "outgoing_good_item_id" INTEGER NOT NULL,
    "work_order_number" VARCHAR(50) NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "outgoing_work_order_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustments" (
    "id" SERIAL NOT NULL,
    "wms_id" VARCHAR(100) NOT NULL,
    "company_code" INTEGER NOT NULL,
    "owner" INTEGER NOT NULL,
    "wms_doc_type" VARCHAR(100),
    "internal_evidence_number" VARCHAR(50) NOT NULL,
    "transaction_date" DATE NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment_items" (
    "id" SERIAL NOT NULL,
    "adjustment_id" INTEGER NOT NULL,
    "adjustment_company" INTEGER NOT NULL,
    "adjustment_date" DATE NOT NULL,
    "adjustment_type" "AdjustmentType" NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "reason" VARCHAR(500),
    "stockcount_order_number" VARCHAR(100),
    "amount" DECIMAL(15,4),
    "beginning_qty" DECIMAL(15,3),
    "incoming_qty_on_date" DECIMAL(15,3),
    "outgoing_qty_on_date" DECIMAL(15,3),
    "system_qty" DECIMAL(15,3),
    "adjusted_qty" DECIMAL(15,3),
    "original_beginning_qty" DECIMAL(15,3),
    "original_system_qty" DECIMAL(15,3),
    "variance_vs_original" DECIMAL(15,3),
    "actual_qty_count" DECIMAL(15,3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "adjustment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrap_transactions" (
    "id" SERIAL NOT NULL,
    "company_code" INTEGER NOT NULL,
    "transaction_date" DATE NOT NULL,
    "transaction_type" VARCHAR(10) NOT NULL,
    "document_number" VARCHAR(100) NOT NULL,
    "source" VARCHAR(200),
    "recipient_name" VARCHAR(200),
    "disposal_method" VARCHAR(100),
    "remarks" VARCHAR(1000),
    "ppkek_number" VARCHAR(50),
    "customs_registration_date" DATE,
    "customs_document_type" "CustomsDocumentType",
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "scrap_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrap_transaction_items" (
    "id" SERIAL NOT NULL,
    "scrap_transaction_id" INTEGER NOT NULL,
    "scrap_transaction_company" INTEGER NOT NULL,
    "scrap_transaction_date" DATE NOT NULL,
    "item_type" VARCHAR(10) NOT NULL DEFAULT 'SCRAP',
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "scrap_reason" VARCHAR(500),
    "remarks" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "scrap_transaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_opnames" (
    "id" SERIAL NOT NULL,
    "sto_number" VARCHAR(50) NOT NULL,
    "company_code" INTEGER NOT NULL,
    "sto_datetime" TIMESTAMPTZ(6) NOT NULL,
    "pic_name" VARCHAR(200),
    "status" "stock_opname_status" NOT NULL DEFAULT 'OPEN',
    "created_by" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_opnames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_opname_items" (
    "id" BIGSERIAL NOT NULL,
    "stock_opname_id" INTEGER NOT NULL,
    "company_code" INTEGER NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "sto_qty" DECIMAL(15,3) NOT NULL,
    "end_stock" DECIMAL(15,3) NOT NULL,
    "variant" DECIMAL(15,3) NOT NULL,
    "report_area" VARCHAR(100),
    "remark" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_opname_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_material_consumption" (
    "id" BIGSERIAL NOT NULL,
    "material_usage_id" INTEGER,
    "material_usage_item_id" INTEGER NOT NULL,
    "material_usage_wms_id" VARCHAR(100) NOT NULL,
    "work_order_number" VARCHAR(50) NOT NULL,
    "company_code" INTEGER NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "ppkek_number" VARCHAR(50),
    "qty_consumed" DECIMAL(15,3) NOT NULL,
    "trx_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_material_consumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_fg_production" (
    "id" BIGSERIAL NOT NULL,
    "production_output_id" INTEGER NOT NULL,
    "production_output_item_id" INTEGER NOT NULL,
    "production_wms_id" VARCHAR(100) NOT NULL,
    "work_order_number" VARCHAR(50) NOT NULL,
    "company_code" INTEGER NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "qty_produced" DECIMAL(15,3) NOT NULL,
    "trx_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_fg_production_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outgoing_fg_production_traceability" (
    "id" BIGSERIAL NOT NULL,
    "outgoing_good_item_id" INTEGER NOT NULL,
    "outgoing_wms_id" VARCHAR(100) NOT NULL,
    "production_wms_id" VARCHAR(100) NOT NULL,
    "company_code" INTEGER NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "trx_date" DATE NOT NULL,
    "allocated_qty" DECIMAL(15,3),
    "allocation_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "work_order_number" VARCHAR(50),
    "material_item_code" VARCHAR(50),
    "material_item_name" VARCHAR(200),
    "material_qty_allocated" DECIMAL(15,3),
    "consumption_ratio" DECIMAL(15,8),
    "ppkek_number_incoming" VARCHAR(50),
    "incoming_goods_id" INTEGER,
    "customs_registration_date" DATE,
    "customs_document_type" "CustomsDocumentType",
    "incoming_date" DATE,

    CONSTRAINT "outgoing_fg_production_traceability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_daily_snapshot" (
    "id" BIGSERIAL NOT NULL,
    "company_code" INTEGER NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "opening_balance" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "closing_balance" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "incoming_qty" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "outgoing_qty" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "production_qty" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "material_usage_qty" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "adjustment_qty" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "wip_balance_qty" DECIMAL(15,3),
    "snapshot_date" DATE NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculation_method" "calculation_method" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_daily_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_recalc_queue" (
    "id" BIGSERIAL NOT NULL,
    "company_code" INTEGER NOT NULL,
    "item_type" VARCHAR(10),
    "item_code" VARCHAR(50),
    "recalc_date" DATE NOT NULL,
    "status" "recalc_status" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "reason" VARCHAR(500),
    "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "error_message" TEXT,

    CONSTRAINT "snapshot_recalc_queue_pkey" PRIMARY KEY ("id")
);

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
    "item_name" VARCHAR(200) NOT NULL,
    "item_type" VARCHAR(10) NOT NULL,
    "beginning_qty" DECIMAL(15,3) NOT NULL,
    "incoming_qty_on_date" DECIMAL(15,3) NOT NULL,
    "outgoing_qty_on_date" DECIMAL(15,3) NOT NULL,
    "system_qty" DECIMAL(15,3) NOT NULL,
    "actual_qty_count" DECIMAL(15,3),
    "variance_qty" DECIMAL(15,3) NOT NULL,
    "adjustment_qty_signed" DECIMAL(15,3),
    "adjustment_type" VARCHAR(10),
    "amount" DECIMAL(15,4),
    "final_adjusted_qty" DECIMAL(15,3),
    "reason" TEXT,
    "original_beginning_qty" DECIMAL(15,3),
    "original_system_qty" DECIMAL(15,3),
    "adjustment_applied_at" TIMESTAMPTZ(6),
    "adjustment_applied_by" VARCHAR(50),
    "adjustment_id" INTEGER,
    "wms_ending" DECIMAL(15,3),
    "variance_vs_original" DECIMAL(15,3),
    "uom" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wms_stock_opname_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insw_tracking_log" (
    "id" BIGSERIAL NOT NULL,
    "transaction_type" VARCHAR(20) NOT NULL,
    "transaction_id" INTEGER,
    "wms_id" VARCHAR(100),
    "company_code" INTEGER NOT NULL,
    "insw_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "insw_activity_code" VARCHAR(10),
    "insw_request_payload" JSONB,
    "insw_response" JSONB,
    "insw_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "insw_tracking_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insw_uom_reference" (
    "id" SERIAL NOT NULL,
    "kode" VARCHAR(10) NOT NULL,
    "uraian" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "insw_uom_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insw_integration_settings" (
    "id" SERIAL NOT NULL,
    "endpoint_key" VARCHAR(50) NOT NULL,
    "endpoint_name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" VARCHAR(100),

    CONSTRAINT "insw_integration_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insw_uom_mapping" (
    "id" SERIAL NOT NULL,
    "wms_uom" VARCHAR(50) NOT NULL,
    "insw_uom" VARCHAR(10) NOT NULL,
    "description" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "insw_uom_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_code_key" ON "companies"("code");

-- CreateIndex
CREATE INDEX "companies_code_idx" ON "companies"("code");

-- CreateIndex
CREATE INDEX "companies_status_idx" ON "companies"("status");

-- CreateIndex
CREATE INDEX "items_company_code_idx" ON "items"("company_code");

-- CreateIndex
CREATE INDEX "items_item_code_idx" ON "items"("item_code");

-- CreateIndex
CREATE INDEX "items_item_type_idx" ON "items"("item_type");

-- CreateIndex
CREATE INDEX "items_is_active_idx" ON "items"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "items_company_code_item_code_key" ON "items"("company_code", "item_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_username_idx" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_company_code_idx" ON "users"("company_code");

-- CreateIndex
CREATE INDEX "menus_parent_id_idx" ON "menus"("parent_id");

-- CreateIndex
CREATE INDEX "menus_menu_order_idx" ON "menus"("menu_order");

-- CreateIndex
CREATE INDEX "user_access_menus_user_id_idx" ON "user_access_menus"("user_id");

-- CreateIndex
CREATE INDEX "user_access_menus_menu_id_idx" ON "user_access_menus"("menu_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_access_menus_user_id_menu_id_key" ON "user_access_menus"("user_id", "menu_id");

-- CreateIndex
CREATE INDEX "beginning_balances_company_code_idx" ON "beginning_balances"("company_code");

-- CreateIndex
CREATE INDEX "beginning_balances_item_code_idx" ON "beginning_balances"("item_code");

-- CreateIndex
CREATE INDEX "beginning_balances_balance_date_idx" ON "beginning_balances"("balance_date");

-- CreateIndex
CREATE INDEX "beginning_balances_status_idx" ON "beginning_balances"("status");

-- CreateIndex
CREATE UNIQUE INDEX "beginning_balances_company_code_item_code_uom_key" ON "beginning_balances"("company_code", "item_code", "uom");

-- CreateIndex
CREATE INDEX "beginning_balance_ppkeks_beginning_balance_id_idx" ON "beginning_balance_ppkeks"("beginning_balance_id");

-- CreateIndex
CREATE INDEX "beginning_balance_ppkeks_ppkek_number_idx" ON "beginning_balance_ppkeks"("ppkek_number");

-- CreateIndex
CREATE UNIQUE INDEX "beginning_balance_ppkeks_beginning_balance_id_ppkek_number_key" ON "beginning_balance_ppkeks"("beginning_balance_id", "ppkek_number");

-- CreateIndex
CREATE UNIQUE INDEX "scrap_items_scrap_code_key" ON "scrap_items"("scrap_code");

-- CreateIndex
CREATE INDEX "scrap_items_company_code_idx" ON "scrap_items"("company_code");

-- CreateIndex
CREATE INDEX "scrap_items_scrap_code_idx" ON "scrap_items"("scrap_code");

-- CreateIndex
CREATE INDEX "scrap_items_is_active_idx" ON "scrap_items"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "scrap_items_company_code_scrap_code_key" ON "scrap_items"("company_code", "scrap_code");

-- CreateIndex
CREATE INDEX "scrap_item_details_scrap_item_id_idx" ON "scrap_item_details"("scrap_item_id");

-- CreateIndex
CREATE INDEX "scrap_item_details_component_code_idx" ON "scrap_item_details"("component_code");

-- CreateIndex
CREATE UNIQUE INDEX "scrap_item_details_scrap_item_id_component_code_key" ON "scrap_item_details"("scrap_item_id", "component_code");

-- CreateIndex
CREATE INDEX "audit_logs_table_name_idx" ON "audit_logs"("table_name");

-- CreateIndex
CREATE INDEX "audit_logs_record_id_idx" ON "audit_logs"("record_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_changed_at_idx" ON "audit_logs"("changed_at");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "activity_logs_company_code_idx" ON "activity_logs"("company_code");

-- CreateIndex
CREATE INDEX "activity_logs_action_idx" ON "activity_logs"("action");

-- CreateIndex
CREATE INDEX "activity_logs_status_idx" ON "activity_logs"("status");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- CreateIndex
CREATE INDEX "activity_logs_company_code_created_at_idx" ON "activity_logs"("company_code", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "wms_transmission_logs_activity_log_id_key" ON "wms_transmission_logs"("activity_log_id");

-- CreateIndex
CREATE INDEX "wms_transmission_logs_transmission_status_created_at_idx" ON "wms_transmission_logs"("transmission_status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "wms_transmission_logs_wms_id_company_code_created_at_idx" ON "wms_transmission_logs"("wms_id", "company_code", "created_at" DESC);

-- CreateIndex
CREATE INDEX "wms_transmission_logs_wms_id_created_at_idx" ON "wms_transmission_logs"("wms_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "wms_transmission_logs_company_code_created_at_idx" ON "wms_transmission_logs"("company_code", "created_at" DESC);

-- CreateIndex
CREATE INDEX "wms_transmission_logs_action_transmission_status_idx" ON "wms_transmission_logs"("action", "transmission_status");

-- CreateIndex
CREATE INDEX "wms_transmission_logs_error_type_idx" ON "wms_transmission_logs"("error_type");

-- CreateIndex
CREATE INDEX "wms_transmission_logs_expires_at_idx" ON "wms_transmission_logs"("expires_at");

-- CreateIndex
CREATE INDEX "wms_transmission_logs_created_at_idx" ON "wms_transmission_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "incoming_goods_wms_id_idx" ON "incoming_goods"("wms_id");

-- CreateIndex
CREATE INDEX "incoming_goods_company_code_idx" ON "incoming_goods"("company_code");

-- CreateIndex
CREATE INDEX "incoming_goods_incoming_date_idx" ON "incoming_goods"("incoming_date");

-- CreateIndex
CREATE INDEX "incoming_goods_ppkek_number_idx" ON "incoming_goods"("ppkek_number");

-- CreateIndex
CREATE INDEX "incoming_goods_customs_document_type_idx" ON "incoming_goods"("customs_document_type");

-- CreateIndex
CREATE INDEX "incoming_goods_incoming_evidence_number_idx" ON "incoming_goods"("incoming_evidence_number");

-- CreateIndex
CREATE UNIQUE INDEX "incoming_goods_company_code_wms_id_incoming_date_key" ON "incoming_goods"("company_code", "wms_id", "incoming_date");

-- CreateIndex
CREATE UNIQUE INDEX "incoming_goods_company_code_id_incoming_date_key" ON "incoming_goods"("company_code", "id", "incoming_date");

-- CreateIndex
CREATE INDEX "incoming_good_items_incoming_good_id_idx" ON "incoming_good_items"("incoming_good_id");

-- CreateIndex
CREATE INDEX "incoming_good_items_incoming_good_id_incoming_good_company__idx" ON "incoming_good_items"("incoming_good_id", "incoming_good_company", "incoming_good_date");

-- CreateIndex
CREATE INDEX "incoming_good_items_item_code_idx" ON "incoming_good_items"("item_code");

-- CreateIndex
CREATE INDEX "incoming_good_items_item_type_idx" ON "incoming_good_items"("item_type");

-- CreateIndex
CREATE INDEX "material_usages_wms_id_idx" ON "material_usages"("wms_id");

-- CreateIndex
CREATE INDEX "material_usages_company_code_idx" ON "material_usages"("company_code");

-- CreateIndex
CREATE INDEX "material_usages_transaction_date_idx" ON "material_usages"("transaction_date");

-- CreateIndex
CREATE INDEX "material_usages_work_order_number_idx" ON "material_usages"("work_order_number");

-- CreateIndex
CREATE INDEX "material_usages_cost_center_number_idx" ON "material_usages"("cost_center_number");

-- CreateIndex
CREATE INDEX "material_usages_internal_evidence_number_idx" ON "material_usages"("internal_evidence_number");

-- CreateIndex
CREATE UNIQUE INDEX "material_usages_company_code_wms_id_transaction_date_key" ON "material_usages"("company_code", "wms_id", "transaction_date");

-- CreateIndex
CREATE UNIQUE INDEX "material_usages_company_code_id_transaction_date_key" ON "material_usages"("company_code", "id", "transaction_date");

-- CreateIndex
CREATE INDEX "material_usage_items_material_usage_id_idx" ON "material_usage_items"("material_usage_id");

-- CreateIndex
CREATE INDEX "material_usage_items_material_usage_id_material_usage_compa_idx" ON "material_usage_items"("material_usage_id", "material_usage_company", "material_usage_date");

-- CreateIndex
CREATE INDEX "material_usage_items_item_code_idx" ON "material_usage_items"("item_code");

-- CreateIndex
CREATE INDEX "material_usage_items_item_type_idx" ON "material_usage_items"("item_type");

-- CreateIndex
CREATE INDEX "material_usage_items_ppkek_number_idx" ON "material_usage_items"("ppkek_number");

-- CreateIndex
CREATE INDEX "wip_balances_wms_id_idx" ON "wip_balances"("wms_id");

-- CreateIndex
CREATE INDEX "wip_balances_company_code_idx" ON "wip_balances"("company_code");

-- CreateIndex
CREATE INDEX "wip_balances_stock_date_idx" ON "wip_balances"("stock_date");

-- CreateIndex
CREATE INDEX "wip_balances_item_code_idx" ON "wip_balances"("item_code");

-- CreateIndex
CREATE INDEX "wip_balances_item_type_idx" ON "wip_balances"("item_type");

-- CreateIndex
CREATE UNIQUE INDEX "wip_balances_company_code_wms_id_stock_date_key" ON "wip_balances"("company_code", "wms_id", "stock_date");

-- CreateIndex
CREATE INDEX "production_outputs_wms_id_idx" ON "production_outputs"("wms_id");

-- CreateIndex
CREATE INDEX "production_outputs_company_code_idx" ON "production_outputs"("company_code");

-- CreateIndex
CREATE INDEX "production_outputs_transaction_date_idx" ON "production_outputs"("transaction_date");

-- CreateIndex
CREATE INDEX "production_outputs_internal_evidence_number_idx" ON "production_outputs"("internal_evidence_number");

-- CreateIndex
CREATE UNIQUE INDEX "production_outputs_company_code_wms_id_transaction_date_key" ON "production_outputs"("company_code", "wms_id", "transaction_date");

-- CreateIndex
CREATE UNIQUE INDEX "production_outputs_company_code_id_transaction_date_key" ON "production_outputs"("company_code", "id", "transaction_date");

-- CreateIndex
CREATE INDEX "production_output_items_production_output_id_idx" ON "production_output_items"("production_output_id");

-- CreateIndex
CREATE INDEX "production_output_items_production_output_id_production_out_idx" ON "production_output_items"("production_output_id", "production_output_company", "production_output_date");

-- CreateIndex
CREATE INDEX "production_output_items_item_code_idx" ON "production_output_items"("item_code");

-- CreateIndex
CREATE INDEX "production_output_items_item_type_idx" ON "production_output_items"("item_type");

-- CreateIndex
CREATE INDEX "outgoing_goods_wms_id_idx" ON "outgoing_goods"("wms_id");

-- CreateIndex
CREATE INDEX "outgoing_goods_company_code_idx" ON "outgoing_goods"("company_code");

-- CreateIndex
CREATE INDEX "outgoing_goods_outgoing_date_idx" ON "outgoing_goods"("outgoing_date");

-- CreateIndex
CREATE INDEX "outgoing_goods_ppkek_number_idx" ON "outgoing_goods"("ppkek_number");

-- CreateIndex
CREATE INDEX "outgoing_goods_customs_document_type_idx" ON "outgoing_goods"("customs_document_type");

-- CreateIndex
CREATE INDEX "outgoing_goods_outgoing_evidence_number_idx" ON "outgoing_goods"("outgoing_evidence_number");

-- CreateIndex
CREATE UNIQUE INDEX "outgoing_goods_company_code_wms_id_outgoing_date_key" ON "outgoing_goods"("company_code", "wms_id", "outgoing_date");

-- CreateIndex
CREATE UNIQUE INDEX "outgoing_goods_company_code_id_outgoing_date_key" ON "outgoing_goods"("company_code", "id", "outgoing_date");

-- CreateIndex
CREATE INDEX "outgoing_good_items_outgoing_good_id_idx" ON "outgoing_good_items"("outgoing_good_id");

-- CreateIndex
CREATE INDEX "outgoing_good_items_outgoing_good_id_outgoing_good_company__idx" ON "outgoing_good_items"("outgoing_good_id", "outgoing_good_company", "outgoing_good_date");

-- CreateIndex
CREATE INDEX "outgoing_good_items_item_code_idx" ON "outgoing_good_items"("item_code");

-- CreateIndex
CREATE INDEX "outgoing_good_items_item_type_idx" ON "outgoing_good_items"("item_type");

-- CreateIndex
CREATE INDEX "outgoing_work_order_allocations_work_order_number_idx" ON "outgoing_work_order_allocations"("work_order_number");

-- CreateIndex
CREATE INDEX "outgoing_work_order_allocations_outgoing_good_item_id_idx" ON "outgoing_work_order_allocations"("outgoing_good_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "outgoing_work_order_allocations_outgoing_good_item_id_work__key" ON "outgoing_work_order_allocations"("outgoing_good_item_id", "work_order_number");

-- CreateIndex
CREATE INDEX "adjustments_wms_id_idx" ON "adjustments"("wms_id");

-- CreateIndex
CREATE INDEX "adjustments_company_code_idx" ON "adjustments"("company_code");

-- CreateIndex
CREATE INDEX "adjustments_transaction_date_idx" ON "adjustments"("transaction_date");

-- CreateIndex
CREATE INDEX "adjustments_internal_evidence_number_idx" ON "adjustments"("internal_evidence_number");

-- CreateIndex
CREATE UNIQUE INDEX "adjustments_company_code_wms_id_transaction_date_key" ON "adjustments"("company_code", "wms_id", "transaction_date");

-- CreateIndex
CREATE UNIQUE INDEX "adjustments_company_code_id_transaction_date_key" ON "adjustments"("company_code", "id", "transaction_date");

-- CreateIndex
CREATE INDEX "adjustment_items_adjustment_id_idx" ON "adjustment_items"("adjustment_id");

-- CreateIndex
CREATE INDEX "adjustment_items_adjustment_id_adjustment_company_adjustmen_idx" ON "adjustment_items"("adjustment_id", "adjustment_company", "adjustment_date");

-- CreateIndex
CREATE INDEX "adjustment_items_item_code_idx" ON "adjustment_items"("item_code");

-- CreateIndex
CREATE INDEX "adjustment_items_item_type_idx" ON "adjustment_items"("item_type");

-- CreateIndex
CREATE INDEX "adjustment_items_adjustment_type_idx" ON "adjustment_items"("adjustment_type");

-- CreateIndex
CREATE INDEX "adjustment_items_stockcount_order_number_idx" ON "adjustment_items"("stockcount_order_number");

-- CreateIndex
CREATE INDEX "scrap_transactions_company_code_idx" ON "scrap_transactions"("company_code");

-- CreateIndex
CREATE INDEX "scrap_transactions_transaction_date_idx" ON "scrap_transactions"("transaction_date");

-- CreateIndex
CREATE INDEX "scrap_transactions_document_number_idx" ON "scrap_transactions"("document_number");

-- CreateIndex
CREATE INDEX "scrap_transactions_transaction_type_idx" ON "scrap_transactions"("transaction_type");

-- CreateIndex
CREATE UNIQUE INDEX "scrap_transactions_company_code_id_transaction_date_key" ON "scrap_transactions"("company_code", "id", "transaction_date");

-- CreateIndex
CREATE INDEX "scrap_transaction_items_scrap_transaction_id_idx" ON "scrap_transaction_items"("scrap_transaction_id");

-- CreateIndex
CREATE INDEX "scrap_transaction_items_scrap_transaction_id_scrap_transact_idx" ON "scrap_transaction_items"("scrap_transaction_id", "scrap_transaction_company", "scrap_transaction_date");

-- CreateIndex
CREATE INDEX "scrap_transaction_items_item_code_idx" ON "scrap_transaction_items"("item_code");

-- CreateIndex
CREATE INDEX "scrap_transaction_items_item_type_idx" ON "scrap_transaction_items"("item_type");

-- CreateIndex
CREATE UNIQUE INDEX "stock_opnames_sto_number_key" ON "stock_opnames"("sto_number");

-- CreateIndex
CREATE INDEX "stock_opnames_company_code_sto_datetime_idx" ON "stock_opnames"("company_code", "sto_datetime");

-- CreateIndex
CREATE INDEX "stock_opnames_sto_number_idx" ON "stock_opnames"("sto_number");

-- CreateIndex
CREATE INDEX "stock_opnames_status_idx" ON "stock_opnames"("status");

-- CreateIndex
CREATE INDEX "stock_opnames_created_at_idx" ON "stock_opnames"("created_at");

-- CreateIndex
CREATE INDEX "stock_opnames_company_code_status_sto_datetime_idx" ON "stock_opnames"("company_code", "status", "sto_datetime");

-- CreateIndex
CREATE INDEX "stock_opname_items_stock_opname_id_idx" ON "stock_opname_items"("stock_opname_id");

-- CreateIndex
CREATE INDEX "stock_opname_items_item_code_idx" ON "stock_opname_items"("item_code");

-- CreateIndex
CREATE INDEX "stock_opname_items_item_type_idx" ON "stock_opname_items"("item_type");

-- CreateIndex
CREATE INDEX "stock_opname_items_company_code_idx" ON "stock_opname_items"("company_code");

-- CreateIndex
CREATE INDEX "stock_opname_items_company_code_item_code_idx" ON "stock_opname_items"("company_code", "item_code");

-- CreateIndex
CREATE INDEX "stock_opname_items_variant_idx" ON "stock_opname_items"("variant");

-- CreateIndex
CREATE UNIQUE INDEX "stock_opname_items_stock_opname_id_item_code_key" ON "stock_opname_items"("stock_opname_id", "item_code");

-- CreateIndex
CREATE INDEX "work_order_material_consumption_work_order_number_idx" ON "work_order_material_consumption"("work_order_number");

-- CreateIndex
CREATE INDEX "work_order_material_consumption_company_code_idx" ON "work_order_material_consumption"("company_code");

-- CreateIndex
CREATE INDEX "work_order_material_consumption_ppkek_number_idx" ON "work_order_material_consumption"("ppkek_number");

-- CreateIndex
CREATE INDEX "work_order_material_consumption_trx_date_idx" ON "work_order_material_consumption"("trx_date");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_material_consumption_material_usage_wms_id_work__key" ON "work_order_material_consumption"("material_usage_wms_id", "work_order_number", "item_code", "ppkek_number");

-- CreateIndex
CREATE INDEX "work_order_fg_production_work_order_number_idx" ON "work_order_fg_production"("work_order_number");

-- CreateIndex
CREATE INDEX "work_order_fg_production_company_code_idx" ON "work_order_fg_production"("company_code");

-- CreateIndex
CREATE INDEX "work_order_fg_production_item_type_idx" ON "work_order_fg_production"("item_type");

-- CreateIndex
CREATE INDEX "work_order_fg_production_trx_date_idx" ON "work_order_fg_production"("trx_date");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_fg_production_production_wms_id_work_order_numbe_key" ON "work_order_fg_production"("production_wms_id", "work_order_number", "item_code");

-- CreateIndex
CREATE INDEX "outgoing_fg_production_traceability_outgoing_wms_id_idx" ON "outgoing_fg_production_traceability"("outgoing_wms_id");

-- CreateIndex
CREATE INDEX "outgoing_fg_production_traceability_production_wms_id_idx" ON "outgoing_fg_production_traceability"("production_wms_id");

-- CreateIndex
CREATE INDEX "outgoing_fg_production_traceability_company_code_idx" ON "outgoing_fg_production_traceability"("company_code");

-- CreateIndex
CREATE INDEX "outgoing_fg_production_traceability_trx_date_idx" ON "outgoing_fg_production_traceability"("trx_date");

-- CreateIndex
CREATE INDEX "outgoing_fg_production_traceability_work_order_number_idx" ON "outgoing_fg_production_traceability"("work_order_number");

-- CreateIndex
CREATE INDEX "outgoing_fg_production_traceability_material_item_code_idx" ON "outgoing_fg_production_traceability"("material_item_code");

-- CreateIndex
CREATE INDEX "outgoing_fg_production_traceability_ppkek_number_incoming_idx" ON "outgoing_fg_production_traceability"("ppkek_number_incoming");

-- CreateIndex
CREATE INDEX "outgoing_fg_production_traceability_incoming_goods_id_idx" ON "outgoing_fg_production_traceability"("incoming_goods_id");

-- CreateIndex
CREATE INDEX "outgoing_fg_production_traceability_customs_registration_da_idx" ON "outgoing_fg_production_traceability"("customs_registration_date");

-- CreateIndex
CREATE UNIQUE INDEX "outgoing_fg_production_traceability_outgoing_wms_id_product_key" ON "outgoing_fg_production_traceability"("outgoing_wms_id", "production_wms_id", "item_code", "material_item_code");

-- CreateIndex
CREATE INDEX "stock_daily_snapshot_company_code_snapshot_date_idx" ON "stock_daily_snapshot"("company_code", "snapshot_date");

-- CreateIndex
CREATE INDEX "stock_daily_snapshot_item_type_snapshot_date_idx" ON "stock_daily_snapshot"("item_type", "snapshot_date");

-- CreateIndex
CREATE INDEX "stock_daily_snapshot_snapshot_date_idx" ON "stock_daily_snapshot"("snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_daily_snapshot_company_code_item_type_item_code_uom_s_key" ON "stock_daily_snapshot"("company_code", "item_type", "item_code", "uom", "snapshot_date");

-- CreateIndex
CREATE INDEX "snapshot_recalc_queue_status_priority_queued_at_idx" ON "snapshot_recalc_queue"("status", "priority", "queued_at");

-- CreateIndex
CREATE INDEX "snapshot_recalc_queue_company_code_recalc_date_idx" ON "snapshot_recalc_queue"("company_code", "recalc_date");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_recalc_queue_company_code_recalc_date_item_type_it_key" ON "snapshot_recalc_queue"("company_code", "recalc_date", "item_type", "item_code");

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

-- CreateIndex
CREATE INDEX "wms_stock_opname_items_adjustment_id_idx" ON "wms_stock_opname_items"("adjustment_id");

-- CreateIndex
CREATE INDEX "insw_tracking_log_transaction_type_transaction_id_idx" ON "insw_tracking_log"("transaction_type", "transaction_id");

-- CreateIndex
CREATE INDEX "insw_tracking_log_wms_id_company_code_idx" ON "insw_tracking_log"("wms_id", "company_code");

-- CreateIndex
CREATE INDEX "insw_tracking_log_insw_status_company_code_idx" ON "insw_tracking_log"("insw_status", "company_code");

-- CreateIndex
CREATE INDEX "insw_tracking_log_company_code_created_at_idx" ON "insw_tracking_log"("company_code", "created_at" DESC);

-- CreateIndex
CREATE INDEX "insw_tracking_log_sent_at_idx" ON "insw_tracking_log"("sent_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "insw_uom_reference_kode_key" ON "insw_uom_reference"("kode");

-- CreateIndex
CREATE INDEX "insw_uom_reference_kode_idx" ON "insw_uom_reference"("kode");

-- CreateIndex
CREATE INDEX "insw_uom_reference_is_active_idx" ON "insw_uom_reference"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "insw_integration_settings_endpoint_key_key" ON "insw_integration_settings"("endpoint_key");

-- CreateIndex
CREATE UNIQUE INDEX "insw_uom_mapping_wms_uom_key" ON "insw_uom_mapping"("wms_uom");

-- CreateIndex
CREATE INDEX "insw_uom_mapping_wms_uom_idx" ON "insw_uom_mapping"("wms_uom");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "menus"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_access_menus" ADD CONSTRAINT "user_access_menus_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_access_menus" ADD CONSTRAINT "user_access_menus_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "beginning_balances" ADD CONSTRAINT "beginning_balances_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beginning_balance_ppkeks" ADD CONSTRAINT "beginning_balance_ppkeks_beginning_balance_id_fkey" FOREIGN KEY ("beginning_balance_id") REFERENCES "beginning_balances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrap_items" ADD CONSTRAINT "scrap_items_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrap_item_details" ADD CONSTRAINT "scrap_item_details_scrap_item_id_fkey" FOREIGN KEY ("scrap_item_id") REFERENCES "scrap_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_transmission_logs" ADD CONSTRAINT "wms_transmission_logs_activity_log_id_fkey" FOREIGN KEY ("activity_log_id") REFERENCES "activity_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_goods" ADD CONSTRAINT "incoming_goods_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_usages" ADD CONSTRAINT "material_usages_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_usage_items" ADD CONSTRAINT "material_usage_items_material_usage_company_material_usage_fkey" FOREIGN KEY ("material_usage_company", "material_usage_id", "material_usage_date") REFERENCES "material_usages"("company_code", "id", "transaction_date") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wip_balances" ADD CONSTRAINT "wip_balances_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_output_items" ADD CONSTRAINT "production_output_items_production_output_company_producti_fkey" FOREIGN KEY ("production_output_company", "production_output_id", "production_output_date") REFERENCES "production_outputs"("company_code", "id", "transaction_date") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_goods" ADD CONSTRAINT "outgoing_goods_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_good_items" ADD CONSTRAINT "outgoing_good_items_outgoing_good_company_outgoing_good_id_fkey" FOREIGN KEY ("outgoing_good_company", "outgoing_good_id", "outgoing_good_date") REFERENCES "outgoing_goods"("company_code", "id", "outgoing_date") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_work_order_allocations" ADD CONSTRAINT "outgoing_work_order_allocations_outgoing_good_item_id_fkey" FOREIGN KEY ("outgoing_good_item_id") REFERENCES "outgoing_good_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_items" ADD CONSTRAINT "adjustment_items_adjustment_company_adjustment_id_adjustme_fkey" FOREIGN KEY ("adjustment_company", "adjustment_id", "adjustment_date") REFERENCES "adjustments"("company_code", "id", "transaction_date") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrap_transactions" ADD CONSTRAINT "scrap_transactions_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrap_transaction_items" ADD CONSTRAINT "scrap_transaction_items_scrap_transaction_company_scrap_tr_fkey" FOREIGN KEY ("scrap_transaction_company", "scrap_transaction_id", "scrap_transaction_date") REFERENCES "scrap_transactions"("company_code", "id", "transaction_date") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_opname_items" ADD CONSTRAINT "stock_opname_items_stock_opname_id_fkey" FOREIGN KEY ("stock_opname_id") REFERENCES "stock_opnames"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_material_consumption" ADD CONSTRAINT "work_order_material_consumption_material_usage_id_fkey" FOREIGN KEY ("material_usage_id") REFERENCES "material_usages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_fg_production" ADD CONSTRAINT "work_order_fg_production_production_output_id_fkey" FOREIGN KEY ("production_output_id") REFERENCES "production_outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_fg_production_traceability" ADD CONSTRAINT "outgoing_fg_production_traceability_outgoing_good_item_id_fkey" FOREIGN KEY ("outgoing_good_item_id") REFERENCES "outgoing_good_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_fg_production_traceability" ADD CONSTRAINT "outgoing_fg_production_traceability_incoming_goods_id_fkey" FOREIGN KEY ("incoming_goods_id") REFERENCES "incoming_goods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_daily_snapshot" ADD CONSTRAINT "stock_daily_snapshot_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_recalc_queue" ADD CONSTRAINT "snapshot_recalc_queue_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_stock_opnames" ADD CONSTRAINT "wms_stock_opnames_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_stock_opname_items" ADD CONSTRAINT "wms_stock_opname_items_wms_stock_opname_id_fkey" FOREIGN KEY ("wms_stock_opname_id") REFERENCES "wms_stock_opnames"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_stock_opname_items" ADD CONSTRAINT "wms_stock_opname_items_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "companies"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wms_stock_opname_items" ADD CONSTRAINT "wms_stock_opname_items_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
