// lib/types/api-response.types.ts

/**
 * Common API Response Types
 * 
 * These types ensure consistent response structure across all endpoints
 * as defined in WMS-iMAPS API Contract v2.4
 */

// ============================================================================
// SUCCESS RESPONSES
// ============================================================================

/**
 * Real-time endpoint success response
 * Used by: Incoming Goods, Material Usage, Production Output, Outgoing Goods, Adjustments
 */
export interface RealTimeSuccessResponse {
  status: 'success';
  message: string;
  wms_id: string;
  queued_items_count: number;
  validated_at: string; // ISO 8601 datetime
}

/**
 * Batch endpoint success response (all records valid)
 * Used by: WIP Balance
 */
export interface BatchSuccessResponse {
  status: 'success';
  message: string;
  summary: {
    total_records: number;
    success_count: number;
    failed_count: number;
  };
  validated_at: string; // ISO 8601 datetime
}

/**
 * Batch endpoint partial success response
 * Used by: WIP Balance
 */
export interface BatchPartialSuccessResponse {
  status: 'partial_success';
  message: string;
  summary: {
    total_records: number;
    success_count: number;
    failed_count: number;
  };
  validated_at: string;
  failed_records: FailedRecord[];
}

// ============================================================================
// ERROR RESPONSES
// ============================================================================

/**
 * Real-time endpoint error response
 */
export interface RealTimeErrorResponse {
  status: 'failed';
  message: string;
  wms_id: string;
  errors: ValidationError[];
}

/**
 * Batch endpoint error response (all failed)
 */
export interface BatchErrorResponse {
  status: 'failed';
  message: string;
  summary: {
    total_records: number;
    success_count: number;
    failed_count: number;
  };
  validated_at: string;
  failed_records: FailedRecord[];
}

/**
 * Generic error response (for auth, rate limit, etc.)
 */
export interface GenericErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  request_id?: string;
  timestamp: string;
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

/**
 * Validation error for real-time endpoints
 */
export interface ValidationError {
  location: 'header' | 'item';
  field: string;
  code: string;
  message: string;
  item_index?: number;
  item_code?: string;
}

/**
 * Failed record for batch endpoints
 */
export interface FailedRecord {
  wms_id: string;
  row_index: number;
  errors: FieldError[];
}

/**
 * Field-level error
 */
export interface FieldError {
  field: string;
  code: string;
  message: string;
}

// ============================================================================
// ERROR CODES (for consistent error handling)
// ============================================================================

export enum ErrorCode {
  // Authentication errors
  INVALID_API_KEY = 'INVALID_API_KEY',
  IP_NOT_WHITELISTED = 'IP_NOT_WHITELISTED',
  MISSING_API_KEY = 'MISSING_API_KEY',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // Validation errors
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT = 'INVALID_FORMAT',
  INVALID_VALUE = 'INVALID_VALUE',
  INVALID_DATE = 'INVALID_DATE',
  INVALID_COMPANY_CODE = 'INVALID_COMPANY_CODE',
  NOT_FOUND = 'NOT_FOUND',
  
  // Business logic errors
  DUPLICATE_WMS_ID = 'DUPLICATE_WMS_ID',
  FUTURE_DATE_NOT_ALLOWED = 'FUTURE_DATE_NOT_ALLOWED',
  NEGATIVE_QUANTITY = 'NEGATIVE_QUANTITY',
  
  // Payload errors
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  TOO_MANY_RECORDS = 'TOO_MANY_RECORDS',
  
  // Server errors
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isRealTimeSuccessResponse(
  response: any
): response is RealTimeSuccessResponse {
  return response.status === 'success' && 'wms_id' in response;
}

export function isBatchSuccessResponse(
  response: any
): response is BatchSuccessResponse | BatchPartialSuccessResponse {
  return (
    (response.status === 'success' || response.status === 'partial_success') &&
    'summary' in response
  );
}
