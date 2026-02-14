export enum INSWTransmissionStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export enum INSWTransactionType {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
  ADJUSTMENT = 'adjustment',
  STOCK_OPNAME = 'stock_opname',
  SALDO_AWAL = 'saldo_awal',
}

export interface INSWTransmissionRecord {
  id: number;
  wms_id: string;
  company_code: number;
  transaction_type: INSWTransactionType;
  insw_status: INSWTransmissionStatus;
  insw_sent_at: Date | null;
  insw_response: any | null;
  insw_error: string | null;
  insw_retry_count: number;
}

export interface INSWTransmitRequest {
  transaction_type: 'incoming' | 'outgoing' | 'adjustment';
  ids?: number[];
  wms_ids?: string[];
  auto_retry?: boolean;
}

export interface INSWTransmitResponse {
  status: 'success' | 'partial' | 'failed';
  message: string;
  total: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  results: INSWTransmitResult[];
}

export interface INSWTransmitResult {
  id: number;
  wms_id: string;
  status: 'success' | 'failed' | 'skipped';
  insw_status: INSWTransmissionStatus;
  insw_response?: any;
  error?: string;
}

export interface INSWBatchTransmitOptions {
  batchSize?: number;
  retryFailed?: boolean;
  maxRetries?: number;
  delayBetweenBatches?: number;
}
