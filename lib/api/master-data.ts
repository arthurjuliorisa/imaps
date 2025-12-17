/**
 * Master Data API Services
 *
 * API service functions for master data entities.
 */

import { apiClient, buildQueryString } from './client';
import type {
  Company,
  ItemType,
  BeginningBalance,
  BeginningBalanceRequest,
  PaginatedResponse,
  ListQueryParams
} from '@/types/core';

// ============================================================================
// COMPANIES
// ============================================================================

/**
 * Get all companies
 */
export async function getCompanies(
  signal?: AbortSignal
): Promise<Company[]> {
  return apiClient.get<Company[]>('/master/companies', signal);
}

/**
 * Get company by code
 */
export async function getCompany(
  companyCode: string,
  signal?: AbortSignal
): Promise<Company> {
  return apiClient.get<Company>(`/master/companies/${companyCode}`, signal);
}

// ============================================================================
// ITEM TYPES
// ============================================================================

/**
 * Get all item types
 */
export async function getItemTypes(
  signal?: AbortSignal
): Promise<ItemType[]> {
  return apiClient.get<ItemType[]>('/master/item-types', signal);
}

/**
 * Get item type by code
 */
export async function getItemType(
  itemTypeCode: string,
  signal?: AbortSignal
): Promise<ItemType> {
  return apiClient.get<ItemType>(`/master/item-types/${itemTypeCode}`, signal);
}

// ============================================================================
// BEGINNING BALANCES
// ============================================================================

/**
 * Get beginning balances list
 */
export async function getBeginningBalances(
  params: ListQueryParams = {},
  signal?: AbortSignal
): Promise<PaginatedResponse<BeginningBalance>> {
  const queryString = buildQueryString(params);
  return apiClient.get<PaginatedResponse<BeginningBalance>>(
    `/master/beginning-balances${queryString}`,
    signal
  );
}

/**
 * Get beginning balance by ID
 */
export async function getBeginningBalance(
  id: string,
  signal?: AbortSignal
): Promise<BeginningBalance> {
  return apiClient.get<BeginningBalance>(
    `/master/beginning-balances/${id}`,
    signal
  );
}

/**
 * Create beginning balance
 */
export async function createBeginningBalance(
  data: BeginningBalanceRequest,
  signal?: AbortSignal
): Promise<BeginningBalance> {
  return apiClient.post<BeginningBalance>(
    '/master/beginning-balances',
    data,
    signal
  );
}

/**
 * Update beginning balance
 */
export async function updateBeginningBalance(
  id: string,
  data: BeginningBalanceRequest,
  signal?: AbortSignal
): Promise<BeginningBalance> {
  return apiClient.put<BeginningBalance>(
    `/master/beginning-balances/${id}`,
    data,
    signal
  );
}

/**
 * Delete beginning balance
 */
export async function deleteBeginningBalance(
  id: string,
  signal?: AbortSignal
): Promise<void> {
  return apiClient.delete<void>(`/master/beginning-balances/${id}`, signal);
}

/**
 * Import beginning balances from Excel
 */
export async function importBeginningBalances(
  file: File,
  signal?: AbortSignal
): Promise<{ success: boolean; imported: number; errors?: string[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/master/beginning-balances/import', {
    method: 'POST',
    body: formData,
    signal
  });

  if (!response.ok) {
    throw new Error('Import failed');
  }

  return response.json();
}

// ============================================================================
// ITEM SEARCH & AUTOCOMPLETE
// ============================================================================

/**
 * Search items across all transactions and beginning balances
 */
export async function searchItems(
  query: string,
  filters?: {
    company_code?: string;
    item_type_code?: string;
  },
  signal?: AbortSignal
): Promise<Array<{
  item_code: string;
  item_name: string;
  item_type_code: string;
  uom: string;
}>> {
  const params = { search: query, ...filters };
  const queryString = buildQueryString(params);
  return apiClient.get<Array<{
    item_code: string;
    item_name: string;
    item_type_code: string;
    uom: string;
  }>>(`/master/items/search${queryString}`, signal);
}

/**
 * Get distinct items from beginning balances
 */
export async function getDistinctItems(
  params?: {
    company_code?: string;
    item_type_code?: string;
  },
  signal?: AbortSignal
): Promise<Array<{
  item_code: string;
  item_name: string;
  item_type_code: string;
  uom: string;
}>> {
  const queryString = buildQueryString(params || {});
  return apiClient.get<Array<{
    item_code: string;
    item_name: string;
    item_type_code: string;
    uom: string;
  }>>(`/master/items${queryString}`, signal);
}

// ============================================================================
// PPKEK SEARCH
// ============================================================================

/**
 * Search PPKEK numbers with available stock
 */
export async function searchPPKEK(
  query: string,
  filters?: {
    company_code?: string;
    item_code?: string;
  },
  signal?: AbortSignal
): Promise<Array<{
  ppkek_number: string;
  item_code: string;
  item_name: string;
  available_qty: number;
  uom: string;
  import_date: string;
}>> {
  const params = { search: query, ...filters };
  const queryString = buildQueryString(params);
  return apiClient.get<Array<{
    ppkek_number: string;
    item_code: string;
    item_name: string;
    available_qty: number;
    uom: string;
    import_date: string;
  }>>(`/master/ppkek/search${queryString}`, signal);
}

// ============================================================================
// WORK ORDER SEARCH
// ============================================================================

/**
 * Search work orders
 */
export async function searchWorkOrders(
  query: string,
  filters?: {
    company_code?: string;
    status?: string;
  },
  signal?: AbortSignal
): Promise<Array<{
  work_order_number: string;
  target_item_code?: string;
  target_item_name?: string;
  status: string;
  start_date: string;
}>> {
  const params = { search: query, ...filters };
  const queryString = buildQueryString(params);
  return apiClient.get<Array<{
    work_order_number: string;
    target_item_code?: string;
    target_item_name?: string;
    status: string;
    start_date: string;
  }>>(`/master/work-orders/search${queryString}`, signal);
}
