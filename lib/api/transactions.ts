/**
 * Transaction API Services
 *
 * API service functions for all transaction types in v2.4.2.
 */

import { apiClient, buildQueryString } from './client';
import type {
  IncomingHeader,
  OutgoingHeader,
  MaterialUsageHeader,
  FinishedGoodsProductionHeader,
  WIPBalanceHeader,
  AdjustmentHeader,
  IncomingTransactionRequest,
  OutgoingTransactionRequest,
  MaterialUsageRequest,
  ProductionOutputRequest,
  WIPBalanceRequest,
  AdjustmentRequest,
  TransactionSubmissionResponse,
  PaginatedResponse,
  TransactionListParams
} from '@/types/core';

// ============================================================================
// INCOMING TRANSACTIONS
// ============================================================================

/**
 * Get incoming transactions list
 */
export async function getIncomingTransactions(
  params: TransactionListParams = {},
  signal?: AbortSignal
): Promise<PaginatedResponse<IncomingHeader>> {
  const queryString = buildQueryString(params);
  return apiClient.get<PaginatedResponse<IncomingHeader>>(
    `/wms/incoming${queryString}`,
    signal
  );
}

/**
 * Get incoming transaction by ID
 */
export async function getIncomingTransaction(
  id: string,
  signal?: AbortSignal
): Promise<IncomingHeader> {
  return apiClient.get<IncomingHeader>(`/wms/incoming/${id}`, signal);
}

/**
 * Create incoming transaction
 */
export async function createIncomingTransaction(
  data: IncomingTransactionRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.post<TransactionSubmissionResponse>(
    '/wms/incoming',
    data,
    signal
  );
}

/**
 * Update incoming transaction
 */
export async function updateIncomingTransaction(
  id: string,
  data: IncomingTransactionRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.put<TransactionSubmissionResponse>(
    `/wms/incoming/${id}`,
    data,
    signal
  );
}

/**
 * Delete incoming transaction
 */
export async function deleteIncomingTransaction(
  id: string,
  signal?: AbortSignal
): Promise<void> {
  return apiClient.delete<void>(`/wms/incoming/${id}`, signal);
}

// ============================================================================
// OUTGOING TRANSACTIONS
// ============================================================================

/**
 * Get outgoing transactions list
 */
export async function getOutgoingTransactions(
  params: TransactionListParams = {},
  signal?: AbortSignal
): Promise<PaginatedResponse<OutgoingHeader>> {
  const queryString = buildQueryString(params);
  return apiClient.get<PaginatedResponse<OutgoingHeader>>(
    `/wms/outgoing${queryString}`,
    signal
  );
}

/**
 * Get outgoing transaction by ID
 */
export async function getOutgoingTransaction(
  id: string,
  signal?: AbortSignal
): Promise<OutgoingHeader> {
  return apiClient.get<OutgoingHeader>(`/wms/outgoing/${id}`, signal);
}

/**
 * Create outgoing transaction
 */
export async function createOutgoingTransaction(
  data: OutgoingTransactionRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.post<TransactionSubmissionResponse>(
    '/wms/outgoing',
    data,
    signal
  );
}

/**
 * Update outgoing transaction
 */
export async function updateOutgoingTransaction(
  id: string,
  data: OutgoingTransactionRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.put<TransactionSubmissionResponse>(
    `/wms/outgoing/${id}`,
    data,
    signal
  );
}

/**
 * Delete outgoing transaction
 */
export async function deleteOutgoingTransaction(
  id: string,
  signal?: AbortSignal
): Promise<void> {
  return apiClient.delete<void>(`/wms/outgoing/${id}`, signal);
}

// ============================================================================
// MATERIAL USAGE
// ============================================================================

/**
 * Get material usage transactions list
 */
export async function getMaterialUsageTransactions(
  params: TransactionListParams = {},
  signal?: AbortSignal
): Promise<PaginatedResponse<MaterialUsageHeader>> {
  const queryString = buildQueryString(params);
  return apiClient.get<PaginatedResponse<MaterialUsageHeader>>(
    `/wms/material-usage${queryString}`,
    signal
  );
}

/**
 * Get material usage transaction by ID
 */
export async function getMaterialUsageTransaction(
  id: string,
  signal?: AbortSignal
): Promise<MaterialUsageHeader> {
  return apiClient.get<MaterialUsageHeader>(`/wms/material-usage/${id}`, signal);
}

/**
 * Create material usage transaction
 */
export async function createMaterialUsageTransaction(
  data: MaterialUsageRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.post<TransactionSubmissionResponse>(
    '/wms/material-usage',
    data,
    signal
  );
}

/**
 * Update material usage transaction
 */
export async function updateMaterialUsageTransaction(
  id: string,
  data: MaterialUsageRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.put<TransactionSubmissionResponse>(
    `/wms/material-usage/${id}`,
    data,
    signal
  );
}

/**
 * Delete material usage transaction
 */
export async function deleteMaterialUsageTransaction(
  id: string,
  signal?: AbortSignal
): Promise<void> {
  return apiClient.delete<void>(`/wms/material-usage/${id}`, signal);
}

// ============================================================================
// PRODUCTION OUTPUT
// ============================================================================

/**
 * Get production transactions list
 */
export async function getProductionTransactions(
  params: TransactionListParams = {},
  signal?: AbortSignal
): Promise<PaginatedResponse<FinishedGoodsProductionHeader>> {
  const queryString = buildQueryString(params);
  return apiClient.get<PaginatedResponse<FinishedGoodsProductionHeader>>(
    `/wms/production${queryString}`,
    signal
  );
}

/**
 * Get production transaction by ID
 */
export async function getProductionTransaction(
  id: string,
  signal?: AbortSignal
): Promise<FinishedGoodsProductionHeader> {
  return apiClient.get<FinishedGoodsProductionHeader>(`/wms/production/${id}`, signal);
}

/**
 * Create production transaction
 */
export async function createProductionTransaction(
  data: ProductionOutputRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.post<TransactionSubmissionResponse>(
    '/wms/production',
    data,
    signal
  );
}

/**
 * Update production transaction
 */
export async function updateProductionTransaction(
  id: string,
  data: ProductionOutputRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.put<TransactionSubmissionResponse>(
    `/wms/production/${id}`,
    data,
    signal
  );
}

/**
 * Delete production transaction
 */
export async function deleteProductionTransaction(
  id: string,
  signal?: AbortSignal
): Promise<void> {
  return apiClient.delete<void>(`/wms/production/${id}`, signal);
}

// ============================================================================
// WIP BALANCE
// ============================================================================

/**
 * Get WIP balance transactions list
 */
export async function getWIPBalanceTransactions(
  params: TransactionListParams = {},
  signal?: AbortSignal
): Promise<PaginatedResponse<WIPBalanceHeader>> {
  const queryString = buildQueryString(params);
  return apiClient.get<PaginatedResponse<WIPBalanceHeader>>(
    `/wms/wip-balance${queryString}`,
    signal
  );
}

/**
 * Get WIP balance transaction by ID
 */
export async function getWIPBalanceTransaction(
  id: string,
  signal?: AbortSignal
): Promise<WIPBalanceHeader> {
  return apiClient.get<WIPBalanceHeader>(`/wms/wip-balance/${id}`, signal);
}

/**
 * Create WIP balance transaction
 */
export async function createWIPBalanceTransaction(
  data: WIPBalanceRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.post<TransactionSubmissionResponse>(
    '/wms/wip-balance',
    data,
    signal
  );
}

/**
 * Update WIP balance transaction
 */
export async function updateWIPBalanceTransaction(
  id: string,
  data: WIPBalanceRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.put<TransactionSubmissionResponse>(
    `/wms/wip-balance/${id}`,
    data,
    signal
  );
}

/**
 * Delete WIP balance transaction
 */
export async function deleteWIPBalanceTransaction(
  id: string,
  signal?: AbortSignal
): Promise<void> {
  return apiClient.delete<void>(`/wms/wip-balance/${id}`, signal);
}

// ============================================================================
// ADJUSTMENTS
// ============================================================================

/**
 * Get adjustment transactions list
 */
export async function getAdjustmentTransactions(
  params: TransactionListParams = {},
  signal?: AbortSignal
): Promise<PaginatedResponse<AdjustmentHeader>> {
  const queryString = buildQueryString(params);
  return apiClient.get<PaginatedResponse<AdjustmentHeader>>(
    `/wms/adjustments${queryString}`,
    signal
  );
}

/**
 * Get adjustment transaction by ID
 */
export async function getAdjustmentTransaction(
  id: string,
  signal?: AbortSignal
): Promise<AdjustmentHeader> {
  return apiClient.get<AdjustmentHeader>(`/wms/adjustments/${id}`, signal);
}

/**
 * Create adjustment transaction
 */
export async function createAdjustmentTransaction(
  data: AdjustmentRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.post<TransactionSubmissionResponse>(
    '/wms/adjustments',
    data,
    signal
  );
}

/**
 * Update adjustment transaction
 */
export async function updateAdjustmentTransaction(
  id: string,
  data: AdjustmentRequest,
  signal?: AbortSignal
): Promise<TransactionSubmissionResponse> {
  return apiClient.put<TransactionSubmissionResponse>(
    `/wms/adjustments/${id}`,
    data,
    signal
  );
}

/**
 * Delete adjustment transaction
 */
export async function deleteAdjustmentTransaction(
  id: string,
  signal?: AbortSignal
): Promise<void> {
  return apiClient.delete<void>(`/wms/adjustments/${id}`, signal);
}
