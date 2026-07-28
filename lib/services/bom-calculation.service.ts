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
  material_uom: string;
  material_qty_allocated: Prisma.Decimal;
  consumption_ratio: Prisma.Decimal;
  component_demand_qty: Prisma.Decimal;
  planned_production_qty: Prisma.Decimal | null;
  detail_rows: MaterialAllocationDetail[];
}

export interface MaterialAllocationDetail {
  source_material_usage_item_id: number;
  source_material_usage_wms_id: string;
  trace_row_type: 'NORMAL' | 'REVERSAL';
  display_ppkek_number: string | null;
  ppkek_bucket_key: string;
  actual_qty: Prisma.Decimal;
  signed_qty: Prisma.Decimal;
  material_net_usage_total: Prisma.Decimal;
  raw_allocated_qty: Prisma.Decimal;
  final_allocated_qty: Prisma.Decimal;
  rounding_adjustment: Prisma.Decimal;
  material_uom: string;
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

type ConsolidatedMaterial = {
  item_code: string;
  item_name: string;
  uom: string;
  component_demand_qty: Prisma.Decimal;
  detail_rows: SourceMaterialUsageRow[];
};

type SourceMaterialUsageRow = {
  id: number;
  item_code: string;
  item_name: string;
  uom: string;
  qty: Prisma.Decimal;
  component_demand_qty: Prisma.Decimal | null;
  ppkek_number: string | null;
  work_order_number: string;
  transaction_date: Date;
  timestamp: Date;
  wms_id: string;
  reversal: string | null;
};

export function classifyPPKEK(ppkek: string | null | undefined): { display: string | null; bucket: string } {
  const value = ppkek?.trim();

  if (!value) {
    return { display: null, bucket: 'BLANK' };
  }

  if (value === 'N') {
    return { display: 'N', bucket: 'LITERAL_N' };
  }

  return { display: value, bucket: `PPKEK:${value}` };
}

export function roundToScale(value: Prisma.Decimal, scale: number): Prisma.Decimal {
  return value.toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}

function compareDetailRowsForResidual(a: MaterialAllocationDetail, b: MaterialAllocationDetail): number {
  const absCompare = b.raw_allocated_qty.abs().cmp(a.raw_allocated_qty.abs());
  if (absCompare !== 0) return absCompare;

  const materialCompare = a.source_material_usage_wms_id.localeCompare(b.source_material_usage_wms_id);
  if (materialCompare !== 0) return materialCompare;

  if (a.material_uom !== b.material_uom) return a.material_uom.localeCompare(b.material_uom);
  if (a.ppkek_bucket_key !== b.ppkek_bucket_key) return a.ppkek_bucket_key.localeCompare(b.ppkek_bucket_key);
  if (a.trace_row_type !== b.trace_row_type) return a.trace_row_type === 'NORMAL' ? -1 : 1;

  return a.source_material_usage_item_id - b.source_material_usage_item_id;
}

export function applyThreeDecimalRounding(
  rows: MaterialAllocationDetail[],
  materialAllocatedTotalRaw: Prisma.Decimal
): { roundedTotal: Prisma.Decimal; rows: MaterialAllocationDetail[] } {
  const roundedTotal = roundToScale(materialAllocatedTotalRaw, 3);
  const roundedRows = rows.map((row) => ({
    ...row,
    final_allocated_qty: roundToScale(row.raw_allocated_qty, 3),
    rounding_adjustment: new Prisma.Decimal(0),
  }));

  const sumRoundedRows = roundedRows.reduce(
    (sum, row) => sum.add(row.final_allocated_qty),
    new Prisma.Decimal(0)
  );
  const roundingDifference = roundedTotal.minus(sumRoundedRows);

  if (!roundingDifference.isZero()) {
    const targetRow = [...roundedRows]
      .filter((row) => row.raw_allocated_qty.abs().gt(0))
      .sort(compareDetailRowsForResidual)[0];

    if (targetRow) {
      targetRow.final_allocated_qty = targetRow.final_allocated_qty.plus(roundingDifference);
      targetRow.rounding_adjustment = roundingDifference;
    }
  }

  return { roundedTotal, rows: roundedRows };
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

      const productionOutputRows = await prisma.$queryRaw<any[]>`
        SELECT
          poi.planned_production_qty,
          poi.identify_product
        FROM production_output_items poi
        JOIN production_outputs po ON
          poi.production_output_id = po.id
          AND poi.production_output_company = po.company_code
          AND poi.production_output_date = po.transaction_date
        WHERE poi.item_code = ${fgItemCode}
          AND poi.work_order_number = ${workOrderNumber}
          AND po.company_code = ${companyCode}
          AND poi.deleted_at IS NULL
          AND po.deleted_at IS NULL
          AND COALESCE(po.reversal, '') <> 'Y'
        ORDER BY po.transaction_date DESC, po.timestamp DESC, po.id DESC, poi.id DESC
        LIMIT 1
      `;

      const productionOutputItem = productionOutputRows[0];

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

      const useZeroConsumption = productionOutputItem.identify_product !== 'Y';
      
      if (useZeroConsumption) {
        calculationLogger.debug('identify_product is not Y, will fetch materials but set consumption ratio to zero', {
          identify_product: productionOutputItem.identify_product,
        });
      }

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

      const materialUsagesRaw = await prisma.$queryRaw<any[]>`
        SELECT 
          mui.id,
          mui.item_code,
          mui.item_name,
          mui.uom,
          mui.qty,
          mui.component_demand_qty,
          mui.ppkek_number,
          mu.work_order_number,
          mu.transaction_date,
          mu.timestamp,
          mu.wms_id,
          mu.reversal
        FROM material_usage_items mui
        JOIN material_usages mu ON 
          mui.material_usage_id = mu.id 
          AND mui.material_usage_company = mu.company_code 
          AND mui.material_usage_date = mu.transaction_date
        WHERE mu.work_order_number = ${workOrderNumber}
          AND mu.company_code = ${companyCode}
          AND mui.item_type IN ('ROH', 'HALB')
          AND mui.deleted_at IS NULL
          AND mu.deleted_at IS NULL
        ORDER BY mui.item_code ASC, mui.uom ASC, mu.transaction_date ASC, mu.timestamp ASC, mu.id ASC, mui.id ASC
      `;

      if (!materialUsagesRaw || materialUsagesRaw.length === 0) {
        calculationLogger.warn('No material usage items found for work order', {
          workOrderNumber,
          companyCode,
        });
        return {
          work_order_number: workOrderNumber,
          identify_product: productionOutputItem.identify_product,
          allocations: [],
          calculation_status: 'not_found',
          error_message: `No material usage items found for work order ${workOrderNumber}`,
        };
      }

      const sourceRows: SourceMaterialUsageRow[] = materialUsagesRaw.map((row) => ({
        id: Number(row.id),
        item_code: row.item_code,
        item_name: row.item_name,
        uom: row.uom,
        qty: new Prisma.Decimal(row.qty.toString()),
        component_demand_qty: row.component_demand_qty === null || row.component_demand_qty === undefined
          ? null
          : new Prisma.Decimal(row.component_demand_qty.toString()),
        ppkek_number: row.ppkek_number,
        work_order_number: row.work_order_number,
        transaction_date: row.transaction_date,
        timestamp: row.timestamp,
        wms_id: row.wms_id,
        reversal: row.reversal,
      }));

      calculationLogger.debug('Retrieved material usage items for consolidated work order', {
        itemCount: materialUsagesRaw.length,
        items: materialUsagesRaw.map(m => ({ item_code: m.item_code, uom: m.uom, wms_id: m.wms_id })),
      });

      const consolidatedMaterials = new Map<string, ConsolidatedMaterial>();

      for (const material of sourceRows) {
        const key = `${material.item_code}|${material.uom}`;
        const existing = consolidatedMaterials.get(key);

        if (existing) {
          existing.detail_rows.push(material);
          continue;
        }

        const latestNormalPlanningRow = sourceRows
          .filter((row) =>
            row.item_code === material.item_code &&
            row.uom === material.uom &&
            row.reversal !== 'Y' &&
            row.component_demand_qty !== null
          )
          .sort((a, b) => {
            const trxCompare = b.transaction_date.getTime() - a.transaction_date.getTime();
            if (trxCompare !== 0) return trxCompare;
            const timestampCompare = b.timestamp.getTime() - a.timestamp.getTime();
            if (timestampCompare !== 0) return timestampCompare;
            return b.id - a.id;
          })[0];

        if (!latestNormalPlanningRow?.component_demand_qty) {
          calculationLogger.warn('No latest normal component demand found for material', {
            materialItemCode: material.item_code,
            materialUom: material.uom,
          });
          continue;
        }

        consolidatedMaterials.set(key, {
          item_code: material.item_code,
          item_name: latestNormalPlanningRow.item_name || material.item_name,
          uom: material.uom,
          component_demand_qty: latestNormalPlanningRow.component_demand_qty,
          detail_rows: [material],
        });
      }

      calculationLogger.debug('Material consolidation complete', {
        originalItemCount: materialUsagesRaw.length,
        consolidatedItemCount: consolidatedMaterials.size,
      });

      const allocations: MaterialAllocation[] = [];

      for (const material of consolidatedMaterials.values()) {
        const componentDemandQty = material.component_demand_qty;
        const plannedProdQty = productionOutputItem.planned_production_qty 
          ? new Prisma.Decimal(productionOutputItem.planned_production_qty.toString())
          : new Prisma.Decimal(1); // Default to 1 to avoid division by zero for zero consumption case

        if (!useZeroConsumption && plannedProdQty.isZero()) {
          calculationLogger.warn('Planned production qty is 0, cannot calculate ratio', {
            materialItemCode: material.item_code,
          });
          return {
            work_order_number: workOrderNumber,
            identify_product: productionOutputItem.identify_product,
            allocations: [],
            calculation_status: 'error',
            error_message: 'Planned production quantity is 0, cannot calculate consumption ratio',
          };
        }

        if (componentDemandQty.isZero()) {
          calculationLogger.debug('Component demand qty is 0, allocation will be 0', {
            materialItemCode: material.item_code,
          });
        }

        const consumptionRatio = useZeroConsumption 
          ? new Prisma.Decimal(0)
          : componentDemandQty.dividedBy(plannedProdQty);

        const materialAllocatedTotalRaw = qtyFG.mul(consumptionRatio);
        const materialNetUsageTotal = material.detail_rows.reduce((sum, row) => {
          const signedQty = row.reversal === 'Y' ? row.qty.negated() : row.qty;
          return sum.add(signedQty);
        }, new Prisma.Decimal(0));

        const rawDetailRows: MaterialAllocationDetail[] = material.detail_rows.map((row) => {
          const traceRowType = row.reversal === 'Y' ? 'REVERSAL' : 'NORMAL';
          const { display, bucket } = classifyPPKEK(row.ppkek_number);
          const signedQty = traceRowType === 'REVERSAL' ? row.qty.negated() : row.qty;
          const rawAllocatedQty = materialNetUsageTotal.isZero()
            ? new Prisma.Decimal(0)
            : materialAllocatedTotalRaw.mul(signedQty).div(materialNetUsageTotal);

          return {
            source_material_usage_item_id: row.id,
            source_material_usage_wms_id: row.wms_id,
            trace_row_type: traceRowType,
            display_ppkek_number: display,
            ppkek_bucket_key: bucket,
            actual_qty: row.qty,
            signed_qty: signedQty,
            material_net_usage_total: materialNetUsageTotal,
            raw_allocated_qty: rawAllocatedQty,
            final_allocated_qty: new Prisma.Decimal(0),
            rounding_adjustment: new Prisma.Decimal(0),
            material_uom: row.uom,
          };
        });

        const { roundedTotal, rows: detailRows } = applyThreeDecimalRounding(
          rawDetailRows,
          materialAllocatedTotalRaw
        );

        allocations.push({
          work_order_number: workOrderNumber,
          material_item_code: material.item_code,
          material_item_name: material.item_name,
          material_uom: material.uom,
          material_qty_allocated: roundedTotal,
          consumption_ratio: consumptionRatio,
          component_demand_qty: componentDemandQty,
          planned_production_qty: plannedProdQty,
          detail_rows: detailRows,
        });

        calculationLogger.debug('Calculated allocation for material', {
          materialItemCode: material.item_code,
          consolidatedComponentDemandQty: componentDemandQty.toString(),
          plannedProdQty: plannedProdQty.toString(),
          consumptionRatio: consumptionRatio.toString(),
          qtyFGExported: qtyFG.toString(),
          allocatedQty: roundedTotal.toString(),
          identifiedProductFlag: productionOutputItem.identify_product,
          detailRowCount: detailRows.length,
          materialNetUsageTotal: materialNetUsageTotal.toString(),
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
      // 1. Check latest normal production output exists
      const prodOutputRows = await prisma.$queryRaw<any[]>`
        SELECT poi.planned_production_qty, poi.identify_product
        FROM production_output_items poi
        JOIN production_outputs po ON
          poi.production_output_id = po.id
          AND poi.production_output_company = po.company_code
          AND poi.production_output_date = po.transaction_date
        WHERE poi.item_code = ${fgItemCode}
          AND poi.work_order_number = ${workOrderNumber}
          AND po.company_code = ${companyCode}
          AND poi.deleted_at IS NULL
          AND po.deleted_at IS NULL
          AND COALESCE(po.reversal, '') <> 'Y'
        ORDER BY po.transaction_date DESC, po.timestamp DESC, po.id DESC, poi.id DESC
        LIMIT 1
      `;
      const prodOutput = prodOutputRows[0];

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
          AND mu.deleted_at IS NULL
          AND COALESCE(mu.reversal, '') <> 'Y'
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
