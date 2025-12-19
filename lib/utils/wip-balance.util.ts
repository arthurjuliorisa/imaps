/**
 * WIP Balance Helper Utilities
 * 
 * Purpose:
 * - Utility functions for WIP Balance API operations
 * - Validation helpers
 * - Response builders
 * - Error handlers
 */

import {
  WipBalanceRecordError,
  WipBalanceApiResponse,
} from '@/lib/types/wip-balance.types';

/**
 * Build error response for batch processing
 */
export function buildErrorResponse(
  failedRecords: WipBalanceRecordError[],
  totalRecords: number,
  successCount: number
): WipBalanceApiResponse {
  const failedCount = failedRecords.length;

  const status =
    failedCount === totalRecords
      ? 'failed'
      : failedCount > 0
        ? 'partial_success'
        : 'success';

  const message =
    status === 'success'
      ? 'All records validated and queued for processing'
      : status === 'partial_success'
        ? `${failedCount} out of ${totalRecords} records failed validation`
        : `All ${totalRecords} records failed validation`;

  const response: WipBalanceApiResponse = {
    status,
    message,
    summary: {
      total_records: totalRecords,
      success_count: successCount,
      failed_count: failedCount,
    },
    validated_at: new Date().toISOString(),
  };

  if (failedCount > 0) {
    response.failed_records = failedRecords;
  }

  return response;
}

/**
 * Parse Zod validation errors into field-specific error format
 */
export function parseValidationErrors(
  zodError: any,
  records: any[]
): WipBalanceRecordError[] {
  const errors: WipBalanceRecordError[] = [];

  zodError.errors.forEach((err: any) => {
    const pathParts = err.path || [];
    let rowIndex = 0;
    let field = 'unknown';

    // Extract row index and field name from path
    if (pathParts.length > 0) {
      if (pathParts[0] === 'records' && pathParts[1] !== undefined) {
        rowIndex = (pathParts[1] as number) + 1;
        field = (pathParts[2] as string) || 'unknown';
      } else {
        field = pathParts.join('.');
      }
    }

    const wmsId = records[rowIndex - 1]?.wms_id || `ERROR_${rowIndex}`;

    // Find or create error entry for this record
    let errorRecord = errors.find((e) => e.wms_id === wmsId);
    if (!errorRecord) {
      errorRecord = {
        wms_id: wmsId,
        row_index: rowIndex,
        errors: [],
      };
      errors.push(errorRecord);
    }

    // Add field error
    errorRecord.errors.push({
      field,
      code: err.code || 'VALIDATION_ERROR',
      message: err.message,
    });
  });

  return errors;
}

/**
 * Format date for API response (ISO 8601)
 */
export function formatDateForResponse(date: Date): string {
  return date.toISOString();
}

/**
 * Validate request size
 * Max 20 MB payload
 */
export function validatePayloadSize(
  payload: any
): { valid: boolean; error?: string } {
  try {
    const size = JSON.stringify(payload).length;
    const maxSize = 20 * 1024 * 1024; // 20 MB

    if (size > maxSize) {
      return {
        valid: false,
        error: `Payload size (${(size / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed (20 MB)`,
      };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Failed to validate payload size' };
  }
}

/**
 * Validate record count
 */
export function validateRecordCount(
  records: any[]
): { valid: boolean; error?: string } {
  if (records.length === 0) {
    return {
      valid: false,
      error: 'At least one record is required',
    };
  }

  if (records.length > 50000) {
    return {
      valid: false,
      error: `Record count (${records.length}) exceeds recommended maximum (50,000)`,
    };
  }

  return { valid: true };
}

/**
 * Check for duplicate wms_id values
 */
export function checkDuplicateWmsIds(
  records: any[]
): { valid: boolean; error?: string; duplicates?: string[] } {
  const wmsIds = records.map((r) => r.wms_id);
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const wmsId of wmsIds) {
    if (seen.has(wmsId)) {
      if (!duplicates.includes(wmsId)) {
        duplicates.push(wmsId);
      }
    }
    seen.add(wmsId);
  }

  if (duplicates.length > 0) {
    return {
      valid: false,
      error: `Duplicate wms_id values found: ${duplicates.join(', ')}`,
      duplicates,
    };
  }

  return { valid: true };
}

/**
 * Calculate batch processing statistics
 */
export function calculateBatchStats(records: any[]): {
  total_records: number;
  by_company: Record<number, number>;
  by_item_type: Record<string, number>;
  date_range: { earliest: string; latest: string };
} {
  const byCompany: Record<number, number> = {};
  const byItemType: Record<string, number> = {};
  const dates: Date[] = [];

  for (const record of records) {
    // By company
    byCompany[record.company_code] =
      (byCompany[record.company_code] || 0) + 1;

    // By item type
    byItemType[record.item_type] = (byItemType[record.item_type] || 0) + 1;

    // Dates
    dates.push(new Date(record.stock_date));
  }

  dates.sort((a, b) => a.getTime() - b.getTime());

  return {
    total_records: records.length,
    by_company: byCompany,
    by_item_type: byItemType,
    date_range: {
      earliest: dates[0]?.toISOString().split('T')[0] || '',
      latest: dates[dates.length - 1]?.toISOString().split('T')[0] || '',
    },
  };
}
