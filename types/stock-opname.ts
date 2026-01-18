/**
 * Stock Opname Type Definitions
 * Complete type definitions for Stock Opname feature
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Stock Opname Status
 */
export type StockOpnameStatus = 'OPEN' | 'PROCESS' | 'RELEASED';

// ============================================================================
// DATABASE MODELS (Prisma generated types)
// ============================================================================

/**
 * Stock Opname Header (from database)
 */
export interface StockOpname {
  id: number;
  sto_number: string;
  company_code: string;
  sto_datetime: string; // ISO timestamp
  pic_name: string | null;
  status: StockOpnameStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  _count?: {
    stock_opname_items: number;
  };
}

/**
 * Stock Opname Item (from database)
 */
export interface StockOpnameItem {
  id: number;
  stock_opname_id: number;
  company_code: number;
  item_code: string;
  item_name: string;
  item_type_code: string;
  uom: string;
  sto_qty: number; // Decimal stored as number
  end_stock: number; // Decimal stored as number
  variance: number; // Decimal stored as number
  report_area: string | null;
  sto_pic_name: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Item Master (for autocomplete)
 */
export interface ItemMaster {
  item_code: string;
  item_name: string;
  item_type_code: string;
  end_stock?: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Create Stock Opname Request
 */
export interface CreateStockOpnameRequest {
  company_code: number;
  sto_datetime: string; // ISO date string
  pic_name?: string;
  items: CreateStockOpnameItemRequest[];
}

/**
 * Create Stock Opname Item Request
 */
export interface CreateStockOpnameItemRequest {
  item_code: string;
  item_name: string;
  item_type: string;
  uom: string;
  sto_qty: number;
  end_stock: number;
  report_area?: string;
  remark?: string;
}

/**
 * Update Stock Opname Request
 */
export interface UpdateStockOpnameRequest {
  sto_datetime?: string; // ISO date string
  pic_name?: string;
  status?: StockOpnameStatus;
  items?: UpdateStockOpnameItemRequest[];
}

/**
 * Update Stock Opname Item Request
 */
export interface UpdateStockOpnameItemRequest {
  id?: bigint; // If updating existing item
  item_code: string;
  item_name: string;
  item_type: string;
  uom: string;
  sto_qty: number;
  end_stock: number;
  report_area?: string;
  remark?: string;
  deleted?: boolean; // Soft delete flag
}

/**
 * Stock Opname with Items Response
 */
export interface StockOpnameWithItems extends StockOpname {
  items: StockOpnameItem[];
  company_name?: string;
}

/**
 * Stock Opname List Item (for table display)
 */
export interface StockOpnameListItem {
  id: number;
  sto_number: string;
  company_code: number;
  company_name: string;
  sto_datetime: Date;
  pic_name: string | null;
  status: StockOpnameStatus;
  total_items: number;
  total_variants: number;
  created_by: string;
  created_at: Date;
}

// ============================================================================
// FILTER AND SEARCH TYPES
// ============================================================================

/**
 * Stock Opname Filter Options
 */
export interface StockOpnameFilters {
  company_code?: number;
  status?: StockOpnameStatus[];
  date_from?: string; // ISO date string
  date_to?: string; // ISO date string
  search?: string; // Search in STO number, PIC name
  created_by?: string;
}

/**
 * Stock Opname Item Filter Options
 */
export interface StockOpnameItemFilters {
  item_code?: string;
  item_type?: string[];
  has_variance?: boolean; // Filter items with variant != 0
  variance_type?: 'surplus' | 'shortage'; // variant > 0 or variant < 0
  search?: string; // Search in item code, item name
}

// ============================================================================
// FORM STATE TYPES
// ============================================================================

/**
 * Stock Opname Form State
 */
export interface StockOpnameFormState {
  sto_datetime: Date;
  pic_name: string;
  items: StockOpnameItemFormState[];
}

/**
 * Stock Opname Item Form State
 */
export interface StockOpnameItemFormState {
  id?: bigint; // For editing existing items
  item_code: string;
  item_name: string;
  item_type: string;
  uom: string;
  sto_qty: number;
  end_stock: number;
  variant: number;
  report_area: string;
  remark: string;
  isNew?: boolean; // Flag for newly added items
  isDeleted?: boolean; // Flag for soft deleted items
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Stock Opname Validation Error
 */
export interface StockOpnameValidationError {
  field: string;
  message: string;
  index?: number; // For item-level errors
}

/**
 * Stock Opname Validation Result
 */
export interface StockOpnameValidationResult {
  isValid: boolean;
  errors: StockOpnameValidationError[];
}

// ============================================================================
// STATISTICS AND REPORTING TYPES
// ============================================================================

/**
 * Stock Opname Summary Statistics
 */
export interface StockOpnameSummary {
  total_items: number;
  items_with_surplus: number;
  items_with_shortage: number;
  items_exact_match: number;
  total_surplus_qty: number;
  total_shortage_qty: number;
  accuracy_percentage: number;
}

/**
 * Stock Opname Report Data
 */
export interface StockOpnameReport {
  header: StockOpname;
  items: StockOpnameItem[];
  summary: StockOpnameSummary;
  company_name: string;
}

/**
 * Variance Analysis by Item Type
 */
export interface VarianceByItemType {
  item_type: string;
  total_items: number;
  total_sto_qty: number;
  total_end_stock: number;
  total_variant: number;
  accuracy_percentage: number;
}

// ============================================================================
// UI COMPONENT PROPS
// ============================================================================

/**
 * Stock Opname Table Row Data
 */
export interface StockOpnameTableRow {
  id: number;
  sto_number: string;
  sto_datetime: string; // Formatted date
  company_name: string;
  pic_name: string;
  status: StockOpnameStatus;
  total_items: number;
  total_variants: number;
  created_by: string;
  created_at: string; // Formatted date
}

/**
 * Stock Opname Item Table Row Data
 */
export interface StockOpnameItemTableRow {
  id: string; // Can be bigint as string
  item_code: string;
  item_name: string;
  item_type: string;
  uom: string;
  sto_qty: number;
  end_stock: number;
  variant: number;
  variance_percentage: number;
  report_area: string;
  remark: string;
}
