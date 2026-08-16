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

/**
 * Traceability Repository
 * Handles fetching and enriching traceability data from multiple sources
 */
export class TraceabilityRepository {
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
