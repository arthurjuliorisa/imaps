import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';
import { Prisma } from '@prisma/client';

/**
 * Traceability Data Structure - 4-Level Hierarchy
 * Implements the complete traceability model from API v3.3.0
 * 
 * Level 1: OutgoingItem (item_code, item_name, qty, source_type)
 * Level 2A: WorkOrder (production-based) OR Direct PPKEK (incoming-based)
 * Level 3: Materials (production-based only) with consumption details
 * Level 4: PPKEK/Incoming Goods reference with customs details
 */

// ============================================================================
// LEVEL 4: PPKEK / INCOMING GOODS DETAILS
// ============================================================================

export interface TraceabilityPPKEKDetail {
  ppkek_number: string;
  customs_registration_date: string; // YYYY-MM-DD
  customs_document_type: string; // BC23, BC27, etc
  incoming_date: string; // YYYY-MM-DD
  incoming_evidence_number?: string; // Additional context for incoming-based
}

export interface TraceabilityPPKEKWithQty extends TraceabilityPPKEKDetail {
  qty_allocated: number; // Quantity allocated per this PPKEK
  qty_uom: string; // Unit of measure for this allocation
}

// ============================================================================
// LEVEL 3: MATERIALS (Production-Based Only)
// ============================================================================

export interface TraceabilityMaterialDetail {
  material_item_code: string;
  material_item_name: string;
  consumption_ratio: number; // component_demand_qty / planned_production_qty
  ppkeks?: TraceabilityPPKEKWithQty[]; // Multiple PPKEKs with qty allocation for each
}

// ============================================================================
// LEVEL 2: WORK ORDERS (Production-Based) OR PPKEK LIST (Incoming-Based)
// ============================================================================

export interface TraceabilityWorkOrderDetail {
  work_order_number: string;
  qty_per_wo: number; // Qty from this work order
  materials: TraceabilityMaterialDetail[];
}

export interface TraceabilityIncomingPPKEK extends TraceabilityPPKEKDetail {
  // Extends PPKEK detail with optional incoming evidence number
}

// ============================================================================
// LEVEL 1: OUTGOING ITEM (Root)
// ============================================================================

export interface TraceabilityItem {
  outgoing_good_item_id?: number;
  // Level 1: Item details
  item_code: string;
  item_name: string;
  qty: number; // Total outgoing qty
  item_type: string;
  uom: string;
  source_type: 'production' | 'incoming';

  // Level 2: Source-specific data
  work_orders?: TraceabilityWorkOrderDetail[]; // For production-based
  incoming_ppkek_numbers?: TraceabilityIncomingPPKEK[]; // For incoming-based (with full details)
}

export interface TraceabilityDetailRow {
  outgoing_good_item_id: number;
  work_order_number: string | null;
  production_wms_id: string;
  material_item_code: string | null;
  material_item_name: string | null;
  material_uom: string | null;
  consumption_ratio: number | null;
  allocated_qty: number | null;
  material_qty_allocated: number | null;
  component_demand_qty: number | null;
  planned_production_qty: number | null;
  source_material_usage_wms_id: string | null;
  source_material_usage_item_id: number | null;
  trace_row_type: string | null;
  display_ppkek_number: string | null;
  ppkek_bucket_key: string | null;
  actual_qty: number | null;
  signed_qty: number | null;
  raw_allocated_qty: number | null;
  final_allocated_qty: number | null;
  rounding_adjustment: number | null;
  material_net_usage_total: number | null;
  incoming_goods_id: number | null;
  ppkek_number_incoming: string | null;
  customs_document_type: string | null;
  customs_registration_date: string | null;
  incoming_date: string | null;
}

export interface TraceabilityRecalculationStatus {
  has_recalculated: boolean;
  last_recalculated_at: string | null;
  last_recalculated_by: string | null;
}

export interface TraceabilitySummaryRow {
  outgoing_good_item_id: number;
  work_order_number: string | null;
  material_item_code: string | null;
  material_item_name: string | null;
  material_uom: string | null;
  display_ppkek_number: string | null;
  ppkek_bucket_key: string | null;
  customs_document_type: string | null;
  customs_registration_date: string | null;
  incoming_date: string | null;
  normal_actual_qty: number;
  reversal_actual_qty: number;
  net_usage_qty: number;
  final_allocated_qty: number;
  rounding_adjustment_total: number;
}

function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
  return value == null ? null : Number(value.toString());
}

function dateToISODate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().split('T')[0] : null;
}

type TraceabilityDetailRecord = {
  outgoing_good_item_id: number;
  work_order_number: string | null;
  production_wms_id: string;
  material_item_code: string | null;
  material_item_name: string | null;
  material_uom: string | null;
  consumption_ratio: Prisma.Decimal | null;
  allocated_qty: Prisma.Decimal | null;
  material_qty_allocated: Prisma.Decimal | null;
  component_demand_qty: Prisma.Decimal | null;
  planned_production_qty: Prisma.Decimal | null;
  source_material_usage_wms_id: string | null;
  source_material_usage_item_id: number | null;
  trace_row_type: string | null;
  display_ppkek_number: string | null;
  ppkek_bucket_key: string | null;
  actual_qty: Prisma.Decimal | null;
  signed_qty: Prisma.Decimal | null;
  raw_allocated_qty: Prisma.Decimal | null;
  final_allocated_qty: Prisma.Decimal | null;
  rounding_adjustment: Prisma.Decimal | null;
  material_net_usage_total: Prisma.Decimal | null;
  incoming_goods_id: number | null;
  ppkek_number_incoming: string | null;
  customs_document_type: string | null;
  customs_registration_date: Date | null;
  incoming_date: Date | null;
};

type CurrentFreshnessRow = {
  outgoing_good_item_id: number;
  work_order_number: string;
  allocation_qty: Prisma.Decimal;
  production_wms_id: string | null;
  planned_production_qty: Prisma.Decimal | null;
  identify_product: string | null;
  production_source_updated_at: Date | null;
  source_material_usage_item_id: number | null;
  source_material_usage_wms_id: string | null;
  material_item_code: string | null;
  material_item_name: string | null;
  material_uom: string | null;
  component_demand_qty: Prisma.Decimal | null;
  trace_row_type: string | null;
  display_ppkek_number: string | null;
  ppkek_bucket_key: string | null;
  actual_qty: Prisma.Decimal | null;
  material_source_updated_at: Date | null;
  incoming_goods_id: number | null;
  ppkek_number_incoming: string | null;
  customs_document_type: string | null;
  customs_registration_date: Date | null;
  incoming_date: Date | null;
  incoming_source_updated_at: Date | null;
};

type PersistedFreshnessRow = {
  outgoing_good_item_id: number;
  work_order_number: string | null;
  production_wms_id: string;
  allocated_qty: Prisma.Decimal | null;
  planned_production_qty: Prisma.Decimal | null;
  component_demand_qty: Prisma.Decimal | null;
  source_material_usage_item_id: number | null;
  source_material_usage_wms_id: string | null;
  material_item_code: string | null;
  material_item_name: string | null;
  material_uom: string | null;
  trace_row_type: string | null;
  display_ppkek_number: string | null;
  ppkek_bucket_key: string | null;
  actual_qty: Prisma.Decimal | null;
  incoming_goods_id: number | null;
  ppkek_number_incoming: string | null;
  customs_document_type: string | null;
  customs_registration_date: Date | null;
  incoming_date: Date | null;
  created_at: Date;
};

type DirectFreshnessResult = { is_stale: boolean };

function decimalState(value: Prisma.Decimal | null): string | null {
  return value === null ? null : new Prisma.Decimal(value).toString();
}

function dateState(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function freshnessTargetKey(outgoingItemId: number, workOrderNumber: string | null): string {
  return `${outgoingItemId}|${workOrderNumber || ''}`;
}

/**
 * Traceability Repository
 * Handles fetching and enriching traceability data from multiple sources
 */
export class TraceabilityRepository {
  /**
   * Compare the calculator's current source state with its persisted snapshot.
   * This is deliberately a read-only gate: calculation and replacement remain
   * owned by OutgoingGoodsRepository.recalculateTraceabilityForOutgoing().
   */
  async isTraceabilityStale(outgoingGoodId: number, companyCode: number): Promise<boolean> {
    const currentRows = await prisma.$queryRaw<CurrentFreshnessRow[]>`
      WITH targets AS (
        SELECT
          ogi.id AS outgoing_good_item_id,
          ogi.item_code,
          og.outgoing_date,
          owa.work_order_number,
          owa.qty AS allocation_qty
        FROM outgoing_goods og
        JOIN outgoing_good_items ogi
          ON ogi.outgoing_good_id = og.id
          AND ogi.outgoing_good_company = og.company_code
          AND ogi.outgoing_good_date = og.outgoing_date
        JOIN outgoing_work_order_allocations owa
          ON owa.outgoing_good_item_id = ogi.id
        WHERE og.id = ${outgoingGoodId}
          AND og.company_code = ${companyCode}
          AND og.deleted_at IS NULL
          AND ogi.deleted_at IS NULL
          AND UPPER(ogi.item_type) IN ('FERT', 'HALB')
      )
      SELECT
        t.outgoing_good_item_id,
        t.work_order_number,
        t.allocation_qty,
        production_source.production_wms_id,
        production_plan.planned_production_qty,
        production_plan.identify_product,
        GREATEST(
          production_source.created_at,
          production_plan.header_updated_at,
          production_plan.item_updated_at
        ) AS production_source_updated_at,
        material_source.source_material_usage_item_id,
        material_source.source_material_usage_wms_id,
        material_source.material_item_code,
        material_source.material_item_name,
        material_source.material_uom,
        material_source.component_demand_qty,
        material_source.trace_row_type,
        material_source.display_ppkek_number,
        material_source.ppkek_bucket_key,
        material_source.actual_qty,
        material_source.material_source_updated_at,
        incoming_source.incoming_goods_id,
        incoming_source.ppkek_number_incoming,
        incoming_source.customs_document_type,
        incoming_source.customs_registration_date,
        incoming_source.incoming_date,
        incoming_source.incoming_source_updated_at
      FROM targets t
      LEFT JOIN LATERAL (
        SELECT wofp.production_wms_id, wofp.created_at
        FROM work_order_fg_production wofp
        WHERE wofp.company_code = ${companyCode}
          AND wofp.work_order_number = t.work_order_number
          AND wofp.item_code = t.item_code
        ORDER BY wofp.id DESC
        LIMIT 1
      ) production_source ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          poi.planned_production_qty,
          poi.identify_product,
          po.updated_at AS header_updated_at,
          poi.updated_at AS item_updated_at
        FROM production_output_items poi
        JOIN production_outputs po
          ON poi.production_output_id = po.id
          AND poi.production_output_company = po.company_code
          AND poi.production_output_date = po.transaction_date
        WHERE poi.item_code = t.item_code
          AND poi.work_order_number = t.work_order_number
          AND po.company_code = ${companyCode}
          AND poi.deleted_at IS NULL
          AND po.deleted_at IS NULL
          AND COALESCE(po.reversal, '') <> 'Y'
        ORDER BY po.transaction_date DESC, po.timestamp DESC, po.id DESC, poi.id DESC
        LIMIT 1
      ) production_plan ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          mui.id AS source_material_usage_item_id,
          mu.wms_id AS source_material_usage_wms_id,
          mui.item_code AS material_item_code,
          planning.item_name AS material_item_name,
          mui.uom AS material_uom,
          planning.component_demand_qty,
          CASE WHEN mu.reversal = 'Y' THEN 'REVERSAL' ELSE 'NORMAL' END AS trace_row_type,
          CASE WHEN NULLIF(BTRIM(mui.ppkek_number), '') IS NULL THEN NULL ELSE BTRIM(mui.ppkek_number) END AS display_ppkek_number,
          CASE
            WHEN NULLIF(BTRIM(mui.ppkek_number), '') IS NULL THEN 'BLANK'
            WHEN BTRIM(mui.ppkek_number) = 'N' THEN 'LITERAL_N'
            ELSE 'PPKEK:' || BTRIM(mui.ppkek_number)
          END AS ppkek_bucket_key,
          mui.qty AS actual_qty,
          GREATEST(mu.updated_at, mui.updated_at, planning.source_updated_at) AS material_source_updated_at,
          CASE
            WHEN NULLIF(BTRIM(mui.ppkek_number), '') IS NULL OR BTRIM(mui.ppkek_number) = 'N' THEN NULL
            ELSE BTRIM(mui.ppkek_number)
          END AS resolvable_ppkek
        FROM material_usage_items mui
        JOIN material_usages mu
          ON mui.material_usage_id = mu.id
          AND mui.material_usage_company = mu.company_code
          AND mui.material_usage_date = mu.transaction_date
        JOIN LATERAL (
          SELECT
            planning_mui.item_name,
            planning_mui.component_demand_qty,
            GREATEST(planning_mu.updated_at, planning_mui.updated_at) AS source_updated_at
          FROM material_usage_items planning_mui
          JOIN material_usages planning_mu
            ON planning_mui.material_usage_id = planning_mu.id
            AND planning_mui.material_usage_company = planning_mu.company_code
            AND planning_mui.material_usage_date = planning_mu.transaction_date
          WHERE planning_mu.work_order_number = t.work_order_number
            AND planning_mu.company_code = ${companyCode}
            AND planning_mui.item_code = mui.item_code
            AND planning_mui.uom = mui.uom
            AND planning_mu.reversal IS DISTINCT FROM 'Y'
            AND planning_mui.component_demand_qty IS NOT NULL
            AND planning_mui.deleted_at IS NULL
            AND planning_mu.deleted_at IS NULL
          ORDER BY planning_mu.transaction_date DESC, planning_mu.timestamp DESC, planning_mu.id DESC, planning_mui.id DESC
          LIMIT 1
        ) planning ON TRUE
        WHERE mu.work_order_number = t.work_order_number
          AND mu.company_code = ${companyCode}
          AND mui.item_type IN ('ROH', 'HALB')
          AND mui.deleted_at IS NULL
          AND mu.deleted_at IS NULL
        ORDER BY mui.item_code, mui.uom, mu.transaction_date, mu.timestamp, mu.id, mui.id
      ) material_source ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          ig.id AS incoming_goods_id,
          ig.ppkek_number AS ppkek_number_incoming,
          ig.customs_document_type::text AS customs_document_type,
          ig.customs_registration_date,
          ig.incoming_date,
          ig.updated_at AS incoming_source_updated_at
        FROM incoming_goods ig
        WHERE ig.ppkek_number = material_source.resolvable_ppkek
          AND ig.company_code = ${companyCode}
          AND COALESCE(ig.is_non_facility, false) = false
          AND ig.customs_document_type IS NOT NULL
          AND ig.customs_registration_date IS NOT NULL
          AND ig.deleted_at IS NULL
          AND EXTRACT(YEAR FROM ig.incoming_date) <= EXTRACT(YEAR FROM t.outgoing_date)
        ORDER BY
          CASE WHEN EXTRACT(YEAR FROM ig.incoming_date) = EXTRACT(YEAR FROM t.outgoing_date) THEN 0 ELSE 1 END,
          EXTRACT(YEAR FROM ig.incoming_date) DESC,
          ig.incoming_date ASC
        LIMIT 1
      ) incoming_source ON TRUE
      ORDER BY t.outgoing_good_item_id, t.work_order_number, material_source.source_material_usage_item_id
    `;

    const persistedRows = await prisma.$queryRaw<PersistedFreshnessRow[]>`
      SELECT
        oft.outgoing_good_item_id,
        oft.work_order_number,
        oft.production_wms_id,
        oft.allocated_qty,
        oft.planned_production_qty,
        oft.component_demand_qty,
        oft.source_material_usage_item_id,
        oft.source_material_usage_wms_id,
        oft.material_item_code,
        oft.material_item_name,
        oft.material_uom,
        oft.trace_row_type,
        oft.display_ppkek_number,
        oft.ppkek_bucket_key,
        oft.actual_qty,
        oft.incoming_goods_id,
        oft.ppkek_number_incoming,
        oft.customs_document_type::text AS customs_document_type,
        oft.customs_registration_date,
        oft.incoming_date,
        oft.created_at
      FROM outgoing_fg_production_traceability oft
      JOIN outgoing_good_items ogi ON ogi.id = oft.outgoing_good_item_id
      WHERE ogi.outgoing_good_id = ${outgoingGoodId}
        AND oft.company_code = ${companyCode}
        AND oft.production_wms_id NOT LIKE 'INCOMING\\_%' ESCAPE '\\'
      ORDER BY oft.outgoing_good_item_id, oft.work_order_number, oft.source_material_usage_item_id, oft.id
    `;

    // Direct incoming allocations have no normalized upstream allocation row;
    // their stable rebuild input is the persisted PPKEK split itself. Still
    // verify that the calculator's PPKEK resolver would select the same current
    // incoming record and customs fields.
    const directFreshness = await prisma.$queryRaw<DirectFreshnessResult[]>`
      WITH direct_rows AS (
        SELECT
          oft.incoming_goods_id,
          oft.ppkek_number_incoming,
          oft.customs_document_type::text AS customs_document_type,
          oft.customs_registration_date,
          oft.incoming_date,
          oft.created_at,
          og.outgoing_date
        FROM outgoing_fg_production_traceability oft
        JOIN outgoing_good_items ogi ON ogi.id = oft.outgoing_good_item_id
        JOIN outgoing_goods og
          ON og.id = ogi.outgoing_good_id
          AND og.company_code = ogi.outgoing_good_company
          AND og.outgoing_date = ogi.outgoing_good_date
        WHERE og.id = ${outgoingGoodId}
          AND oft.company_code = ${companyCode}
          AND oft.production_wms_id LIKE 'INCOMING\\_%' ESCAPE '\\'
          AND oft.material_item_code IS NULL
          AND oft.ppkek_number_incoming IS NOT NULL
      )
      SELECT COALESCE(BOOL_OR(
        direct_rows.incoming_goods_id IS DISTINCT FROM current_incoming.id
        OR direct_rows.ppkek_number_incoming IS DISTINCT FROM current_incoming.ppkek_number
        OR direct_rows.customs_document_type IS DISTINCT FROM current_incoming.customs_document_type
        OR direct_rows.customs_registration_date IS DISTINCT FROM current_incoming.customs_registration_date
        OR direct_rows.incoming_date IS DISTINCT FROM current_incoming.incoming_date
        OR current_incoming.updated_at > direct_rows.created_at
      ), false) AS is_stale
      FROM direct_rows
      LEFT JOIN LATERAL (
        SELECT
          ig.id,
          ig.ppkek_number,
          ig.customs_document_type::text AS customs_document_type,
          ig.customs_registration_date,
          ig.incoming_date,
          ig.updated_at
        FROM incoming_goods ig
        WHERE ig.ppkek_number = direct_rows.ppkek_number_incoming
          AND ig.company_code = ${companyCode}
          AND COALESCE(ig.is_non_facility, false) = false
          AND ig.customs_document_type IS NOT NULL
          AND ig.customs_registration_date IS NOT NULL
          AND ig.deleted_at IS NULL
          AND EXTRACT(YEAR FROM ig.incoming_date) <= EXTRACT(YEAR FROM direct_rows.outgoing_date)
        ORDER BY
          CASE WHEN EXTRACT(YEAR FROM ig.incoming_date) = EXTRACT(YEAR FROM direct_rows.outgoing_date) THEN 0 ELSE 1 END,
          EXTRACT(YEAR FROM ig.incoming_date) DESC,
          ig.incoming_date ASC
        LIMIT 1
      ) current_incoming ON TRUE
    `;

    if (directFreshness[0]?.is_stale) {
      return true;
    }

    const currentByTarget = new Map<string, CurrentFreshnessRow[]>();
    const persistedByTarget = new Map<string, PersistedFreshnessRow[]>();
    for (const row of currentRows) {
      const key = freshnessTargetKey(row.outgoing_good_item_id, row.work_order_number);
      currentByTarget.set(key, [...(currentByTarget.get(key) || []), row]);
    }
    for (const row of persistedRows) {
      // A failed/not-found enrichment is intentionally persisted as one base
      // row without work_order_number. Associate that placeholder by the
      // production source that processTraceabilityAfterCoreCommit selected.
      const placeholderTarget = row.work_order_number === null
        ? Array.from(currentByTarget.entries()).find(([, current]) =>
            current[0]?.outgoing_good_item_id === row.outgoing_good_item_id &&
            current[0]?.production_wms_id === row.production_wms_id
          )
        : undefined;
      const key = placeholderTarget?.[0]
        ?? freshnessTargetKey(row.outgoing_good_item_id, row.work_order_number);
      persistedByTarget.set(key, [...(persistedByTarget.get(key) || []), row]);
    }

    if (currentRows.length === 0) {
      return persistedRows.length > 0;
    }

    for (const [key, targetRows] of currentByTarget) {
      const persisted = persistedByTarget.get(key) || [];
      const target = targetRows[0];

      if (!target.production_wms_id) {
        if (persisted.length > 0) return true;
        continue;
      }

      const hasUsablePlan = target.identify_product !== null && !(
        target.identify_product === 'Y' &&
        (target.planned_production_qty === null || new Prisma.Decimal(target.planned_production_qty).isZero())
      );
      const sourceRows = targetRows.filter((row) => row.source_material_usage_item_id !== null);
      const expectsDetails = hasUsablePlan && sourceRows.length > 0;

      if (!expectsDetails) {
        if (persisted.length !== 1 || persisted[0].source_material_usage_item_id !== null) return true;
      } else if (persisted.length !== sourceRows.length) {
        return true;
      }

      const persistedBySourceId = new Map(persisted.map((row) => [row.source_material_usage_item_id, row]));
      for (const source of expectsDetails ? sourceRows : [target]) {
        const snapshot = expectsDetails
          ? persistedBySourceId.get(source.source_material_usage_item_id)
          : persisted[0];
        if (!snapshot) return true;

        const expectedPlannedQty = source.planned_production_qty === null && source.identify_product !== 'Y'
          ? new Prisma.Decimal(1)
          : source.planned_production_qty;
        const fieldsMatch =
          snapshot.production_wms_id === source.production_wms_id &&
          decimalState(snapshot.allocated_qty) === decimalState(source.allocation_qty) &&
          decimalState(snapshot.planned_production_qty) === decimalState(expectedPlannedQty) &&
          snapshot.source_material_usage_wms_id === source.source_material_usage_wms_id &&
          snapshot.material_item_code === source.material_item_code &&
          snapshot.material_item_name === source.material_item_name &&
          snapshot.material_uom === source.material_uom &&
          decimalState(snapshot.component_demand_qty) === decimalState(source.component_demand_qty) &&
          snapshot.trace_row_type === source.trace_row_type &&
          snapshot.display_ppkek_number === source.display_ppkek_number &&
          snapshot.ppkek_bucket_key === source.ppkek_bucket_key &&
          decimalState(snapshot.actual_qty) === decimalState(source.actual_qty) &&
          snapshot.incoming_goods_id === source.incoming_goods_id &&
          snapshot.ppkek_number_incoming === source.ppkek_number_incoming &&
          snapshot.customs_document_type === source.customs_document_type &&
          dateState(snapshot.customs_registration_date) === dateState(source.customs_registration_date) &&
          dateState(snapshot.incoming_date) === dateState(source.incoming_date);
        if (!fieldsMatch) return true;

        const snapshotTime = snapshot.created_at.getTime();
        const sourceTimes = [
          source.production_source_updated_at,
          source.material_source_updated_at,
          source.incoming_source_updated_at,
        ].filter((value): value is Date => value !== null);
        if (sourceTimes.some((value) => value.getTime() > snapshotTime)) return true;
      }

      persistedByTarget.delete(key);
    }

    return persistedByTarget.size > 0;
  }

  /**
   * Get Phase 2 persisted material traceability detail rows.
   *
   * This is a read-model query only: no PPKEK resolution or allocation math is
   * performed here, so blank/null buckets and historical literal N buckets stay
   * exactly as persisted by the calculation phase.
   */
  async getTraceabilityDetailsByOutgoingItemIds(
    outgoingItemIds: number[],
    companyCode: number
  ): Promise<TraceabilityDetailRow[]> {
    if (outgoingItemIds.length === 0) {
      return [];
    }

    const rows = await prisma.$queryRaw<TraceabilityDetailRecord[]>`
      SELECT
        "outgoing_good_item_id",
        "work_order_number",
        "production_wms_id",
        "material_item_code",
        "material_item_name",
        "material_uom",
        "consumption_ratio",
        "allocated_qty",
        "material_qty_allocated",
        "component_demand_qty",
        "planned_production_qty",
        "source_material_usage_wms_id",
        "source_material_usage_item_id",
        "trace_row_type",
        "display_ppkek_number",
        "ppkek_bucket_key",
        "actual_qty",
        "signed_qty",
        "raw_allocated_qty",
        "final_allocated_qty",
        "rounding_adjustment",
        "material_net_usage_total",
        "incoming_goods_id",
        "ppkek_number_incoming",
        "customs_document_type",
        "customs_registration_date",
        "incoming_date"
      FROM "outgoing_fg_production_traceability"
      WHERE "company_code" = ${companyCode}
        AND "outgoing_good_item_id" IN (${Prisma.join(outgoingItemIds)})
      ORDER BY
        "work_order_number" ASC NULLS LAST,
        "production_wms_id" ASC,
        "material_item_code" ASC NULLS LAST,
        "ppkek_bucket_key" ASC NULLS LAST,
        "trace_row_type" ASC NULLS LAST,
        "source_material_usage_wms_id" ASC NULLS LAST,
        "source_material_usage_item_id" ASC NULLS LAST,
        "id" ASC
    `;

    return rows.map((row) => ({
      outgoing_good_item_id: row.outgoing_good_item_id,
      work_order_number: row.work_order_number,
      production_wms_id: row.production_wms_id,
      material_item_code: row.material_item_code,
      material_item_name: row.material_item_name,
      material_uom: row.material_uom,
      consumption_ratio: decimalToNumber(row.consumption_ratio),
      allocated_qty: decimalToNumber(row.allocated_qty),
      material_qty_allocated: decimalToNumber(row.material_qty_allocated),
      component_demand_qty: decimalToNumber(row.component_demand_qty),
      planned_production_qty: decimalToNumber(row.planned_production_qty),
      source_material_usage_wms_id: row.source_material_usage_wms_id,
      source_material_usage_item_id: row.source_material_usage_item_id,
      trace_row_type: row.trace_row_type,
      display_ppkek_number: row.display_ppkek_number,
      ppkek_bucket_key: row.ppkek_bucket_key,
      actual_qty: decimalToNumber(row.actual_qty),
      signed_qty: decimalToNumber(row.signed_qty),
      raw_allocated_qty: decimalToNumber(row.raw_allocated_qty),
      final_allocated_qty: decimalToNumber(row.final_allocated_qty),
      rounding_adjustment: decimalToNumber(row.rounding_adjustment),
      material_net_usage_total: decimalToNumber(row.material_net_usage_total),
      incoming_goods_id: row.incoming_goods_id,
      ppkek_number_incoming: row.ppkek_number_incoming,
      customs_document_type: row.customs_document_type,
      customs_registration_date: dateToISODate(row.customs_registration_date),
      incoming_date: dateToISODate(row.incoming_date),
    }));
  }

  /**
   * Reads the latest successful Phase 4F recalculate event for one outgoing
   * transaction. This status belongs to the modal, not an individual detail
   * row, so it remains a single targeted query.
   */
  async getRecalculationStatus(
    outgoingGoodId: number,
    companyCode: number
  ): Promise<TraceabilityRecalculationStatus> {
    const latestEvent = await prisma.activity_logs.findFirst({
      where: {
        company_code: companyCode,
        action: 'OUTGOING_TRACEABILITY_RECALCULATE',
        status: 'success',
        metadata: {
          path: ['outgoing_good_id'],
          equals: outgoingGoodId,
        },
      },
      orderBy: { created_at: 'desc' },
      select: {
        created_at: true,
        users: { select: { full_name: true, username: true } },
      },
    });

    return {
      has_recalculated: Boolean(latestEvent),
      last_recalculated_at: latestEvent?.created_at.toISOString() ?? null,
      last_recalculated_by: latestEvent?.users?.full_name || latestEvent?.users?.username || null,
    };
  }

  buildTraceabilitySummary(details: TraceabilityDetailRow[]): TraceabilitySummaryRow[] {
    const summaryByKey = new Map<string, TraceabilitySummaryRow>();

    for (const detail of details) {
      const key = [
        detail.outgoing_good_item_id,
        detail.work_order_number || '',
        detail.material_item_code || '',
        detail.material_uom || '',
        detail.ppkek_bucket_key || '',
      ].join('|');

      const current = summaryByKey.get(key) || {
        outgoing_good_item_id: detail.outgoing_good_item_id,
        work_order_number: detail.work_order_number,
        material_item_code: detail.material_item_code,
        material_item_name: detail.material_item_name,
        material_uom: detail.material_uom,
        display_ppkek_number: detail.display_ppkek_number,
        ppkek_bucket_key: detail.ppkek_bucket_key,
        customs_document_type: detail.customs_document_type,
        customs_registration_date: detail.customs_registration_date,
        incoming_date: detail.incoming_date,
        normal_actual_qty: 0,
        reversal_actual_qty: 0,
        net_usage_qty: 0,
        final_allocated_qty: 0,
        rounding_adjustment_total: 0,
      };

      const actualQty = detail.actual_qty || 0;
      const traceRowType = detail.trace_row_type || 'NORMAL';

      if (traceRowType === 'REVERSAL') {
        current.reversal_actual_qty += actualQty;
      } else {
        current.normal_actual_qty += actualQty;
      }

      current.net_usage_qty += detail.signed_qty || 0;
      current.final_allocated_qty += detail.final_allocated_qty || 0;
      current.rounding_adjustment_total += detail.rounding_adjustment || 0;

      summaryByKey.set(key, current);
    }

    return Array.from(summaryByKey.values()).map((row) => ({
      ...row,
      normal_actual_qty: Number(row.normal_actual_qty.toFixed(3)),
      reversal_actual_qty: Number(row.reversal_actual_qty.toFixed(3)),
      net_usage_qty: Number(row.net_usage_qty.toFixed(3)),
      final_allocated_qty: Number(row.final_allocated_qty.toFixed(3)),
      rounding_adjustment_total: Number(row.rounding_adjustment_total.toFixed(3)),
    }));
  }

  /**
   * Calculate the quantity shown in the modal for a material PPKEK row.
   *
   * `work_order_material_consumption.qty_consumed` is full WO material
   * consumption. For partial outgoing/export transactions, the modal should
   * prefer the already-calculated outgoing proportional allocation from
   * `outgoing_fg_production_traceability.material_qty_allocated`.
   */
  private calculateDisplayedAllocatedQty(
    materialAllocatedQty: Prisma.Decimal | null | undefined,
    ppkekQtyConsumed: Prisma.Decimal,
    totalRelevantQtyConsumed: Prisma.Decimal,
    ppkekCount: number
  ): number {
    if (!materialAllocatedQty) {
      return Number(ppkekQtyConsumed.toString());
    }

    const outgoingAllocatedQty = new Prisma.Decimal(materialAllocatedQty.toString());

    if (ppkekCount <= 1) {
      return Number(outgoingAllocatedQty.toString());
    }

    if (totalRelevantQtyConsumed.isZero()) {
      return Number(ppkekQtyConsumed.toString());
    }

    return Number(
      outgoingAllocatedQty
        .mul(ppkekQtyConsumed)
        .div(totalRelevantQtyConsumed)
        .toString()
    );
  }

  /**
   * Get traceability for a single outgoing item
   * 
   * Data Sources:
   * 1. outgoing_good_items - base item info
   * 2. incoming_ppkek_numbers[] field - determines scenario
   * 3. outgoing_work_order_allocations - work order breakdown (if production-based)
   * 4. outgoing_fg_production_traceability - enriched material data (if production-based)
   * 5. incoming_goods - resolve PPKEK details (if incoming-based or for material PPKEK)
   */
  async getTraceabilityByOutgoingItem(
    outgoingItemId: number,
    companyCode: number
  ): Promise<TraceabilityItem | null> {
    const log = logger.child({
      scope: 'TraceabilityRepository.getTraceabilityByOutgoingItem',
      outgoingItemId,
      companyCode,
    });

    try {
      // =====================================================================
      // STEP 1: Get outgoing item base data
      // =====================================================================
      const outgoingItem = await prisma.outgoing_good_items.findUnique({
        where: { id: outgoingItemId },
      });

      if (!outgoingItem) {
        log.warn('Outgoing item not found');
        return null;
      }

      const incomingPPKEKArray = (outgoingItem as any).incoming_ppkek_numbers || [];
      const hasIncomingPPKEK =
        Array.isArray(incomingPPKEKArray) && incomingPPKEKArray.length > 0;

      // =====================================================================
      // SCENARIO A: INCOMING-BASED
      // =====================================================================
      if (hasIncomingPPKEK) {
        log.info('Using incoming-based traceability', {
          ppkekCount: incomingPPKEKArray.length,
        });

        // Resolve each PPKEK to incoming goods with full details
        const resolvedPPKEKs: TraceabilityIncomingPPKEK[] = [];

        for (const ppkekNumber of incomingPPKEKArray) {
          const incomingGood = await prisma.incoming_goods.findFirst({
            where: {
              ppkek_number: ppkekNumber,
              company_code: companyCode,
            },
            orderBy: { incoming_date: 'desc' },
          });

          if (incomingGood) {
            resolvedPPKEKs.push({
              ppkek_number: incomingGood.ppkek_number || '',
              customs_registration_date: incomingGood.customs_registration_date
                ? new Date(incomingGood.customs_registration_date).toISOString().split('T')[0]
                : '',
              customs_document_type: incomingGood.customs_document_type?.toString() || '',
              incoming_date: incomingGood.incoming_date
                ? new Date(incomingGood.incoming_date).toISOString().split('T')[0]
                : '',
              incoming_evidence_number: incomingGood.incoming_evidence_number || undefined,
            });
          } else {
            // PPKEK not found in incoming goods, still include it in response
            resolvedPPKEKs.push({
              ppkek_number: ppkekNumber,
              customs_registration_date: '',
              customs_document_type: '',
              incoming_date: '',
            });
            log.warn('PPKEK not resolved to incoming goods', { ppkekNumber });
          }
        }

        return {
          item_code: outgoingItem.item_code,
          outgoing_good_item_id: outgoingItem.id,
          item_name: outgoingItem.item_name,
          qty: outgoingItem.qty ? Number(outgoingItem.qty.toString()) : 0,
          item_type: outgoingItem.item_type,
          uom: outgoingItem.uom,
          source_type: 'incoming',
          incoming_ppkek_numbers: resolvedPPKEKs,
        };
      }

      // =====================================================================
      // SCENARIO B: PRODUCTION-BASED
      // =====================================================================
      log.info('Using production-based traceability with work order allocations');

      // Get work order allocations for this item
      const allocations = await prisma.outgoing_work_order_allocations.findMany({
        where: {
          outgoing_good_item_id: outgoingItemId,
        },
        orderBy: { work_order_number: 'asc' },
      });

      if (allocations.length === 0) {
        log.warn('No work order allocations found for outgoing item');
        // Return item with empty work orders
        return {
          item_code: outgoingItem.item_code,
          outgoing_good_item_id: outgoingItem.id,
          item_name: outgoingItem.item_name,
          qty: Number(outgoingItem.qty),
          item_type: outgoingItem.item_type,
          uom: outgoingItem.uom,
          source_type: 'production',
          work_orders: [],
        };
      }

      // Build work order details with materials
      const workOrders: TraceabilityWorkOrderDetail[] = [];

      for (const allocation of allocations) {
        // Get materials for this work order from production traceability (for basic info)
        const traceabilityRecords = await prisma.outgoing_fg_production_traceability.findMany({
          where: {
            outgoing_good_item_id: outgoingItemId,
            work_order_number: allocation.work_order_number,
            company_code: companyCode,
          },
          orderBy: [{ material_item_code: 'asc' }],
        });

        // Get unique material codes from traceability records
        const materialCodes = Array.from(
          new Set(
            traceabilityRecords
              .map((r) => r.material_item_code)
              .filter((code): code is string => typeof code === 'string' && code.trim().length > 0)
          )
        );

        // Group materials by material_item_code and collect all PPKEKs with their quantities
        const materialMap = new Map<string, {
          materialName: string;
          consumptionRatio: number;
          ppkeksWithQty: TraceabilityPPKEKWithQty[];
          qtyUom: string;
        }>();

        // First pass: Create entries for all materials from traceability
        for (const record of traceabilityRecords) {
          if (!record.material_item_code) {
            continue;
          }

          if (!materialMap.has(record.material_item_code)) {
            // Get material UOM from material usage items
            const materialUsage = await prisma.material_usage_items.findFirst({
              where: {
                item_code: record.material_item_code,
              },
              select: { uom: true },
            });

            materialMap.set(record.material_item_code, {
              materialName: record.material_item_name || '',
              consumptionRatio: record.consumption_ratio
                ? Number(record.consumption_ratio.toString())
                : 0,
              ppkeksWithQty: [],
              qtyUom: materialUsage?.uom || outgoingItem.uom,
            });
          }
        }

        // Second pass: Get PPKEK data from work_order_material_consumption.
        for (const materialCode of materialCodes) {
          const materialEntry = materialMap.get(materialCode);
          if (!materialEntry) continue;

          const materialTraceRecords = traceabilityRecords.filter(
            (r) => r.material_item_code === materialCode
          );

          const materialTraceRecordWithAllocation = materialTraceRecords.find(
            (r) => r.material_qty_allocated !== null
          );

          // Query work_order_material_consumption for all PPKEK records for this material
          const consumptionRecords = await prisma.work_order_material_consumption.findMany({
            where: {
              work_order_number: allocation.work_order_number,
              item_code: materialCode,
              company_code: companyCode,
              ppkek_number: { not: null }, // Only get records with PPKEK
            },
            orderBy: [{ ppkek_number: 'asc' }],
          });

          const latestConsumptionDate = consumptionRecords.reduce<Date | null>((latest, record) => {
            if (!latest || record.trx_date > latest) {
              return record.trx_date;
            }
            return latest;
          }, null);

          const relevantConsumptionRecords = latestConsumptionDate
            ? consumptionRecords.filter(
                (record) => record.trx_date.getTime() === latestConsumptionDate.getTime()
              )
            : consumptionRecords;

          const consumptionByPPKEK = new Map<string, Prisma.Decimal>();

          for (const consumption of relevantConsumptionRecords) {
            if (!consumption.ppkek_number) continue;

            const existingQty = consumptionByPPKEK.get(consumption.ppkek_number) || new Prisma.Decimal(0);
            const consumedQty = consumption.qty_consumed
              ? new Prisma.Decimal(consumption.qty_consumed.toString())
              : new Prisma.Decimal(0);

            consumptionByPPKEK.set(consumption.ppkek_number, existingQty.add(consumedQty));
          }

          const tracePPKEKNumbers = new Set(
            materialTraceRecords
              .map((record) => record.ppkek_number_incoming)
              .filter((ppkekNumber): ppkekNumber is string =>
                typeof ppkekNumber === 'string' && ppkekNumber.trim().length > 0
              )
          );

          const ppkekCandidates = [];

          // Build the exact PPKEK/registration rows that can be displayed first.
          // The split denominator must come from this same visible row set; using
          // the full WO material consumption can under-allocate visible PPKEKs
          // when some consumption rows are not part of the traceability result.
          for (const [ppkekNumber, ppkekQtyConsumed] of consumptionByPPKEK.entries()) {
            const incomingGood = await prisma.incoming_goods.findFirst({
              where: {
                ppkek_number: ppkekNumber,
                company_code: companyCode,
              },
              orderBy: { incoming_date: 'desc' },
            });

            ppkekCandidates.push({
              ppkekNumber,
              ppkekQtyConsumed,
              incomingGood,
            });
          }

          const traceMatchedCandidates = ppkekCandidates.filter((candidate) =>
            tracePPKEKNumbers.has(candidate.ppkekNumber)
          );
          const incomingMatchedCandidates = ppkekCandidates.filter(
            (candidate) => candidate.incomingGood
          );

          const displayPPKEKRows =
            traceMatchedCandidates.length > 1
              ? traceMatchedCandidates
              : incomingMatchedCandidates.length > 0
                ? incomingMatchedCandidates
                : ppkekCandidates;

          const totalRelevantQtyConsumed = displayPPKEKRows.reduce(
            (sum, candidate) => sum.add(candidate.ppkekQtyConsumed),
            new Prisma.Decimal(0)
          );

          // Process each visible PPKEK to get customs details and displayed allocation.
          for (const candidate of displayPPKEKRows) {
            const exactTraceRecordWithAllocation = materialTraceRecords.find(
              (r) =>
                r.ppkek_number_incoming === candidate.ppkekNumber &&
                r.material_qty_allocated !== null
            );

            const materialAllocatedQty =
              exactTraceRecordWithAllocation?.material_qty_allocated ||
              materialTraceRecordWithAllocation?.material_qty_allocated;

            // Check if PPKEK already added
            const ppkekExists = materialEntry.ppkeksWithQty.some(
              (p) => p.ppkek_number === candidate.ppkekNumber
            );

            if (!ppkekExists) {
              materialEntry.ppkeksWithQty.push({
                ppkek_number: candidate.ppkekNumber,
                customs_registration_date: candidate.incomingGood?.customs_registration_date
                  ? new Date(candidate.incomingGood.customs_registration_date).toISOString().split('T')[0]
                  : '',
                customs_document_type: candidate.incomingGood?.customs_document_type || '',
                incoming_date: candidate.incomingGood?.incoming_date
                  ? new Date(candidate.incomingGood.incoming_date).toISOString().split('T')[0]
                  : '',
                qty_allocated: this.calculateDisplayedAllocatedQty(
                  materialAllocatedQty,
                  candidate.ppkekQtyConsumed,
                  totalRelevantQtyConsumed,
                  displayPPKEKRows.length
                ),
                qty_uom: materialEntry.qtyUom,
              });
            }
          }

          // If no consumption records found in work_order_material_consumption,
          // fallback to outgoing_fg_production_traceability
          if (materialEntry.ppkeksWithQty.length === 0) {
            const traceRecord = traceabilityRecords.find(
              (r) => r.material_item_code === materialCode && r.ppkek_number_incoming
            );

            if (traceRecord?.ppkek_number_incoming) {
              materialEntry.ppkeksWithQty.push({
                ppkek_number: traceRecord.ppkek_number_incoming,
                customs_registration_date: traceRecord.customs_registration_date
                  ? new Date(traceRecord.customs_registration_date).toISOString().split('T')[0]
                  : '',
                customs_document_type: traceRecord.customs_document_type || '',
                incoming_date: traceRecord.incoming_date
                  ? new Date(traceRecord.incoming_date).toISOString().split('T')[0]
                  : '',
                qty_allocated: traceRecord.material_qty_allocated 
                  ? Number(traceRecord.material_qty_allocated.toString())
                  : 0,
                qty_uom: materialEntry.qtyUom,
              });
            }
          }
        }

        const materials: TraceabilityMaterialDetail[] = [];

        for (const [materialCode, { materialName, consumptionRatio, ppkeksWithQty }] of materialMap.entries()) {
          materials.push({
            material_item_code: materialCode,
            material_item_name: materialName,
            consumption_ratio: consumptionRatio,
            ppkeks: ppkeksWithQty.length > 0 ? ppkeksWithQty : undefined,
          });
        }

        workOrders.push({
          work_order_number: allocation.work_order_number,
          qty_per_wo: allocation.qty ? Number(allocation.qty.toString()) : 0,
          materials,
        });
      }

      const result: TraceabilityItem = {
        item_code: outgoingItem.item_code,
        outgoing_good_item_id: outgoingItem.id,
        item_name: outgoingItem.item_name,
        qty: outgoingItem.qty ? Number(outgoingItem.qty.toString()) : 0,
        item_type: outgoingItem.item_type,
        uom: outgoingItem.uom,
        source_type: 'production',
        work_orders: workOrders,
      };

      log.info('Production traceability retrieved', {
        workOrderCount: workOrders.length,
        materialCount: workOrders.reduce((sum, wo) => sum + wo.materials.length, 0),
      });

      return result;
    } catch (error) {
      log.error('Failed to get traceability data', { error });
      throw error;
    }
  }

  /**
   * Get traceability data for multiple outgoing items
   */
  async getTraceabilityByOutgoingItemIds(
    outgoingItemIds: number[],
    companyCode: number
  ): Promise<TraceabilityItem[]> {
    const log = logger.child({
      scope: 'TraceabilityRepository.getTraceabilityByOutgoingItemIds',
      count: outgoingItemIds.length,
      companyCode,
    });

    try {
      const results: TraceabilityItem[] = [];

      for (const itemId of outgoingItemIds) {
        const traceability = await this.getTraceabilityByOutgoingItem(itemId, companyCode);
        if (traceability) {
          results.push(traceability);
        }
      }

      log.info('Batch traceability data retrieved', { resultCount: results.length });
      return results;
    } catch (error) {
      log.error('Failed to get batch traceability data', { error });
      throw error;
    }
  }
}

export const traceabilityRepository = new TraceabilityRepository();
