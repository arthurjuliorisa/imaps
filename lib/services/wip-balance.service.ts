// lib/services/wip-balance.service.ts

/**
 * WIP Balance Service
 * 
 * Purpose:
 * - Orchestrate validation and database operations
 * - Implement batch processing with partial success
 * - Handle business logic and error aggregation
 * 
 * Flow:
 * 1. Validate all records (schema validation)
 * 2. Separate valid and invalid records
 * 3. Process valid records via repository (with error handling)
 * 4. Aggregate results for comprehensive response
 * 
 * Key Features:
 * - Partial success support (some records can fail)
 * - Detailed error tracking per record
 * - Comprehensive response with summary
 * 
 * Version: 2.0 - Updated to use new validation pattern
 */

import { wipBalanceRepository } from '@/lib/repositories/wip-balance.repository';
import {
  validateWipBalanceBatch,
  validateWipBalanceRecord,
  type WipBalanceBatchRequestInput,
  type WipBalanceRecordInput,
} from '@/lib/validators/schemas/wip-balance.schema';
import {
  WipBalanceRecord,
  WipBalanceRecordError,
  WipBalanceBatchValidationResult,
  WipBalanceApiResponse,
} from '@/lib/types/wip-balance.types';

/**
 * Service class for WIP Balance operations
 */
export class WipBalanceService {
  /**
   * Transform validated record to repository format
   * Converts string dates to Date objects as expected by repository
   */
  private transformRecord(record: WipBalanceRecordInput): WipBalanceRecord {
    return {
      ...record,
      stock_date: new Date(record.stock_date),
      timestamp: new Date(record.timestamp),
    };
  }

  /**
   * Validate batch of records
   * 
   * Strategy:
   * - Use the standardized validation function
   * - Transform validation result to service format
   * - Separate valid and invalid records
   * 
   * @param payload - Raw batch request payload
   * @returns Validation result with valid/invalid records separated
   */
  validateBatch(payload: unknown): WipBalanceBatchValidationResult {
    const result = validateWipBalanceBatch(payload);

    // Handle validation failure
    if (!result.success) {
      const invalidRecords: WipBalanceRecordError[] = result.errors!.map((err) => {
        // Check if this is a record-level error
        const isRecordError = err.location === 'record' && err.record_index !== undefined;
        
        return {
          wms_id: err.wms_id || (isRecordError ? `RECORD_${err.record_index}` : 'BATCH_ERROR'),
          row_index: isRecordError ? err.record_index! + 1 : 0, // 1-indexed for user-friendly reporting
          errors: [
            {
              field: err.field,
              code: err.code,
              message: err.message,
            },
          ],
        };
      });

      // Group errors by wms_id/row_index to combine multiple field errors
      const groupedErrors = new Map<string, WipBalanceRecordError>();
      
      invalidRecords.forEach((record) => {
        const key = `${record.wms_id}_${record.row_index}`;
        
        if (groupedErrors.has(key)) {
          const existing = groupedErrors.get(key)!;
          existing.errors.push(...record.errors);
        } else {
          groupedErrors.set(key, record);
        }
      });

      const totalRecords = Array.isArray((payload as any)?.records) 
        ? (payload as any).records.length 
        : 0;

      return {
        valid_records: [],
        invalid_records: Array.from(groupedErrors.values()),
        summary: {
          total_records: totalRecords,
          valid_count: 0,
          invalid_count: groupedErrors.size,
        },
      };
    }

    // All records are valid - transform dates
    const records = result.data!.records.map(record => this.transformRecord(record));
    
    return {
      valid_records: records,
      invalid_records: [],
      summary: {
        total_records: records.length,
        valid_count: records.length,
        invalid_count: 0,
      },
    };
  }

  /**
   * Process valid records through repository
   * 
   * Strategy:
   * - Insert valid records one by one (for error isolation)
   * - Continue processing even if some fail
   * - Collect database errors for response
   * 
   * @param validRecords - Array of validated records
   * @returns Processing result with success/failure details
   */
  private async processValidRecords(validRecords: WipBalanceRecord[]) {
    const batchResult = await wipBalanceRepository.batchUpsert(validRecords);

    return {
      success_count: batchResult.success_count,
      failed_count: batchResult.failed_count,
      db_errors: batchResult.failed_records.map((failure) => ({
        wms_id: failure.wms_id,
        row_index: failure.row_index,
        errors: [
          {
            field: 'database',
            code: 'DB_ERROR',
            message: failure.error,
          },
        ],
      })),
    };
  }

  /**
   * Process batch request (main orchestration method)
   * 
   * Flow:
   * 1. Validate all records (schema validation)
   * 2. If all invalid -> return failed response
   * 3. Process valid records through repository
   * 4. Combine validation errors + database errors
   * 5. Return comprehensive response
   * 
   * @param payload - Raw batch request payload
   * @returns API response with status and details
   */
  async processBatch(payload: unknown): Promise<WipBalanceApiResponse> {
    // Step 1: Validate batch
    const validation = this.validateBatch(payload);

    // Step 2: Check if all records are invalid
    if (validation.summary.valid_count === 0) {
      return {
        status: 'failed',
        message: 'All records failed validation',
        summary: {
          total_records: validation.summary.total_records,
          success_count: 0,
          failed_count: validation.summary.total_records,
        },
        validated_at: new Date().toISOString(),
        failed_records: validation.invalid_records,
      };
    }

    // Step 3: Process valid records through repository
    const processResult = await this.processValidRecords(validation.valid_records);

    // Step 4: Combine validation errors + database errors
    const allFailedRecords = [
      ...validation.invalid_records,
      ...processResult.db_errors,
    ];

    const totalSuccessCount = processResult.success_count;
    const totalFailedCount = allFailedRecords.length;
    const totalRecords = validation.summary.total_records;

    // Step 5: Determine response status
    let status: 'success' | 'partial_success' | 'failed';
    let message: string;

    if (totalFailedCount === 0) {
      status = 'success';
      message = 'All records validated and queued for processing';
    } else if (totalSuccessCount > 0) {
      status = 'partial_success';
      message = `${totalFailedCount} out of ${totalRecords} records failed validation`;
    } else {
      status = 'failed';
      message = 'All records failed validation or processing';
    }

    // Step 6: Build response
    const response: WipBalanceApiResponse = {
      status,
      message,
      summary: {
        total_records: totalRecords,
        success_count: totalSuccessCount,
        failed_count: totalFailedCount,
      },
      validated_at: new Date().toISOString(),
    };

    // Only include failed_records if there are failures
    if (totalFailedCount > 0) {
      response.failed_records = allFailedRecords;
    }

    return response;
  }

  /**
   * Get WIP balance by date (for verification)
   * 
   * @param company_code - Company code
   * @param stock_date - Stock date
   * @returns Array of WIP balance records
   */
  async getByDate(company_code: number, stock_date: Date) {
    return await wipBalanceRepository.findByDate(company_code, stock_date);
  }

  /**
   * Get WIP balance statistics
   * 
   * @param company_code - Company code
   * @param from_date - Start date
   * @param to_date - End date
   * @returns Statistics object
   */
  async getStatistics(company_code: number, from_date: Date, to_date: Date) {
    return await wipBalanceRepository.getStatistics(company_code, from_date, to_date);
  }
}

// Export singleton instance
export const wipBalanceService = new WipBalanceService();