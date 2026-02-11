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

      // Step 5: Company validation
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

      // Step 6: Queue for immediate async insert (non-blocking)
      this.repository
        .create(data)
        .then((result) => {
          log.info('Adjustment saved successfully', {
            wmsId: data.wms_id,
            adjustmentId: result.header.id,
          });
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
}
