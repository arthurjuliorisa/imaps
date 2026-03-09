import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';

/**
 * Interface for a single material allocation record
 */
export interface MaterialAllocation {
  work_order_number: string;
  material_item_code: string;
  material_item_name: string;
  material_qty_allocated: Prisma.Decimal;
  consumption_ratio: Prisma.Decimal;
  component_demand_qty: Prisma.Decimal;
  planned_production_qty: Prisma.Decimal | null;
}

/**
 * Interface for BOM calculation result
 */
export interface BOMCalculationResult {
  work_order_number: string;
  identify_product: string | null;
  allocations: MaterialAllocation[];
  calculation_status: 'success' | 'identified_product_n' | 'not_found' | 'error';
  error_message?: string;
}

/**
 * BOM Calculation Service
 * 
 * Calculates material allocation for exported Finished Goods based on:
 * - Latest Material Usage transmission for the work order
 * - Production Output planned quantity and identify_product flag
 * - Quantity of FG exported (from outgoing goods)
 * 
 * Formula:
 * Consumption Ratio = Component Demand Qty / Planned Production Qty
 * Material Allocated = Qty FG Exported × Consumption Ratio
 * 
 * Rules:
 * 1. Only the LATEST material usage transmission is used
 * 2. If identify_product = 'N': Consumption Ratio = 0 (no allocation)
 * 3. If identify_product = 'Y': Normal calculation
 */
export class BOMCalculationService {
  private logger = logger.child({
    service: 'BOMCalculationService',
  });

  /**
   * Calculate BOM allocations for a work order when FG is exported
   * 
   * @param workOrderNumber - Work order number to calculate for
   * @param fgItemCode - Finished good item code being exported
   * @param qtyFGExported - Quantity of FG being exported (as string for precision)
   * @param companyCode - Company code for filtering
   * @returns BOMCalculationResult with allocations or error status
   */
  async calculateBOM(
    workOrderNumber: string,
    fgItemCode: string,
    qtyFGExported: string | number | Prisma.Decimal,
    companyCode: number
  ): Promise<BOMCalculationResult> {
    const calculationLogger = this.logger.child({
      method: 'calculateBOM',
      workOrderNumber,
      fgItemCode,
    });

    try {
      const qtyFG = new Prisma.Decimal(qtyFGExported.toString());

      // ========================================================================
      // STEP 1: Get Production Output Item (for identify_product flag & planned qty)
      // ========================================================================
      const productionOutputItem = await prisma.production_output_items.findFirst({
        where: {
          item_code: fgItemCode,
          work_order_number: workOrderNumber,
        },
        select: {
          planned_production_qty: true,
          identify_product: true,
        },
        orderBy: { production_output_date: 'desc' },
      });

      if (!productionOutputItem) {
        calculationLogger.warn('Production output item not found', { fgItemCode, workOrderNumber });
        return {
          work_order_number: workOrderNumber,
          identify_product: null,
          allocations: [],
          calculation_status: 'not_found',
          error_message: `Production output not found for work order ${workOrderNumber} and item ${fgItemCode}`,
        };
      }

      // ========================================================================
      // STEP 2: Check identify_product Flag
      // ========================================================================
      // Flag to indicate if consumption should be zero (identified_product != 'Y')
      const useZeroConsumption = productionOutputItem.identify_product !== 'Y';
      
      if (useZeroConsumption) {
        calculationLogger.debug('identify_product is not Y, will fetch materials but set consumption ratio to zero', {
          identify_product: productionOutputItem.identify_product,
        });
      }

      // For zero consumption case, we still need planned_production_qty to fetch materials
      // But it's not used in calculation
      // For normal case, we need it for ratio calculation
      if (productionOutputItem.identify_product === 'Y' && !productionOutputItem.planned_production_qty) {
        calculationLogger.warn('Planned production qty is NULL, cannot calculate ratio');
        return {
          work_order_number: workOrderNumber,
          identify_product: productionOutputItem.identify_product,
          allocations: [],
          calculation_status: 'error',
          error_message: 'Planned production quantity is NULL, cannot calculate consumption ratio',
        };
      }

      // ========================================================================
      // STEP 3: Get Latest Material Usage for Work Order
      // ========================================================================
      // Query: First get the latest transmission date
      const latestDateResult = await prisma.$queryRaw<any[]>`
        SELECT DISTINCT mu.transaction_date
        FROM material_usages mu
        WHERE mu.work_order_number = ${workOrderNumber}
          AND mu.company_code = ${companyCode}
          AND mu.deleted_at IS NULL
        ORDER BY mu.transaction_date DESC
        LIMIT 1
      `;

      if (!latestDateResult || latestDateResult.length === 0) {
        calculationLogger.warn('No material usage found for work order', {
          workOrderNumber,
          companyCode,
        });
        return {
          work_order_number: workOrderNumber,
          identify_product: productionOutputItem.identify_product,
          allocations: [],
          calculation_status: 'not_found',
          error_message: `No material usage found for work order ${workOrderNumber}`,
        };
      }

      const latestDate = latestDateResult[0].transaction_date;

      // Convert Date to YYYY-MM-DD string to match DATABASE DATE column format
      // This ensures proper comparison without timezone issues
      const latestDateStr = new Date(latestDate).toISOString().split('T')[0];

      calculationLogger.debug('Using latest material usage transmission', {
        latestDate: latestDate.toString(),
        latestDateStr, // Use this string for SQL query
      });

      // Now get all materials from this latest transmission date only
      // Note: May include multiple wms_ids if they share same transaction_date
      const materialUsagesRaw = await prisma.$queryRaw<any[]>`
        SELECT 
          mui.id,
          mui.item_code,
          mui.item_name,
          mui.component_demand_qty,
          mui.ppkek_number,
          mu.work_order_number,
          mu.transaction_date,
          mu.wms_id
        FROM material_usage_items mui
        JOIN material_usages mu ON 
          mui.material_usage_id = mu.id 
          AND mui.material_usage_company = mu.company_code 
          AND mui.material_usage_date = mu.transaction_date
        WHERE mu.work_order_number = ${workOrderNumber}
          AND mu.company_code = ${companyCode}
          AND mu.transaction_date = ${latestDateStr}::date
          AND mui.item_type IN ('ROH', 'HALB')
          AND mui.component_demand_qty IS NOT NULL
          AND mui.deleted_at IS NULL
          AND mu.deleted_at IS NULL
        ORDER BY mu.wms_id, mui.item_code
      `;

      if (!materialUsagesRaw || materialUsagesRaw.length === 0) {
        calculationLogger.warn('No material usage items found for latest transmission', {
          workOrderNumber,
          companyCode,
          latestDate,
        });
        return {
          work_order_number: workOrderNumber,
          identify_product: productionOutputItem.identify_product,
          allocations: [],
          calculation_status: 'not_found',
          error_message: `No material usage items found for work order ${workOrderNumber}`,
        };
      }

      calculationLogger.debug('Retrieved material usage items from latest transmission', {
        itemCount: materialUsagesRaw.length,
        items: materialUsagesRaw.map(m => ({ item_code: m.item_code, wms_id: m.wms_id })),
      });

      // Get the latest transmission items (all rows are from the same transmission date)
      const latestTransmissionItems = materialUsagesRaw;

      // ========================================================================
      // STEP 4: Consolidate Materials with Same Item Code
      // ========================================================================
      // If same material appears multiple times in the transmission (from different BOM lines or wms_ids),
      // consolidate by summing component_demand_qty
      const consolidatedMaterials = new Map<string, any>();

      for (const material of latestTransmissionItems) {
        const key = material.item_code;
        
        if (consolidatedMaterials.has(key)) {
          // Material already exists, sum component_demand_qty
          const existing = consolidatedMaterials.get(key);
          const currentQty = new Prisma.Decimal(existing.component_demand_qty.toString());
          const addQty = new Prisma.Decimal(material.component_demand_qty.toString());
          existing.component_demand_qty = currentQty.plus(addQty);
          
          calculationLogger.debug('Consolidated duplicate material from transmission', {
            materialItemCode: key,
            addedComponentDemandQty: addQty.toString(),
            newComponentDemandQty: existing.component_demand_qty.toString(),
            fromWmsId: material.wms_id,
          });
        } else {
          // First occurrence, add to map
          consolidatedMaterials.set(key, {
            item_code: material.item_code,
            item_name: material.item_name,
            component_demand_qty: new Prisma.Decimal(material.component_demand_qty.toString()),
            ppkek_number: material.ppkek_number,
          });
          
          calculationLogger.debug('Added new material to consolidation map', {
            materialItemCode: key,
            componentDemandQty: material.component_demand_qty.toString(),
            fromWmsId: material.wms_id,
          });
        }
      }

      calculationLogger.debug('Material consolidation complete', {
        originalItemCount: materialUsagesRaw.length,
        consolidatedItemCount: consolidatedMaterials.size,
      });

      // ========================================================================
      // STEP 5: Calculate Allocations for Each Consolidated Material
      // ========================================================================
      const allocations: MaterialAllocation[] = [];

      for (const material of consolidatedMaterials.values()) {
        const componentDemandQty = material.component_demand_qty;
        const plannedProdQty = productionOutputItem.planned_production_qty 
          ? new Prisma.Decimal(productionOutputItem.planned_production_qty.toString())
          : new Prisma.Decimal(1); // Default to 1 to avoid division by zero for zero consumption case

        // Verify we can do the calculation
        if (componentDemandQty.isZero()) {
          calculationLogger.debug('Component demand qty is 0, allocation will be 0', {
            materialItemCode: material.item_code,
          });
        }

        // Calculate consumption ratio
        // If identify_product = 'N', ratio = 0 (zero consumption)
        // If identify_product = 'Y', ratio = component_demand_qty / planned_production_qty
        const consumptionRatio = useZeroConsumption 
          ? new Prisma.Decimal(0)
          : componentDemandQty.dividedBy(plannedProdQty);

        // Calculate allocated qty = qty_fg_exported × consumption_ratio
        // If identify_product = 'N', this will be 0
        const allocatedQty = qtyFG.mul(consumptionRatio);

        allocations.push({
          work_order_number: workOrderNumber,
          material_item_code: material.item_code,
          material_item_name: material.item_name,
          material_qty_allocated: allocatedQty,
          consumption_ratio: consumptionRatio,
          component_demand_qty: componentDemandQty,
          planned_production_qty: plannedProdQty,
        });

        calculationLogger.debug('Calculated allocation for material', {
          materialItemCode: material.item_code,
          consolidatedComponentDemandQty: componentDemandQty.toString(),
          plannedProdQty: plannedProdQty.toString(),
          consumptionRatio: consumptionRatio.toString(),
          qtyFGExported: qtyFG.toString(),
          allocatedQty: allocatedQty.toString(),
          identifiedProductFlag: productionOutputItem.identify_product,
        });
      }

      calculationLogger.info('BOM calculation completed', {
        allocationCount: allocations.length,
        identifiedProduct: productionOutputItem.identify_product,
        totalAllocated: allocations
          .reduce((sum, a) => sum.add(a.material_qty_allocated), new Prisma.Decimal(0))
          .toString(),
      });

      return {
        work_order_number: workOrderNumber,
        identify_product: productionOutputItem.identify_product,
        allocations,
        calculation_status: useZeroConsumption ? 'identified_product_n' : 'success',
      };
    } catch (error) {
      calculationLogger.error('Error calculating BOM', { error });
      return {
        work_order_number: workOrderNumber,
        identify_product: null,
        allocations: [],
        calculation_status: 'error',
        error_message: `BOM calculation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Batch calculate BOM for multiple work orders
   * Useful for complex outgoing goods with multiple work order allocations
   * 
   * @param workOrders - Array of {workOrderNumber, fgItemCode, qtyExported}
   * @param companyCode - Company code
   * @returns Array of BOM calculation results
   */
  async calculateBOMBatch(
    workOrders: Array<{
      workOrderNumber: string;
      fgItemCode: string;
      qtyExported: string | number | Prisma.Decimal;
    }>,
    companyCode: number
  ): Promise<BOMCalculationResult[]> {
    const batchLogger = this.logger.child({
      method: 'calculateBOMBatch',
      itemCount: workOrders.length,
    });

    batchLogger.info('Starting batch BOM calculation', { itemCount: workOrders.length });

    const results = await Promise.all(
      workOrders.map(item =>
        this.calculateBOM(item.workOrderNumber, item.fgItemCode, item.qtyExported, companyCode)
      )
    );

    const successCount = results.filter(r => r.calculation_status === 'success').length;
    const failureCount = results.filter(r => r.calculation_status === 'error').length;

    batchLogger.info('Batch BOM calculation completed', {
      total: results.length,
      success: successCount,
      failed: failureCount,
      skipped: results.length - successCount - failureCount,
    });

    return results;
  }

  /**
   * Validate BOM Calculation Requirements
   * Use this before attempting calculation to fail fast
   * 
   * @param workOrderNumber - Work order to validate
   * @param fgItemCode - FG item code
   * @param companyCode - Company code
   * @returns {isValid: boolean, errors: string[]}
   */
  async validateBOMPrerequisites(
    workOrderNumber: string,
    fgItemCode: string,
    companyCode: number
  ): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    const validationLogger = this.logger.child({
      method: 'validateBOMPrerequisites',
      workOrderNumber,
      fgItemCode,
    });

    try {
      // 1. Check production output exists
      const prodOutput = await prisma.production_output_items.findFirst({
        where: {
          item_code: fgItemCode,
          work_order_number: workOrderNumber,
        },
      });

      if (!prodOutput) {
        errors.push(
          `Production output not found for work order ${workOrderNumber} and item ${fgItemCode}`
        );
      } else {
        // 2. Check planned_production_qty is not null
        if (!prodOutput.planned_production_qty) {
          errors.push('Planned production quantity is NULL');
        }

        // 3. Check identify_product flag
        if (prodOutput.identify_product !== 'Y') {
          validationLogger.debug('identify_product flag is not Y, allocation will be skipped', {
            identify_product: prodOutput.identify_product,
          });
        }
      }

      // 4. Check material usage exists
      const materialUsage = await prisma.$queryRaw<any[]>`
        SELECT COUNT(*) as count
        FROM material_usage_items mui
        JOIN material_usages mu ON 
          mui.material_usage_id = mu.id 
          AND mui.material_usage_company = mu.company_code 
          AND mui.material_usage_date = mu.transaction_date
        WHERE mu.work_order_number = ${workOrderNumber}
          AND mu.company_code = ${companyCode}
          AND mui.component_demand_qty IS NOT NULL
          AND mui.deleted_at IS NULL
      `;

      if (materialUsage && materialUsage[0] && materialUsage[0].count === '0') {
        errors.push(`No material usage found for work order ${workOrderNumber}`);
      }

      validationLogger.debug('Validation result', {
        isValid: errors.length === 0,
        errorCount: errors.length,
      });

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      validationLogger.error('Error validating prerequisites', { error });
      errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        isValid: false,
        errors,
      };
    }
  }
}

// Export singleton instance
export const bomCalculationService = new BOMCalculationService();
