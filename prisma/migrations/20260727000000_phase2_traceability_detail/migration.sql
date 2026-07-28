-- Phase 2 traceability detail rows for Work Order material allocation.
ALTER TABLE "outgoing_fg_production_traceability"
  ADD COLUMN "source_material_usage_item_id" INTEGER,
  ADD COLUMN "source_material_usage_wms_id" VARCHAR(100),
  ADD COLUMN "trace_row_type" VARCHAR(20),
  ADD COLUMN "display_ppkek_number" VARCHAR(50),
  ADD COLUMN "ppkek_bucket_key" VARCHAR(80),
  ADD COLUMN "actual_qty" DECIMAL(15,3),
  ADD COLUMN "signed_qty" DECIMAL(15,3),
  ADD COLUMN "material_net_usage_total" DECIMAL(15,3),
  ADD COLUMN "raw_allocated_qty" DECIMAL(18,8),
  ADD COLUMN "final_allocated_qty" DECIMAL(15,3),
  ADD COLUMN "rounding_adjustment" DECIMAL(15,3),
  ADD COLUMN "material_uom" VARCHAR(20);

DROP INDEX IF EXISTS "outgoing_fg_production_traceability_outgoing_wms_id_product_key";

CREATE INDEX "outgoing_fg_production_traceability_source_material_usage_wms_id_idx"
  ON "outgoing_fg_production_traceability"("source_material_usage_wms_id");

CREATE INDEX "outgoing_fg_production_traceability_ppkek_bucket_key_idx"
  ON "outgoing_fg_production_traceability"("ppkek_bucket_key");

CREATE INDEX "out_fg_traceability_detail_idx"
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
