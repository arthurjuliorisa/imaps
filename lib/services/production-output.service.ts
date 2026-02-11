import { logger } from '@/lib/utils/logger';
import {
  validateProductionOutputBatch,
  validateItemTypes,
  validateProductionOutputItemTypeConsistency,
  type ProductionOutputBatchRequestInput,
} from '@/lib/validators/schemas/production-output.schema';
import { ProductionOutputRepository } from '@/lib/repositories/production-output.repository';
import { transformZodErrors } from '@/lib/utils/error-transformer';
import type { SuccessResponse, ErrorResponse, ErrorDetail } from '@/lib/types/api-response';

/**
 * Production Output Service
 * 
 * Handles:
 * - Validation of production output transactions
 * - Company validation with caching
 * - Repository integration
 * - Error handling and logging
 */

type ServiceResponse = 
  | { success: true; data: SuccessResponse }
  | { success: false; errors: ErrorDetail[] }

export class ProductionOutputService {
  private repository: ProductionOutputRepository;
  private companyCache: Map<number, boolean> = new Map();

  constructor() {
    this.repository = new ProductionOutputRepository();
  }

  /**
   * Process production output transaction
   * Returns immediately after validation, actual insert happens asynchronously
   */
  async processProductionOutput(
    payload: unknown
  ): Promise<ServiceResponse> {
    const requestId = this.generateRequestId();
    const log = logger.child({
      service: 'ProductionOutputService',
      method: 'processProductionOutput',
      requestId,
    });

    try {
      // Step 1: Schema validation
      const validation = validateProductionOutputBatch(payload);

      if (!validation.success) {
        log.warn('Validation failed', {
          errorCount: validation.errors?.length || 0,
        });

        return {
          success: false,
          errors: validation.errors || [],
        };
      }

      const data = validation.data as ProductionOutputBatchRequestInput;

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

      // Step 3: Validate item_type consistency
      const itemTypeConsistencyErrors = await validateProductionOutputItemTypeConsistency(data);
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

      // Step 4: Company validation
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

      // Step 5: Queue for immediate async insert (non-blocking)
      this.repository
        .create(data)
        .then((result) => {
          log.info('Production output saved successfully', {
            wmsId: data.wms_id,
            productionOutputId: result.header.id,
          });
        })
        .catch((err: any) => {
          log.error('Production output insert failed', {
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
    return `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
