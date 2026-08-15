-- Phase 4E: preserve BOM calculation inputs with each outgoing traceability snapshot.
-- Nullable columns keep direct PPKEK and historical rows valid.
ALTER TABLE "outgoing_fg_production_traceability"
  ADD COLUMN "component_demand_qty" DECIMAL(15,3),
  ADD COLUMN "planned_production_qty" DECIMAL(15,3);
