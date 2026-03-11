/**
 * WMS Stock Opname API Types
 * Defines request/response contracts for WMS Stock Opname endpoints
 */

import { WmsStockOpnameStatus } from '@prisma/client';

// ============================================================================
// REQUEST PAYLOADS
// ============================================================================

/**
 * Individual item in stock opname
 * Sent in both POST and PATCH requests
 * Per API Contract v3.3.0 Section 5.7
 */
export interface WmsStockOpnameItemPayload {
  item_code: string;
  item_name: string; // REQUIRED - as per contract
  item_type: string;
  uom: string;
  actual_qty_count?: number | null; // Optional for POST, required for PATCH Confirmed
  amount?: number | null; // Optional - only in PATCH Confirmed
}

/**
 * POST /api/v1/stock-opname request payload
 * Initiates a new stock opname with status="Active"
 * Per API Contract v3.3.0 Section 5.7.1
 */
export interface CreateStockOpnameRequest {
  wms_id: string; // External WMS identifier (unique per company)
  company_code: number; // Company identifier (integer)
  owner?: number | null; // Consignment owner code (optional)
  document_date: string; // ISO date format (YYYY-MM-DD)
  status?: 'Active'; // Always "Active" for POST (optional in request, defaults to Active)
  items: WmsStockOpnameItemPayload[];
  timestamp: string; // ISO 8601 datetime (REQUIRED per contract) - e.g., "2026-02-04T09:00:00Z"
}

/**
 * PATCH /api/v1/stock-opname request payload
 * Finalizes stock opname (transition to "Confirmed" or "Cancelled")
 * Per API Contract v3.3.0 Section 5.7.2
 */
export interface UpdateStockOpnameRequest {
  wms_id: string; // External WMS identifier - must match existing
  status: 'Confirmed' | 'Cancelled'; // As per contract: capitalized
  items?: WmsStockOpnameItemPayload[]; // Required for Confirmed, optional for Cancelled
  timestamp: string; // ISO 8601 datetime (REQUIRED per contract) - e.g., "2026-02-04T16:30:00Z"
}

// ============================================================================
// RESPONSE PAYLOADS
// ============================================================================

/**
 * Item detail in response
 */
export interface WmsStockOpnameItemResponse {
  id: bigint;
  item_code: string;
  item_name: string; // Added per contract
  item_type: string;
  uom: string;
  actual_qty_count: number | null; // Renamed from physical_qty per contract
  beginning_qty: number;
  incoming_qty_on_date: number;
  outgoing_qty_on_date: number;
  system_qty: number;
  variance_qty: number;
  adjustment_qty_signed: number; // Signed: negative=LOSS, positive=GAIN
  adjustment_type: string | null; // GAIN or LOSS
  amount?: number | null; // Added per contract for PATCH Confirmed responses
}

/**
 * Success response for POST /api/v1/stock-opname
 */
export interface CreateStockOpnameResponse {
  success: true;
  data: {
    id: bigint;
    wms_id: string;
    company_code: number;
    owner: number | null;
    document_date: string;
    status: string; // "Active", "Confirmed", "Cancelled" (capitalized per contract)
    items: WmsStockOpnameItemResponse[];
    created_at: string;
  };
  message: string;
}

/**
 * Success response for PATCH /api/v1/stock-opname
 */
export interface UpdateStockOpnameResponse {
  success: true;
  data: {
    id: bigint;
    wms_id: string;
    company_code: number;
    owner: number | null;
    document_date: string;
    status: string; // "Active", "Confirmed", "Cancelled" (capitalized per contract)
    items: WmsStockOpnameItemResponse[];
    confirmed_at?: string;
  };
  message: string;
}

/**
 * Error response structure
 */
export interface ErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

/**
 * Generic error response
 */
export interface StockOpnameErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: ErrorDetail[];
  };
}

// ============================================================================
// DATABASE MODELS (from Prisma)
// ============================================================================

/**
 * WMS Stock Opname header (from Prisma model)
 */
export interface WmsStockOpname {
  id: bigint;
  wms_id: string;
  company_code: string;
  owner: string | null;
  document_date: Date;
  status: WmsStockOpnameStatus;
  request_user: string;
  system_user: string | null;
  notes: string | null;
  data_checksum: string | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/**
 * WMS Stock Opname item detail (from Prisma model)
 */
export interface WmsStockOpnameItem {
  id: bigint;
  wms_stock_opname_id: bigint;
  item_code: string;
  item_type: string;
  counted_qty: number;
  counted_uom: string;
  beginning_qty: number;
  incoming_qty_on_date: number;
  outgoing_qty_on_date: number;
  system_qty: number;
  variance_qty: number;
  adjustment_qty_signed: number;
  notes: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

// ============================================================================
// SERVICE LAYER TYPES
// ============================================================================

/**
 * Internal representation for service layer processing
 */
export interface ProcessedStockOpnameItem {
  item_code: string;
  item_type: string;
  physical_qty: number;
  uom: string;
  beginning_qty: number;
  incoming_qty_on_date: number;
  outgoing_qty_on_date: number;
  system_qty: number;
  variance_qty: number;
  adjustment_qty_signed: number;
  adjustment_type: string | null;
  notes: string | null;
}

/**
 * Adjustment generation data
 */
export interface AdjustmentDetail {
  item_code: string;
  item_type: string;
  adjustment_type: 'GAIN' | 'LOSS';
  adjustment_qty: number;
  uom: string;
  notes?: string;
}

/**
 * Context for batch operations
 */
export interface BatchProcessingContext {
  stockOpnameId: bigint;
  companyCode: number;
  transactionDate: Date;
  wmsId: string;
  adjustmentDetails: AdjustmentDetail[];
}
