/**
 * Standard API response types
 */

export interface SuccessResponse {
  status: 'success';
  message: string;
  wms_id: string;
  queued_items_count: number;
  validated_at: string;
}

export interface ErrorResponse {
  status: 'failed';
  message: string;
  wms_id: string;
  errors: ErrorDetail[];
}

export interface ErrorDetail {
  location: 'header' | 'item';
  field: string;
  code: string;
  message: string;
  item_index?: number;
  item_code?: string;
}

export interface BatchSuccessResponse {
  status: 'success' | 'partial_success' | 'failed';
  message: string;
  summary: {
    total_records: number;
    success_count: number;
    failed_count: number;
  };
  validated_at: string;
  failed_records?: BatchFailedRecord[];
}

export interface BatchFailedRecord {
  wms_id: string;
  row_index: number;
  errors: ErrorDetail[];
}