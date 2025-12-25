import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';

/**
 * Traceability Data Structure
 * Maps the flow: Outgoing Item -> Production Output -> Work Order -> PPKEK
 */
export interface TraceabilityItem {
  item_code: string;
  item_name: string;
  qty: number; // Total qty from outgoing goods item
  work_orders: TraceabilityWorkOrder[];
}

export interface TraceabilityWorkOrder {
  work_order_number: string;
  ppkek_numbers: string[]; // Array of unique PPKEK numbers for this WO
}

/**
 * Traceability Repository
 * Handles database operations for traceability queries
 */
export class TraceabilityRepository {
  /**
   * Get traceability data for an outgoing goods item
   * Flow: outgoing_good_items -> outgoing_fg_production_traceability -> production_output_items
   *        -> work_order_fg_production -> work_order_material_consumption
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
      // Step 1: Get outgoing item
      const outgoingItem = await prisma.outgoing_good_items.findUnique({
        where: { id: outgoingItemId },
      });

      if (!outgoingItem) {
        log.warn('Outgoing item not found');
        return null;
      }

      // Step 2: Get production outputs linked to this outgoing item
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
          work_orders: [],
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

      // Step 4: Get PPKEK numbers for each work order
      const workOrderNumbers = [...new Set(productionData.map((p) => p.work_order_number))];

      const ppkekData = await prisma.work_order_material_consumption.findMany({
        where: {
          work_order_number: {
            in: workOrderNumbers,
          },
          company_code: companyCode,
          ppkek_number: {
            not: null,
          },
        },
        select: {
          work_order_number: true,
          ppkek_number: true,
        },
      });

      // Step 5: Group PPKEK by work order
      const ppkekByWorkOrder = new Map<string, Set<string>>();

      ppkekData.forEach((item) => {
        if (!ppkekByWorkOrder.has(item.work_order_number)) {
          ppkekByWorkOrder.set(item.work_order_number, new Set());
        }
        if (item.ppkek_number) {
          ppkekByWorkOrder.get(item.work_order_number)!.add(item.ppkek_number);
        }
      });

      // Step 6: Build response
      const workOrders: TraceabilityWorkOrder[] = workOrderNumbers.map((woNumber) => ({
        work_order_number: woNumber,
        ppkek_numbers: Array.from(ppkekByWorkOrder.get(woNumber) || new Set<string>()).sort(),
      }));

      const result: TraceabilityItem = {
        item_code: outgoingItem.item_code,
        item_name: outgoingItem.item_name,
        qty: Number(outgoingItem.qty),
        work_orders: workOrders.sort((a, b) =>
          a.work_order_number.localeCompare(b.work_order_number)
        ),
      };

      log.info('Traceability data retrieved', {
        workOrderCount: workOrders.length,
        ppkekCount: ppkekData.length,
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
      const traceabilityResults = await Promise.all(
        outgoingItemIds.map((itemId) =>
          this.getTraceabilityByOutgoingItem(itemId, companyCode)
        )
      );

      const results: TraceabilityItem[] = traceabilityResults.filter(
        (traceability): traceability is TraceabilityItem => traceability !== null
      );

      log.info('Batch traceability data retrieved', { resultCount: results.length });
      return results;
    } catch (error) {
      log.error('Failed to get batch traceability data', { error });
      throw error;
    }
  }
}

export const traceabilityRepository = new TraceabilityRepository();
