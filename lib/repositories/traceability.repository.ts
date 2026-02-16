import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';

/**
 * NEW Traceability Data Structure - 4-Level Hierarchy
 * Item → Work Order → Material → PPKEK/Incoming Goods
 * 
 * Supports 2 scenarios:
 * 1. Production-based: Outgoing Item → Production Output → Work Order → Material Usage → Materials → PPKEK
 * 2. Incoming-based: Outgoing Item → Direct incoming_ppkek_numbers array
 */

export interface TraceabilityPPKEK {
  ppkek_number: string;
  customs_registration_date: string; // Date in YYYY-MM-DD format
  customs_document_type: string; // BC23, BC27, etc.
  incoming_date: string; // Date in YYYY-MM-DD format
}

export interface TraceabilityMaterial {
  material_item_code: string; // Material code (ROH/HALB)
  material_item_name: string; // Material name
  material_qty_allocated: number; // Calculated qty: qty_per_wo × consumption_ratio
  consumption_ratio: number; // Ratio: component_demand_qty / planned_production_qty
  ppkek: TraceabilityPPKEK | null; // Resolved PPKEK to incoming goods
}

export interface TraceabilityWorkOrder {
  work_order_number: string;
  materials: TraceabilityMaterial[]; // Detailed materials with PPKEK
}

export interface TraceabilityItem {
  item_code: string;
  item_name: string;
  qty: number; // Total qty from outgoing goods item
  source_type: 'production' | 'incoming'; // Which source of traceability
  work_orders: TraceabilityWorkOrder[]; // For production-based detailed traceability
  incoming_ppkek_numbers: string[]; // For incoming-based (direct PPKEK list)
}

/**
 * Traceability Repository
 * Handles database operations for traceability queries with enriched BOM details
 */
export class TraceabilityRepository {
  /**
   * Get enriched traceability data for an outgoing goods item
   * Returns hierarchical 4-level structure: Item → Work Order → Material → PPKEK
   * 
   * Supports 2 sources:
   * 1. Incoming-based: If incoming_ppkek_numbers is set, use it directly
   * 2. Production-based: Trace from outgoing_fg_production_traceability (denormalized data)
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
      // Step 1: Get outgoing item with incoming_ppkek_numbers
      const outgoingItem = await prisma.outgoing_good_items.findUnique({
        where: { id: outgoingItemId },
      });

      if (!outgoingItem) {
        log.warn('Outgoing item not found');
        return null;
      }

      // Step 2: Check if incoming_ppkek_numbers is present (incoming-based scenario)
      const incomingPPKEKArray = (outgoingItem as any).incoming_ppkek_numbers || [];
      const hasIncomingPPKEK =
        Array.isArray(incomingPPKEKArray) && incomingPPKEKArray.length > 0;

      if (hasIncomingPPKEK) {
        // SCENARIO B: Incoming-based - return PPKEK array directly
        log.info('Using incoming-based traceability', {
          ppkekCount: incomingPPKEKArray.length,
        });

        return {
          item_code: outgoingItem.item_code,
          item_name: outgoingItem.item_name,
          qty: Number(outgoingItem.qty),
          source_type: 'incoming',
          incoming_ppkek_numbers: incomingPPKEKArray,
          work_orders: [],
        };
      }

      // SCENARIO A: Production-based - trace from outgoing_fg_production_traceability (enriched data)
      log.info('Using production-based traceability with BOM enrichment');

      // Step 3: Get all enriched traceability records for this outgoing item
      const traceabilityRecords = await prisma.outgoing_fg_production_traceability.findMany({
        where: {
          outgoing_good_item_id: outgoingItemId,
          company_code: companyCode,
        },
        select: {
          work_order_number: true,
          material_item_code: true,
          material_item_name: true,
          material_qty_allocated: true,
          consumption_ratio: true,
          ppkek_number_incoming: true,
          customs_registration_date: true,
          customs_document_type: true,
          incoming_date: true,
        },
        orderBy: [
          { work_order_number: 'asc' },
          { material_item_code: 'asc' },
        ],
      });

      if (traceabilityRecords.length === 0) {
        log.info('No enriched production traces found for outgoing item');
        // Return item without work orders
        return {
          item_code: outgoingItem.item_code,
          item_name: outgoingItem.item_name,
          qty: Number(outgoingItem.qty),
          source_type: 'production',
          work_orders: [],
          incoming_ppkek_numbers: [],
        };
      }

      // Step 4: Group by work order, then by material
      const workOrdersMap = new Map<
        string,
        {
          work_order_number: string;
          materials: Map<
            string,
            {
              material_item_code: string;
              material_item_name: string;
              material_qty_allocated: number;
              consumption_ratio: number;
              ppkek: TraceabilityPPKEK | null;
            }
          >;
        }
      >();

      for (const record of traceabilityRecords) {
        const woNumber = record.work_order_number || 'UNKNOWN';

        if (!workOrdersMap.has(woNumber)) {
          workOrdersMap.set(woNumber, {
            work_order_number: woNumber,
            materials: new Map(),
          });
        }

        // Only add material if we have material_item_code
        if (record.material_item_code) {
          const materialKey = record.material_item_code;
          const woEntry = workOrdersMap.get(woNumber)!;

          if (!woEntry.materials.has(materialKey)) {
            const ppkek: TraceabilityPPKEK | null = record.ppkek_number_incoming
              ? {
                  ppkek_number: record.ppkek_number_incoming,
                  customs_registration_date: record.customs_registration_date
                    ? new Date(record.customs_registration_date).toISOString().split('T')[0]
                    : '',
                  customs_document_type: record.customs_document_type || '',
                  incoming_date: record.incoming_date
                    ? new Date(record.incoming_date).toISOString().split('T')[0]
                    : '',
                }
              : null;

            woEntry.materials.set(materialKey, {
              material_item_code: record.material_item_code,
              material_item_name: record.material_item_name || '',
              material_qty_allocated: Number(record.material_qty_allocated || 0),
              consumption_ratio: Number(record.consumption_ratio || 0),
              ppkek,
            });
          }
        }
      }

      // Step 5: Build response structure
      const workOrders: TraceabilityWorkOrder[] = Array.from(workOrdersMap.values())
        .map((wo) => ({
          work_order_number: wo.work_order_number,
          materials: Array.from(wo.materials.values()),
        }))
        .filter((wo) => wo.materials.length > 0) // Only include WO with materials
        .sort((a, b) => a.work_order_number.localeCompare(b.work_order_number));

      const result: TraceabilityItem = {
        item_code: outgoingItem.item_code,
        item_name: outgoingItem.item_name,
        qty: Number(outgoingItem.qty),
        source_type: 'production',
        work_orders: workOrders,
        incoming_ppkek_numbers: [],
      };

      log.info('Enriched traceability data retrieved', {
        sourceType: 'production',
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
