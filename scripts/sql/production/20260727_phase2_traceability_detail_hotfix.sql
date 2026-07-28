-- Phase 2 traceability detail rows for Work Order material allocation.
ALTER TABLE "outgoing_fg_production_traceability"
  ADD COLUMN IF NOT EXISTS "source_material_usage_item_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "source_material_usage_wms_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "trace_row_type" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "display_ppkek_number" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "ppkek_bucket_key" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "actual_qty" DECIMAL(15,3),
  ADD COLUMN IF NOT EXISTS "signed_qty" DECIMAL(15,3),
  ADD COLUMN IF NOT EXISTS "material_net_usage_total" DECIMAL(15,3),
  ADD COLUMN IF NOT EXISTS "raw_allocated_qty" DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS "final_allocated_qty" DECIMAL(15,3),
  ADD COLUMN IF NOT EXISTS "rounding_adjustment" DECIMAL(15,3),
  ADD COLUMN IF NOT EXISTS "material_uom" VARCHAR(20);

DROP INDEX IF EXISTS "outgoing_fg_production_traceability_outgoing_wms_id_product_key";

CREATE INDEX IF NOT EXISTS "outgoing_fg_production_traceability_source_material_usage_wms_id_idx"
  ON "outgoing_fg_production_traceability"("source_material_usage_wms_id");

CREATE INDEX IF NOT EXISTS "outgoing_fg_production_traceability_ppkek_bucket_key_idx"
  ON "outgoing_fg_production_traceability"("ppkek_bucket_key");

CREATE INDEX IF NOT EXISTS "out_fg_traceability_detail_idx"
  ON "outgoing_fg_production_traceability"(
    "outgoing_good_item_id",
    "work_order_number",
    "production_wms_id",
    "item_code",
    "material_item_code",
    "material_uom",
    "ppkek_bucket_key",
    "trace_row_type",
    "source_material_usage_item_id"
  );
