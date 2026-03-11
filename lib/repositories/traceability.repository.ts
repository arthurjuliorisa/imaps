import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';

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

// ============================================================================
// LEVEL 3: MATERIALS (Production-Based Only)
// ============================================================================

export interface TraceabilityMaterialDetail {
  material_item_code: string;
  material_item_name: string;
  consumption_ratio: number; // component_demand_qty / planned_production_qty
  material_qty_allocated: number; // qty_per_wo × consumption_ratio
  qty_uom: string; // Material unit of measure
  ppkek?: TraceabilityPPKEKDetail | null; // Resolved PPKEK if available
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

/**
 * Traceability Repository
 * Handles fetching and enriching traceability data from multiple sources
 */
export class TraceabilityRepository {
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
              ppkek_number: incomingGood.ppkek_number,
              customs_registration_date: incomingGood.customs_registration_date
                ? new Date(incomingGood.customs_registration_date).toISOString().split('T')[0]
                : '',
              customs_document_type: incomingGood.customs_document_type || '',
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
          item_name: outgoingItem.item_name,
          qty: Number(outgoingItem.qty),
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
        // Get materials for this work order allocation
        const traceabilityRecords = await prisma.outgoing_fg_production_traceability.findMany({
          where: {
            outgoing_good_item_id: outgoingItemId,
            work_order_number: allocation.work_order_number,
            company_code: companyCode,
          },
          orderBy: [{ material_item_code: 'asc' }],
        });

        // Group materials by material_item_code to avoid duplicates
        const materialMap = new Map<string, typeof traceabilityRecords[0]>();
        for (const record of traceabilityRecords) {
          if (record.material_item_code) {
            if (!materialMap.has(record.material_item_code)) {
              materialMap.set(record.material_item_code, record);
            }
          }
        }

        const materials: TraceabilityMaterialDetail[] = [];

        for (const record of materialMap.values()) {
          let ppkekDetail: TraceabilityPPKEKDetail | null = null;

          // Resolve PPKEK if available
          if (record.ppkek_number_incoming) {
            ppkekDetail = {
              ppkek_number: record.ppkek_number_incoming,
              customs_registration_date: record.customs_registration_date
                ? new Date(record.customs_registration_date).toISOString().split('T')[0]
                : '',
              customs_document_type: record.customs_document_type || '',
              incoming_date: record.incoming_date
                ? new Date(record.incoming_date).toISOString().split('T')[0]
                : '',
            };
          }

          // Only process if we have material_item_code
          if (!record.material_item_code) {
            continue;
          }

          // Get material UOM from material usage items
          const materialUsage = await prisma.material_usage_items.findFirst({
            where: {
              item_code: record.material_item_code,
            },
            select: { uom: true },
          });

          materials.push({
            material_item_code: record.material_item_code,
            material_item_name: record.material_item_name || '',
            consumption_ratio: Number(record.consumption_ratio || 0),
            material_qty_allocated: Number(record.material_qty_allocated || 0),
            qty_uom: materialUsage?.uom || outgoingItem.uom,
            ppkek: ppkekDetail,
          });
        }

        workOrders.push({
          work_order_number: allocation.work_order_number,
          qty_per_wo: Number(allocation.qty),
          materials,
        });
      }

      const result: TraceabilityItem = {
        item_code: outgoingItem.item_code,
        item_name: outgoingItem.item_name,
        qty: Number(outgoingItem.qty),
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
