import { logger } from '@/lib/utils/logger';
import {
  MaterialUsageBatch,
  BatchValidationError,
  validateMaterialUsageBatch,
} from '@/lib/validators/material-usage.validator';
import { MaterialUsageRepository } from '@/lib/repositories/material-usage.repository';

/**
 * Material Usage Service
 * 
 * Handles:
 * - Validation of material usage transactions
 * - Company validation with caching (batch lookup, not per-record)
 * - Batch processing with parallel inserts
 * 
 * Optimizations:
 * - Single database query to validate all companies in batch
 * - In-memory cache for company results (Map for O(1) lookup)
 * - Non-blocking async database inserts (returns 200 immediately)
 * - Promise.allSettled for parallel item processing
 */

interface BatchSuccessResponse {
  status: 'success';
  message: string;
  wms_id: string;
  queued_items_count: number;
  validated_at: string;
}

interface BatchFailedResponse {
  status: 'failed';
  message: string;
  wms_id: string;
  errors: BatchValidationError[];
}

export class MaterialUsageService {
  private repository: MaterialUsageRepository;
  private companyCache: Map<number, boolean> = new Map();

  constructor() {
    this.repository = new MaterialUsageRepository();
  }

  /**
   * Process single material usage transaction
   * Returns immediately after validation, actual insert happens asynchronously
   */
  async processMaterialUsage(
    payload: unknown
  ): Promise<BatchSuccessResponse | BatchFailedResponse> {
    const requestId = this.generateRequestId();
    const log = logger.child({
      service: 'MaterialUsageService',
      method: 'processMaterialUsage',
      requestId,
    });

    try {
      // Step 1: Schema validation
      const validationResult = validateMaterialUsageBatch(payload);

      if (!validationResult.success) {
        log.warn('Validation failed', {
          errorCount: validationResult.errors.length,
        });

        const wmsId = (payload as any)?.wms_id || 'unknown';
        return {
          status: 'failed',
          message: 'Validation failed',
          wms_id: wmsId,
          errors: validationResult.errors,
        };
      }

      const data = validationResult.data!;

      log.info('Batch schema validated', {
        wmsId: data.wms_id,
        recordCount: data.items.length,
      });

      // Step 2: Business validation (company, work order, etc.)
      const businessErrors = await this.validateBusiness(data);

      if (businessErrors.length > 0) {
        log.warn('Business validation failed', {
          wmsId: data.wms_id,
          errorCount: businessErrors.length,
        });

        return {
          status: 'failed',
          message: 'Validation failed',
          wms_id: data.wms_id,
          errors: businessErrors,
        };
      }

      log.info('Batch validation complete', {
        wmsId: data.wms_id,
        itemsCount: data.items.length,
      });

      // Step 3: Queue for immediate async insert (non-blocking)
      this.repository
        .batchUpsert(data)
        .then(() => {
          log.info('Material usage saved successfully', {
            wmsId: data.wms_id,
            itemsCount: data.items.length,
          });
        })
        .catch((err: any) => {
          log.error('Material usage insert failed', {
            wmsId: data.wms_id,
            error: err.message,
          });
        });

      // Return success immediately (insert happens async)
      return {
        status: 'success',
        message: 'Transaction validated and queued for processing',
        wms_id: data.wms_id,
        queued_items_count: data.items.length,
        validated_at: new Date().toISOString(),
      };
    } catch (err: any) {
      log.error('Unexpected error during processing', {
        error: err.message,
        stack: err.stack,
      });

      const wmsId = (payload as any)?.wms_id || 'unknown';
      return {
        status: 'failed',
        message: 'Internal server error',
        wms_id: wmsId,
        errors: [
          {
            location: 'header',
            code: 'INTERNAL_ERROR',
            message: err.message,
          },
        ],
      };
    }
  }

  /**
   * Validate business rules for material usage transaction
   * 
   * Optimizations:
   * - Batch company validation (single query instead of per-record)
   * - In-memory cache for company results
   * 
   * Note: Only company validation performed.
   * Work order and cost center not validated (all data from WMS is valid)
   */
  private async validateBusiness(
    data: MaterialUsageBatch
  ): Promise<BatchValidationError[]> {
    const errors: BatchValidationError[] = [];

    // Validate company exists (with caching)
    const companyExists = await this.cacheCompanyValidation(
      data.company_code
    );
    if (!companyExists) {
      errors.push({
        location: 'header',
        field: 'company_code',
        code: 'COMPANY_NOT_FOUND',
        message: `Company code ${data.company_code} not found`,
      });
      return errors; // Stop validation if company doesn't exist
    }

    return errors;
  }

  /**
   * Cache company validation to avoid repeated queries
   * Optimization: In-memory Map for O(1) lookup
   */
  private async cacheCompanyValidation(companyCode: number): Promise<boolean> {
    // Return cached result if available
    if (this.companyCache.has(companyCode)) {
      return this.companyCache.get(companyCode)!;
    }

    // Query database
    const exists = await this.repository.companyExists(companyCode);

    // Cache the result
    this.companyCache.set(companyCode, exists);

    return exists;
  }

  /**
   * Generate unique request ID for tracing
   */
  private generateRequestId(): string {
    return `mtl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
