/**
 * WIP Balance Service
 * 
 * Pattern aligned with Incoming Goods Service
 * - Validates payload (schema + business logic)
 * - Processes valid records batch
 * - Returns comprehensive response
 * 
 * Key differences from Incoming Goods:
 * - Batch processing (multiple independent records)
 * - Partial success allowed (some records can fail)
 * - No transaction grouping (flat records)
 */

import { WipBalanceRepository } from '../repositories/wip-balance.repository';
import {
  validateWIPBalanceBatch,
  validateItemTypes,
  checkWipBalanceDuplicates,
  validateWipBalanceItemTypeConsistency,
  type WipBalanceRecordInput,
  type WipBalanceRecordValidated,
  type BatchValidationError,
} from '../validators/schemas/wip-balance.schema';
import type {
  BatchSuccessResponse,
  BatchFailedRecord,
  ErrorDetail,
} from '../types/api-response';
import { logger } from '../utils/logger';

export class WIPBalanceService {
  private repository: WipBalanceRepository;

  constructor() {
    this.repository = new WipBalanceRepository();
  }

  /**
   * Process WIP Balance batch request
   * 
   * Flow:
   * 1. Validate batch structure (schema)
   * 2. For each record:
   *    a. Validate business logic (company, item code)
   *    b. If valid: queue for database insert
   *    c. If invalid: add to failed records
   * 3. Return response (success/partial/failed)
   */
  async processBatch(
    payload: unknown
  ): Promise<
    | { success: true; data: BatchSuccessResponse }
    | { success: false; errors: ErrorDetail[] }
  > {
    const requestLogger = logger.child({
      service: 'WIPBalanceService',
      method: 'processBatch',
    });

    try {
      // 1. Validate batch structure
      const validationResult = validateWIPBalanceBatch(payload);

      if (!validationResult.success) {
        requestLogger.warn(
          'Batch schema validation failed',
          { errors: validationResult.errors }
        );
        // Convert BatchValidationError to ErrorDetail for response
        const errorDetails = (validationResult.errors || []).map((err) => ({
          location: 'item' as const,
          field: err.field,
          code: err.code,
          message: err.message,
        }));
        return { success: false, errors: errorDetails };
      }

      if (!validationResult.data) {
        requestLogger.error('Batch validation successful but data is undefined');
        return { success: false, errors: [{ location: 'header' as const, field: 'data', code: 'INTERNAL_ERROR', message: 'Validation data missing' }] };
      }

      const batch = validationResult.data;
      requestLogger.info('Batch schema validated', {
        recordCount: batch.records.length,
      });

      // 2. Validate item types
      const itemTypeErrors = await validateItemTypes(batch);
      if (itemTypeErrors.length > 0) {
        requestLogger.warn(
          'Item type validation failed',
          { errors: itemTypeErrors }
        );
        const errorDetails = itemTypeErrors.map((err) => ({
          location: err.location,
          field: err.field,
          code: err.code,
          message: err.message,
          ...(err.record_index !== undefined && { record_index: err.record_index }),
        }));
        return { success: false, errors: errorDetails as ErrorDetail[] };
      }

      requestLogger.info('Item types validated', {
        recordCount: batch.records.length,
      });

      // 3. Check for duplicate items in batch
      const duplicateErrors = checkWipBalanceDuplicates(batch);
      if (duplicateErrors.length > 0) {
        requestLogger.warn(
          'Duplicate items found in batch',
          { errors: duplicateErrors }
        );
        const errorDetails = duplicateErrors.map((err) => ({
          location: err.location,
          field: err.field,
          code: err.code,
          message: err.message,
          ...(err.item_index !== undefined && { record_index: err.item_index }),
        }));
        return { success: false, errors: errorDetails as ErrorDetail[] };
      }

      requestLogger.info('Duplicate items check passed', {
        recordCount: batch.records.length,
      });

      // 4. Validate item_type consistency
      const itemTypeConsistencyErrors = await validateWipBalanceItemTypeConsistency(batch);
      if (itemTypeConsistencyErrors.length > 0) {
        requestLogger.warn(
          'Item type consistency validation failed',
          { errors: itemTypeConsistencyErrors }
        );
        const errorDetails = itemTypeConsistencyErrors.map((err) => ({
          location: err.location,
          field: err.field,
          code: err.code,
          message: err.message,
          ...(err.record_index !== undefined && { record_index: err.record_index }),
        }));
        return { success: false, errors: errorDetails as ErrorDetail[] };
      }

      requestLogger.info('Item type consistency validated', {
        recordCount: batch.records.length,
      });

      // 5. Optimize: Pre-fetch company cache for all unique companies
      const successRecords: WipBalanceRecordValidated[] = [];
      const failedRecords: BatchFailedRecord[] = [];

      // Get unique company codes to minimize database queries
      const uniqueCompanyCodes = [...new Set(batch.records.map(r => r.company_code))];
      const companyCache = await this.cacheCompanyValidation(uniqueCompanyCodes);

      // Process records with cached company validation
      for (let i = 0; i < batch.records.length; i++) {
        const record = batch.records[i];
        const companyExists = companyCache.get(record.company_code) ?? false;
        
        const businessErrors: BatchValidationError[] = [];
        if (!companyExists) {
          businessErrors.push({
            location: 'record' as const,
            field: 'company_code',
            code: 'INVALID_COMPANY_CODE',
            message: `Company code ${record.company_code} is not active or does not exist`,
            record_index: i,
          });
        }

        if (businessErrors.length > 0) {
          // Convert BatchValidationError to ErrorDetail
          const errorDetails = businessErrors.map((err) => ({
            location: 'item' as const,
            field: err.field,
            code: err.code,
            message: err.message,
          }));
          failedRecords.push({
            wms_id: record.wms_id,
            row_index: i + 1,
            errors: errorDetails,
          });
          requestLogger.warn(
            'Record business validation failed',
            {
              wmsId: record.wms_id,
              rowIndex: i + 1,
              errors: businessErrors,
            }
          );
        } else {
          successRecords.push(record);
        }
      }

      requestLogger.info('Batch processing complete', {
        success: successRecords.length,
        failed: failedRecords.length,
      });

      // 3. Queue valid records for async database insert
      if (successRecords.length > 0) {
        // Fire and forget - don't wait for database insert
        this.queueForDatabaseInsert(successRecords, requestLogger);
      }

      // 4. Return appropriate response
      const totalRecords = batch.records.length;

      if (failedRecords.length === 0) {
        // All success
        return {
          success: true,
          data: {
            status: 'success',
            message: 'All records validated and queued for processing',
            summary: {
              total_records: totalRecords,
              success_count: successRecords.length,
              failed_count: 0,
            },
            validated_at: new Date().toISOString(),
          },
        };
      } else if (successRecords.length > 0) {
        // Partial success
        return {
          success: true,
          data: {
            status: 'partial_success',
            message: `${failedRecords.length} out of ${totalRecords} records failed validation`,
            summary: {
              total_records: totalRecords,
              success_count: successRecords.length,
              failed_count: failedRecords.length,
            },
            validated_at: new Date().toISOString(),
            failed_records: failedRecords,
          },
        };
      } else {
        // All failed
        return {
          success: false,
          errors: failedRecords.flatMap((r) => r.errors),
        };
      }
    } catch (error) {
      requestLogger.error('Failed to process batch', { error });
      throw error;
    }
  }

  /**
   * Cache company validation results to minimize database queries
   * Optimization: Batch query all unique company codes at once
   */
  private async cacheCompanyValidation(
    companyCodes: number[]
  ): Promise<Map<number, boolean>> {
    const cache = new Map<number, boolean>();
    
    try {
      // Batch query: fetch all companies in one go instead of one by one
      const companies = await this.repository.getCompaniesByCode(companyCodes);
      const validCompanyCodes = new Set(
        companies
          .filter(c => c.status === 'ACTIVE')
          .map(c => c.code)
      );
      
      // Build cache
      companyCodes.forEach(code => {
        cache.set(code, validCompanyCodes.has(code));
      });
    } catch (error) {
      // If query fails, mark all as invalid
      companyCodes.forEach(code => {
        cache.set(code, false);
      });
    }
    
    return cache;
  }

  /**
   * Business validations (database checks)
   * 
   * Note: Based on API Contract v2.4:
   * - Only company_code needs to be validated
   * - Item_code validation is NOT required (WMS is source of truth)
   * - Item_type validation is handled by WMS
   */
  private async validateBusiness(
    record: WipBalanceRecordValidated,
    rowIndex: number
  ): Promise<BatchValidationError[]> {
    const errors: BatchValidationError[] = [];

    // Check if company exists and is active
    try {
      const companyExists = await this.repository.companyExists(
        record.company_code
      );
      if (!companyExists) {
        errors.push({
          location: 'record' as const,
          field: 'company_code',
          code: 'INVALID_COMPANY_CODE',
          message: `Company code ${record.company_code} is not active or does not exist`,
          record_index: rowIndex,
        });
      }
    } catch (error) {
      // Treat validation errors as business logic errors
      errors.push({
        location: 'record' as const,
        field: 'company_code',
        code: 'VALIDATION_ERROR',
        message: 'Failed to validate company code',
        record_index: rowIndex,
      });
    }

    // NOTE: Item code validation removed as per API Contract v2.4
    // WMS is the source of truth for item data
    // iMAPS will accept any item_code sent by WMS

    return errors;
  }

  /**
   * Queue records for async database insert
   * Fire and forget - no need to wait
   */
  private async queueForDatabaseInsert(
    records: WipBalanceRecordValidated[],
    requestLogger: any
  ): Promise<void> {
    try {
      // Convert records to database format
      const dbRecords = records.map((r) => ({
        wms_id: r.wms_id,
        company_code: r.company_code,
        item_type: r.item_type,
        item_code: r.item_code,
        item_name: r.item_name,
        stock_date: new Date(r.stock_date),
        uom: r.uom,
        qty: r.qty,
        timestamp: new Date(r.timestamp),
      }));

      // Queue for async insert (don't await)
      this.repository.batchUpsert(dbRecords).catch((error) => {
        requestLogger.error('Database insert failed:', { error });
        // Don't re-throw - validation already succeeded
      });
    } catch (error) {
      requestLogger.error('Error queuing records for insert:', { error });
      // Don't re-throw - validation already succeeded
    }
  }

  /**
   * Get WIP Balance records for a specific date (for queries)
   */
  async getByDate(company_code: number, stock_date: Date) {
    return await this.repository.getByDateAndCompany(stock_date, company_code);
  }
}