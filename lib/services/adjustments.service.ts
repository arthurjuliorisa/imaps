import { logger } from '@/lib/utils/logger';
import {
  validateAdjustmentBatch,
  validateItemTypes,
  checkAdjustmentDuplicates,
  validateAdjustmentItemTypeConsistency,
  type AdjustmentBatchRequestInput,
} from '@/lib/validators/schemas/adjustment.schema';
import { AdjustmentsRepository } from '@/lib/repositories/adjustments.repository';
import { transformZodErrors } from '@/lib/utils/error-transformer';
import type { SuccessResponse, ErrorResponse, ErrorDetail } from '@/lib/types/api-response';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { prisma } from '@/lib/db/prisma';

/**
 * Adjustments Service
 * 
 * Handles:
 * - Validation of adjustment transactions
 * - Company validation with caching
 * - Repository integration
 * - Error handling and logging
 */

type ServiceResponse = 
  | { success: true; data: SuccessResponse }
  | { success: false; errors: ErrorDetail[] }

export class AdjustmentsService {
  private repository: AdjustmentsRepository;
  private companyCache: Map<number, boolean> = new Map();

  constructor() {
    this.repository = new AdjustmentsRepository();
  }

  /**
   * Process adjustment transaction
   * Returns immediately after validation, actual insert happens asynchronously
   */
  async processAdjustment(
    payload: unknown
  ): Promise<ServiceResponse> {
    const requestId = this.generateRequestId();
    const log = logger.child({
      service: 'AdjustmentsService',
      method: 'processAdjustment',
      requestId,
    });

    try {
      // Step 1: Schema validation
      const validation = validateAdjustmentBatch(payload);

      if (!validation.success) {
        log.warn('Validation failed', {
          errorCount: validation.errors?.length || 0,
        });

        return {
          success: false,
          errors: validation.errors || [],
        };
      }

      const data = validation.data as AdjustmentBatchRequestInput;

      log.info('Batch schema validated', {
        wmsId: data.wms_id,
        itemCount: data.items.length,
      });

      // Step 2: Validate item types
      const itemTypeErrors = await validateItemTypes(data);
      if (itemTypeErrors.length > 0) {
        log.warn('Item type validation failed', {
          errorCount: itemTypeErrors.length,
        });

        return {
          success: false,
          errors: itemTypeErrors as ErrorDetail[],
        };
      }

      log.info('Item types validated', {
        wmsId: data.wms_id,
      });

      // Step 3: Check for duplicate items
      const duplicateErrors = checkAdjustmentDuplicates(data);
      if (duplicateErrors.length > 0) {
        log.warn('Duplicate items found', {
          errorCount: duplicateErrors.length,
        });

        return {
          success: false,
          errors: duplicateErrors as ErrorDetail[],
        };
      }

      log.info('Duplicate items check passed', {
        wmsId: data.wms_id,
      });

      // Step 4: Validate item_type consistency
      const itemTypeConsistencyErrors = await validateAdjustmentItemTypeConsistency(data);
      if (itemTypeConsistencyErrors.length > 0) {
        log.warn('Item type consistency validation failed', {
          errorCount: itemTypeConsistencyErrors.length,
        });

        return {
          success: false,
          errors: itemTypeConsistencyErrors as ErrorDetail[],
        };
      }

      log.info('Item type consistency validated', {
        wmsId: data.wms_id,
      });

      // Step 5: Validate stockcount_order_number references (NEW for v3.4.0)
      const stockCountErrors = await this.validateStockCountOrderNumbers(data);
      if (stockCountErrors.length > 0) {
        log.warn('Stock count order validation failed', {
          errorCount: stockCountErrors.length,
        });

        return {
          success: false,
          errors: stockCountErrors as ErrorDetail[],
        };
      }

      log.info('Stock count order numbers validated', {
        wmsId: data.wms_id,
      });

      // Step 6: Company validation
      const companyExists = await this.validateCompany(data.company_code);

      if (!companyExists) {
        log.warn('Company validation failed', {
          wmsId: data.wms_id,
          companyCode: data.company_code,
        });

        return {
          success: false,
          errors: [
            {
              location: 'header',
              field: 'company_code',
              code: 'COMPANY_NOT_FOUND',
              message: `Company code ${data.company_code} does not exist`,
            },
          ],
        };
      }

      log.info('Company validated', {
        wmsId: data.wms_id,
        companyCode: data.company_code,
      });

      // Step 7: Queue for immediate async insert (non-blocking)
      this.repository
        .create(data)
        .then((result) => {
          log.info('Adjustment saved successfully', {
            wmsId: data.wms_id,
            adjustmentId: result.header.id,
          });

          // Check company type before INSW transmission
          (async () => {
            try {
              const company = await prisma.companies.findUnique({
                where: { code: data.company_code },
                select: { company_type: true },
              });

              // Only transmit if SEZ company
              if (company?.company_type === 'SEZ') {
                const inswTransmission = new INSWTransmissionService();
                const res = await inswTransmission.transmitAdjustment(
                  data.company_code,
                  result.header.id,
                  data.wms_id
                );
                log.info('INSW adjustment transmitted', { wmsId: data.wms_id, status: res.status });
              } else {
                log.info('INSW adjustment NOT transmitted (non-SEZ company)', { 
                  wmsId: data.wms_id,
                  companyType: company?.company_type
                });
              }
            } catch (err: any) {
              log.error('INSW adjustment transmission error', { wmsId: data.wms_id, error: err.message });
            }
          })();
        })
        .catch((err: any) => {
          log.error('Adjustment insert failed', {
            wmsId: data.wms_id,
            error: err.message,
          });
        });

      // Return success immediately (insert happens async)
      return {
        success: true,
        data: {
          status: 'success',
          message: 'Transaction validated and queued for processing',
          wms_id: data.wms_id,
          queued_items_count: data.items.length,
          validated_at: new Date().toISOString(),
        },
      };
    } catch (err: any) {
      log.error('Unexpected error during processing', {
        error: err.message,
        stack: err.stack,
      });

      const wmsId = (payload as any)?.wms_id || 'unknown';
      return {
        success: false,
        errors: [
          {
            location: 'header',
            field: 'unknown',
            code: 'INTERNAL_ERROR',
            message: err.message,
          },
        ],
      };
    }
  }

  /**
   * Validate stockcount_order_number references valid Stock Opname
   * If stockcount_order_number provided, must reference Stock Opname with status "Confirmed"
   */
  private async validateStockCountOrderNumbers(
    data: AdjustmentBatchRequestInput
  ): Promise<ErrorDetail[]> {
    const errors: ErrorDetail[] = [];
    
    // Collect unique stockcount_order_numbers
    const orderNumbers = new Set<string>();
    data.items.forEach((item) => {
      if (item.stockcount_order_number) {
        orderNumbers.add(item.stockcount_order_number);
      }
    });

    if (orderNumbers.size === 0) {
      // No stockcount_order_numbers to validate
      return [];
    }

    // Fetch Stock Opnames
    const stockOpnames = await this.repository.getStockOpnamesByWmsIds(
      Array.from(orderNumbers),
      data.company_code
    );

    const validOpnames = new Map(
      stockOpnames
        .filter((so) => so.status === 'Confirmed')
        .map((so) => [so.wms_id, true])
    );

    // Check each item's stockcount_order_number
    data.items.forEach((item, index) => {
      if (!item.stockcount_order_number) {
        return; // Skip if not provided
      }

      const stoWmsId = item.stockcount_order_number;
      const foundStockOpname = stockOpnames.find((so) => so.wms_id === stoWmsId);

      if (!foundStockOpname) {
        errors.push({
          location: 'item',
          item_index: index,
          item_code: item.item_code,
          field: 'stockcount_order_number',
          code: 'STOCKCOUNT_ORDER_NOT_FOUND',
          message: `Stock Opname with wms_id '${stoWmsId}' not found`,
        });
        return;
      }

      if (foundStockOpname.status !== 'Confirmed') {
        errors.push({
          location: 'item',
          item_index: index,
          item_code: item.item_code,
          field: 'stockcount_order_number',
          code: 'STOCKCOUNT_ORDER_NOT_CONFIRMED',
          message: `Stock Opname '${stoWmsId}' has status '${foundStockOpname.status}', must be 'Confirmed'`,
        });
      }
    });

    return errors;
  }

  /**
   * Validate company exists
   */
  private async validateCompany(companyCode: number): Promise<boolean> {
    // Check cache first
    if (this.companyCache.has(companyCode)) {
      return this.companyCache.get(companyCode)!;
    }

    // Query database
    const exists = await this.repository.companyExists(companyCode);

    // Cache result
    this.companyCache.set(companyCode, exists);

    return exists;
  }

  /**
   * Generate request ID for tracking
   */
  private generateRequestId(): string {
    return `adj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate reconciliation data for adjustments (Phase 4: Reconciliation Calculation)
   * 
   * For each adjustment item, fetch stock snapshot and calculate:
   * - beginning_qty: Opening balance on adjustment date (from snapshot)
   * - incoming_qty_on_date: Incoming goods on adjustment date
   * - outgoing_qty_on_date: Outgoing goods on adjustment date
   * - system_qty: Expected system quantity (beginning + incoming - outgoing)
   * - adjusted_qty: Final quantity after adjustment (system_qty + variance_qty)
   * 
   * @param companyCode Company code
   * @param items Array of adjustment items with qty (variance)
   * @param adjustmentDate Date of adjustment transaction
   * @returns Array of items with reconciliation fields populated
   */
  async calculateReconciliationData(
    companyCode: number,
    items: Array<{
      item_code: string;
      item_type: string;
      item_name: string;
      uom: string;
      qty: number; // variance amount (can be +/-)
      adjustment_type: string;
    }>,
    adjustmentDate: Date
  ): Promise<Array<{
    item_code: string;
    beginning_qty: number;
    incoming_qty_on_date: number;
    outgoing_qty_on_date: number;
    system_qty: number;
    adjusted_qty: number;
  }>> {
    const log = logger.child({
      scope: 'calculateReconciliationData',
      companyCode,
      adjustmentDate: adjustmentDate.toISOString().split('T')[0],
      itemCount: items.length,
    });

    const results: Array<{
      item_code: string;
      beginning_qty: number;
      incoming_qty_on_date: number;
      outgoing_qty_on_date: number;
      system_qty: number;
      adjusted_qty: number;
    }> = [];

    for (const item of items) {
      try {
        // Step 1: Fetch stock snapshot for exact adjustment date
        let snapshot = await this.repository.getStockSnapshot(
          companyCode,
          item.item_code,
          adjustmentDate
        );

        // Step 2: If no exact date, fallback to latest before adjustment date
        if (!snapshot) {
          snapshot = await this.repository.getLatestStockSnapshotBefore(
            companyCode,
            item.item_code,
            adjustmentDate
          );

          if (!snapshot) {
            log.warn('No stock snapshot found for item', {
              item_code: item.item_code,
              adjustmentDate: adjustmentDate.toISOString().split('T')[0],
            });

            // Use zeros if no snapshot exists
            snapshot = {
              opening_balance: 0,
              incoming_qty: 0,
              outgoing_qty: 0,
            };
          }
        }

        // Step 3: Calculate reconciliation fields
        const beginning_qty = snapshot.opening_balance || 0;
        const incoming_qty_on_date = snapshot.incoming_qty || 0;
        const outgoing_qty_on_date = snapshot.outgoing_qty || 0;

        // system_qty = beginning + incoming - outgoing
        const system_qty = beginning_qty + incoming_qty_on_date - outgoing_qty_on_date;

        // adjusted_qty = system_qty + variance (respect sign of adjustment_type)
        const multiplier = item.adjustment_type === 'LOSS' ? -1 : 1;
        const signedVariance = item.qty * multiplier;
        const adjusted_qty = system_qty + signedVariance;

        results.push({
          item_code: item.item_code,
          beginning_qty,
          incoming_qty_on_date,
          outgoing_qty_on_date,
          system_qty,
          adjusted_qty,
        });

        log.debug('Reconciliation calculated for item', {
          item_code: item.item_code,
          beginning_qty,
          incoming_qty_on_date,
          outgoing_qty_on_date,
          system_qty,
          adjusted_qty,
        });
      } catch (err) {
        log.error('Failed to calculate reconciliation for item', {
          item_code: item.item_code,
          error: (err as any).message,
        });

        // Return zeros if calculation fails
        results.push({
          item_code: item.item_code,
          beginning_qty: 0,
          incoming_qty_on_date: 0,
          outgoing_qty_on_date: 0,
          system_qty: 0,
          adjusted_qty: item.qty,
        });
      }
    }

    log.info('Reconciliation calculation completed', {
      successCount: results.length,
      itemCount: items.length,
    });

    return results;
  }
}
