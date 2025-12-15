// lib/types/wip-balance.types.ts

/**
 * WIP Balance Types
 * 
 * Purpose:
 * - Define types for WIP Balance endpoint
 * - Support batch processing with partial success
 * - Daily snapshot data structure
 * 
 * Business Context:
 * - WIP Balance = Work in Progress inventory snapshot
 * - Sent daily (End of Day)
 * - Complete replacement of previous day's data
 * - Item code refers to raw material being processed
 */

/**
 * Single WIP Balance record from WMS
 */
export interface WipBalanceRecord {
  wms_id: string;
  company_code: number;
  item_type: string;
  item_code: string;
  item_name: string;
  stock_date: Date;
  uom: string;
  qty: number;
  timestamp: Date;
}

/**
 * Batch request payload
 * Structure: Array of independent records
 */
export interface WipBalanceBatchRequest {
  records: WipBalanceRecord[];
}

/**
 * Single record validation error
 */
export interface WipBalanceRecordError {
  wms_id: string;
  row_index: number;
  errors: Array<{
    field: string;
    code: string;
    message: string;
  }>;
}

/**
 * Batch validation result
 */
export interface WipBalanceBatchValidationResult {
  valid_records: WipBalanceRecord[];
  invalid_records: WipBalanceRecordError[];
  summary: {
    total_records: number;
    valid_count: number;
    invalid_count: number;
  };
}

/**
 * Single record upsert result
 */
export interface WipBalanceUpsertResult {
  success: boolean;
  wms_id: string;
  record_id?: number;
  was_updated?: boolean;
  error?: string;
}

/**
 * Batch processing result
 */
export interface WipBalanceBatchResult {
  success_count: number;
  failed_count: number;
  failed_records: Array<{
    wms_id: string;
    row_index: number;
    error: string;
  }>;
}

/**
 * API Response for batch endpoint
 */
export interface WipBalanceApiResponse {
  status: 'success' | 'partial_success' | 'failed';
  message: string;
  summary: {
    total_records: number;
    success_count: number;
    failed_count: number;
  };
  validated_at: string;
  failed_records?: WipBalanceRecordError[];
}

/**
 * Statistics result
 */
export interface WipBalanceStatistics {
  total_records: number;
  unique_items: number;
  total_qty: number;
  by_item_type: Record<string, number>;
}
