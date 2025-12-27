import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';

/**
 * Traceability Data Structure - Supports 2 scenarios:
 * 1. Production-based: Outgoing Item -> Production Output -> Work Order -> Material Usage -> Materials (ROH/HALB)
 * 2. Incoming-based: Outgoing Item -> Direct incoming_ppkek_numbers array
 */
export interface TraceabilityItem {
  item_code: string;
  item_name: string;
  qty: number; // Total qty from outgoing goods item
  source_type: 'production' | 'incoming'; // Which source of traceability
  work_orders: TraceabilityWorkOrder[]; // For production-based
  incoming_ppkek_numbers: string[]; // For incoming-based (direct PPKEK list)
}

export interface TraceabilityWorkOrder {
  work_order_number: string;
  materials: TraceabilityMaterial[]; // ROH/HALB materials consumed in this work order
}

export interface TraceabilityMaterial {
  item_code: string; // Material item code (ROH/HALB)
  item_name: string; // Material item name
  registration_number: string; // PPKEK/Registration number for this material
}

/**
 * Traceability Repository
 * Handles database operations for traceability queries
 */
export class TraceabilityRepository {
  /**
   * Get traceability data for an outgoing goods item
   * Supports 2 sources:
   * 1. Incoming-based: If incoming_ppkek_numbers is set, use it directly
   * 2. Production-based: Otherwise, trace from production output → work order → materials
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
      const incomingPPKEKArray = outgoingItem.incoming_ppkek_numbers || [];
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

      // SCENARIO A: Production-based - trace from production output
      log.info('Using production-based traceability');

      // Step 3: Get production outputs linked to this outgoing item
      // From outgoing_fg_production_traceability
      const productionTraces = await prisma.outgoing_fg_production_traceability.findMany({
        where: {
          outgoing_good_item_id: outgoingItemId,
          company_code: companyCode,
        },
        select: {
          production_wms_id: true,
        },
      });

      if (productionTraces.length === 0) {
        log.info('No production traces found for outgoing item');
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

      // Step 3: Get work orders from production outputs
      const productionWmsIds = [...new Set(productionTraces.map((t) => t.production_wms_id))];

      const productionData = await prisma.work_order_fg_production.findMany({
        where: {
          production_wms_id: {
            in: productionWmsIds,
          },
          company_code: companyCode,
          item_code: outgoingItem.item_code,
        },
        select: {
          work_order_number: true,
        },
      });

      if (productionData.length === 0) {
        return {
          item_code: outgoingItem.item_code,
          item_name: outgoingItem.item_name,
          qty: Number(outgoingItem.qty),
          work_orders: [],
        };
      }

      // Step 4: Get material consumption and ROH/HALB materials for each work order
      const workOrderNumbers = [...new Set(productionData.map((p) => p.work_order_number))];

      // Get material consumption records with linked material_usage_items (ROH/HALB)
      const materialConsumption = await prisma.work_order_material_consumption.findMany({
        where: {
          work_order_number: {
            in: workOrderNumbers,
          },
          company_code: companyCode,
        },
        select: {
          work_order_number: true,
          material_usage_id: true,
          material_usage: {
            select: {
              items: {
                select: {
                  item_code: true,
                  item_name: true,
                  ppkek_number: true,
                  item_type: true,
                },
                where: {
                  deleted_at: null,
                },
              },
            },
          },
        },
      });

      // Step 5: Group materials by work order
      const materialsByWorkOrder = new Map<string, TraceabilityMaterial[]>();

      materialConsumption.forEach((consumption) => {
        const woNumber = consumption.work_order_number;
        if (!materialsByWorkOrder.has(woNumber)) {
          materialsByWorkOrder.set(woNumber, []);
        }

        // Add each material from material_usage_items
        if (consumption.material_usage?.items && consumption.material_usage.items.length > 0) {
          consumption.material_usage.items.forEach((materialItem) => {
            // Only include ROH/HALB materials (item_type like ROH, HALB, HIBE)
            const isRawOrHalf =
              materialItem.item_type === 'ROH' ||
              materialItem.item_type === 'HALB' ||
              materialItem.item_type?.startsWith('HIBE');

            if (isRawOrHalf) {
              materialsByWorkOrder.get(woNumber)!.push({
                item_code: materialItem.item_code,
                item_name: materialItem.item_name,
                registration_number: materialItem.ppkek_number || '',
              });
            }
          });
        }
      });

      // Step 6: Build response with work orders and materials
      const workOrders: TraceabilityWorkOrder[] = workOrderNumbers
        .map((woNumber) => ({
          work_order_number: woNumber,
          materials: materialsByWorkOrder.get(woNumber) || [],
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

      log.info('Traceability data retrieved', {
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
