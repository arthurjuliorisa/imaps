/**
 * iMAPS v2.4.2 - API Type Definitions
 *
 * Request and response types for all API endpoints.
 * Follows the WMS-iMAPS API Contract v2.4.2 specifications.
 */

import {
  IncomingHeader,
  IncomingDetail,
  OutgoingHeader,
  OutgoingDetail,
  MaterialUsageHeader,
  MaterialUsageDetail,
  FinishedGoodsProductionHeader,
  FinishedGoodsProductionDetail,
  WIPBalanceHeader,
  AdjustmentHeader,
  AdjustmentDetail,
  BeginningBalance
} from './transactions';

// ============================================================================
// GENERIC API TYPES
// ============================================================================

/**
 * Standard API Success Response
 */
export interface ApiSuccessResponse<T = any> {
  success: true;
  data: T;
  message?: string;
  timestamp: string;
}

/**
 * Standard API Error Response
 */
export interface ApiErrorResponse {
  success: false;
  error: string;
  message: string;
  code?: string;
  details?: Record<string, any>;
  timestamp: string;
}

/**
 * API Response (Union Type)
 */
export type ApiResponse<T = any> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Paginated Response
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    page_size: number;
    total_records: number;
    total_pages: number;
  };
  filters?: Record<string, any>;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
}

/**
 * Validation Error Detail
 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

// ============================================================================
// WMS API REQUEST TYPES (Incoming from WMS)
// ============================================================================

/**
 * Incoming Transaction Request (BC23, BC27, BC40)
 */
export interface IncomingTransactionRequest {
  header: Omit<IncomingHeader, 'id' | 'received_at' | 'created_at' | 'updated_at'>;
  details: Omit<IncomingDetail, 'id' | 'header_id' | 'created_at' | 'updated_at'>[];
}

/**
 * Outgoing Transaction Request (BC30, BC25, BC27, BC41)
 */
export interface OutgoingTransactionRequest {
  header: Omit<OutgoingHeader, 'id' | 'received_at' | 'created_at' | 'updated_at'>;
  details: Omit<OutgoingDetail, 'id' | 'header_id' | 'created_at' | 'updated_at'>[];
}

/**
 * Material Usage Request
 */
export interface MaterialUsageRequest {
  header: Omit<MaterialUsageHeader, 'id' | 'received_at' | 'created_at' | 'updated_at'>;
  details: Omit<MaterialUsageDetail, 'id' | 'header_id' | 'created_at' | 'updated_at'>[];
}

/**
 * Production Output Request
 */
export interface ProductionOutputRequest {
  header: Omit<FinishedGoodsProductionHeader, 'id' | 'received_at' | 'created_at' | 'updated_at'>;
  details: Omit<FinishedGoodsProductionDetail, 'id' | 'header_id' | 'created_at' | 'updated_at'>[];
}

/**
 * WIP Balance Request
 * Note: WIP Balance is a flat table (no header-detail pattern in DB)
 * But API still uses header-detail structure for consistency
 */
export interface WIPBalanceRequest {
  header: Omit<WIPBalanceHeader, 'id' | 'created_at' | 'updated_at'>;
  details: any[];  // WIP items
}

/**
 * Adjustment Request
 */
export interface AdjustmentRequest {
  header: Omit<AdjustmentHeader, 'id' | 'received_at' | 'created_at' | 'updated_at'>;
  details: Omit<AdjustmentDetail, 'id' | 'header_id' | 'created_at' | 'updated_at'>[];
}

// ============================================================================
// WMS API RESPONSE TYPES (Responses to WMS)
// ============================================================================

/**
 * Transaction Submission Response
 */
export interface TransactionSubmissionResponse {
  wms_id: string;
  imap_id: string;
  status: 'RECEIVED' | 'PROCESSED' | 'ERROR';
  message: string;
  validation_errors?: ValidationError[];
  received_at: string;
  processed_at?: string;
}

/**
 * Bulk Transaction Response
 */
export interface BulkTransactionResponse {
  total_received: number;
  successful: number;
  failed: number;
  results: TransactionSubmissionResponse[];
}

// ============================================================================
// FRONTEND API REQUEST TYPES
// ============================================================================

/**
 * List Query Parameters
 */
export interface ListQueryParams {
  page?: number;
  page_size?: number;
  company_code?: string;
  start_date?: string;  // ISO date string
  end_date?: string;    // ISO date string
  search?: string;
  sort_field?: string;
  sort_order?: 'asc' | 'desc';
}

/**
 * Transaction List Query Parameters
 */
export interface TransactionListParams extends ListQueryParams {
  customs_doc_type?: string;
  item_type_code?: string;
  item_code?: string;
}

/**
 * Beginning Balance Create/Update Request
 */
export interface BeginningBalanceRequest {
  company_code: number;
  item_type: string;
  item_code: string;
  item_name: string;
  uom: string;
  qty: number;
  balance_date: string;  // ISO date string
  remarks?: string;
  ppkek_numbers?: string[];
}

// ============================================================================
// DASHBOARD & REPORTS API TYPES
// ============================================================================

/**
 * Dashboard Metrics Response
 */
export interface DashboardMetrics {
  total_incoming_qty: number;
  total_outgoing_qty: number;
  total_production_qty: number;
  total_adjustments: number;
  period: {
    start_date: string;
    end_date: string;
  };
}

/**
 * Inventory Summary by Item Type
 */
export interface InventoryByItemType {
  item_type_code: string;
  total_qty: number;
  uom: string;
  value_amount?: number;
  percentage: number;
}

/**
 * Transaction Trends Data Point
 */
export interface TransactionTrendDataPoint {
  date: string;
  incoming_qty: number;
  outgoing_qty: number;
  production_qty: number;
}

/**
 * Recent Activity Log
 */
export interface RecentActivity {
  id: string;
  transaction_type: string;
  wms_id: string;
  company_code: string;
  trx_date: string;
  total_items: number;
  total_qty: number;
  created_at: string;
}

/**
 * Stock Daily Snapshot
 */
export interface StockDailySnapshot {
  snapshot_date: string;
  company_code: string;
  item_type_code: string;
  item_code: string;
  item_name: string;
  uom: string;
  beginning_balance: number;
  incoming_qty: number;
  outgoing_qty: number;
  adjustment_qty: number;
  ending_balance: number;
}

/**
 * PPKEK Traceability Chain
 */
export interface PPKEKTraceability {
  ppkek_number: string;
  company_code: string;

  // Import stage
  import_doc_number?: string;
  import_doc_date?: string;
  import_item_code?: string;
  import_item_name?: string;
  import_qty?: number;

  // Material usage stage
  material_usage_wms_id?: string;
  material_usage_date?: string;
  work_order_number?: string;
  consumed_qty?: number;

  // Production stage
  production_wms_id?: string;
  production_date?: string;
  produced_item_code?: string;
  produced_item_name?: string;
  produced_qty?: number;

  // Export stage
  export_doc_number?: string;
  export_doc_date?: string;
  export_qty?: number;

  status: 'COMPLETE' | 'PARTIAL' | 'PENDING';
}

/**
 * Work Order Summary
 */
export interface WorkOrderSummary {
  work_order_number: string;
  company_code: string;
  start_date: string;
  status: string;

  // Material usage
  total_materials_consumed: number;
  material_count: number;

  // Production output
  total_production_qty: number;
  finished_goods_count: number;
  scrap_qty: number;

  // Quality breakdown
  grade_a_qty: number;
  grade_b_qty: number;
  grade_c_qty: number;
  reject_qty: number;
}

// ============================================================================
// USER & ACCESS MANAGEMENT
// ============================================================================

/**
 * User Profile
 */
export interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: string;
  company_code: string;
  is_active: boolean;
  created_at: string;
}

/**
 * User with Permissions
 */
export interface UserWithPermissions extends UserProfile {
  permissions: MenuPermission[];
}

/**
 * Menu Permission
 */
export interface MenuPermission {
  menu_id: string;
  menu_name: string;
  route: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

/**
 * Activity Log
 */
export interface ActivityLog {
  id: string;
  user_id: string;
  username: string;
  action: string;
  description: string;
  ip_address?: string;
  user_agent?: string;
  status: string;
  created_at: string;
}

// ============================================================================
// IMPORT/EXPORT TYPES
// ============================================================================

/**
 * Import Result
 */
export interface ImportResult {
  total_rows: number;
  successful: number;
  failed: number;
  errors: Array<{
    row: number;
    field: string;
    message: string;
  }>;
  imported_ids?: string[];
}

/**
 * Export Parameters
 */
export interface ExportParams {
  format: 'xlsx' | 'csv' | 'pdf';
  start_date?: string;
  end_date?: string;
  company_code?: string;
  item_type_code?: string;
  filters?: Record<string, any>;
}
