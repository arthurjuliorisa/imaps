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
          new Set(traceabilityRecords.map((r) => r.material_item_code).filter(Boolean))
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

        // Second pass: Get PPKEK data from work_order_material_consumption (source of truth)
        for (const materialCode of materialCodes) {
          const materialEntry = materialMap.get(materialCode);
          if (!materialEntry) continue;

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

          // Process each consumption record to get PPKEK details
          for (const consumption of consumptionRecords) {
            if (!consumption.ppkek_number) continue;

            // Check if PPKEK already added
            const ppkekExists = materialEntry.ppkeksWithQty.some(
              (p) => p.ppkek_number === consumption.ppkek_number
            );

            if (!ppkekExists) {
              // Query incoming_goods to get customs details
              const incomingGood = await prisma.incoming_goods.findFirst({
                where: {
                  ppkek_number: consumption.ppkek_number,
                  company_code: companyCode,
                },
                orderBy: { incoming_date: 'desc' },
              });

              materialEntry.ppkeksWithQty.push({
                ppkek_number: consumption.ppkek_number,
                customs_registration_date: incomingGood?.customs_registration_date
                  ? new Date(incomingGood.customs_registration_date).toISOString().split('T')[0]
                  : '',
                customs_document_type: incomingGood?.customs_document_type || '',
                incoming_date: incomingGood?.incoming_date
                  ? new Date(incomingGood.incoming_date).toISOString().split('T')[0]
                  : '',
                qty_allocated: consumption.qty_consumed 
                  ? Number(consumption.qty_consumed.toString())
                  : 0,
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
