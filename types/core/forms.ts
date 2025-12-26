/**
 * iMAPS v2.4.2 - Form Type Definitions
 *
 * TypeScript interfaces for form state management and validation.
 * Used by frontend forms for creating and editing transactions.
 */

import {
  ItemTypeCode,
  CustomsDocumentType,
  CurrencyCode,
  AdjustmentType,
  QualityGrade
} from './enums';

// ============================================================================
// FORM STATE MANAGEMENT
// ============================================================================

/**
 * Generic Form State
 */
export interface FormState<T> {
  data: Partial<T>;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  isValid: boolean;
  isDirty: boolean;
  isSubmitting: boolean;
}

/**
 * Form Field Error
 */
export interface FormFieldError {
  field: string;
  message: string;
}

/**
 * Validation Result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: FormFieldError[];
  warnings?: FormFieldError[];
}

// ============================================================================
// INCOMING TRANSACTION FORMS
// ============================================================================

/**
 * Incoming Header Form Data
 */
export interface IncomingHeaderFormData {
  wms_id: string;
  company_code: string;
  trx_date: Date | string;
  wms_timestamp: Date | string;
  customs_doc_type: CustomsDocumentType;
  customs_doc_number: string;
  customs_doc_date: Date | string;
  supplier_code?: string;
  supplier_name?: string;
  origin_country?: string;
  owner: string;
  pib_number?: string;
  pib_date?: Date | string;
  invoice_number?: string;
  invoice_date?: Date | string;
  bl_awb_number?: string;
  bl_awb_date?: Date | string;
  remarks?: string;
}

/**
 * Incoming Detail Form Data
 */
export interface IncomingDetailFormData {
  wms_id: string;
  item_code: string;
  item_name: string;
  item_type_code: ItemTypeCode;
  uom: string;
  qty: number;
  currency: CurrencyCode;
  amount: number;
  hs_code?: string;
  brand?: string;
  ppkek_number?: string;
}

/**
 * Incoming Transaction Form Data (Complete)
 */
export interface IncomingTransactionFormData {
  header: IncomingHeaderFormData;
  details: IncomingDetailFormData[];
}

// ============================================================================
// OUTGOING TRANSACTION FORMS
// ============================================================================

/**
 * Outgoing Header Form Data
 */
export interface OutgoingHeaderFormData {
  wms_id: string;
  company_code: string;
  trx_date: Date | string;
  wms_timestamp: Date | string;
  customs_doc_type: CustomsDocumentType;
  customs_doc_number: string;
  customs_doc_date: Date | string;
  ppkek_number: string;  // Required
  buyer_code?: string;
  buyer_name?: string;
  destination_country?: string;
  peb_number?: string;
  peb_date?: Date | string;
  invoice_number?: string;
  invoice_date?: Date | string;
  bl_awb_number?: string;
  bl_awb_date?: Date | string;
  remarks?: string;
}

/**
 * Outgoing Detail Form Data
 */
export interface OutgoingDetailFormData {
  wms_id: string;
  item_code: string;
  item_name: string;
  item_type_code: ItemTypeCode;
  uom: string;
  qty: number;
  currency: CurrencyCode;
  amount: number;
  hs_code?: string;
  brand?: string;
}

/**
 * Outgoing Transaction Form Data (Complete)
 */
export interface OutgoingTransactionFormData {
  header: OutgoingHeaderFormData;
  details: OutgoingDetailFormData[];
}

// ============================================================================
// MATERIAL USAGE FORMS
// ============================================================================

/**
 * Material Usage Header Form Data
 */
export interface MaterialUsageHeaderFormData {
  wms_id: string;
  company_code: string;
  trx_date: Date | string;
  wms_timestamp: Date | string;
  work_order_number: string;
  remarks?: string;
}

/**
 * Material Usage Detail Form Data
 */
export interface MaterialUsageDetailFormData {
  wms_id: string;
  item_code: string;
  item_name: string;
  item_type_code: ItemTypeCode;  // Only ROH or HALB
  uom: string;
  qty: number;
  ppkek_number: string;  // Required for traceability
  is_reversal: boolean;  // Material return
}

/**
 * Material Usage Form Data (Complete)
 */
export interface MaterialUsageFormData {
  header: MaterialUsageHeaderFormData;
  details: MaterialUsageDetailFormData[];
}

// ============================================================================
// PRODUCTION OUTPUT FORMS
// ============================================================================

/**
 * Production Header Form Data
 */
export interface ProductionHeaderFormData {
  wms_id: string;
  company_code: string;
  trx_date: Date | string;
  wms_timestamp: Date | string;
  work_order_number: string;
  remarks?: string;
}

/**
 * Production Detail Form Data
 */
export interface ProductionDetailFormData {
  wms_id: string;
  item_code: string;
  item_name: string;
  item_type_code: ItemTypeCode;  // Only FERT or SCRAP
  uom: string;
  qty: number;
  quality_grade?: QualityGrade;  // For FERT only
  work_order_numbers: string[];  // Can link to multiple work orders
  reversal_status: 'NORMAL' | 'REVERSED' | 'PARTIAL_REVERSAL';
}

/**
 * Production Form Data (Complete)
 */
export interface ProductionFormData {
  header: ProductionHeaderFormData;
  details: ProductionDetailFormData[];
}

// ============================================================================
// WIP BALANCE FORMS
// ============================================================================

/**
 * WIP Balance Header Form Data
 */
export interface WIPBalanceHeaderFormData {
  wms_id: string;
  company_code: string;
  trx_date: Date | string;
  wms_timestamp: Date | string;
  remarks?: string;
}

/**
 * WIP Balance Detail Form Data
 */
export interface WIPBalanceDetailFormData {
  wms_id: string;
  item_code: string;
  item_name: string;
  item_type_code: ItemTypeCode;  // Always HALB
  uom: string;
  qty: number;
  work_order_number: string;
}

/**
 * WIP Balance Form Data (Complete)
 */
export interface WIPBalanceFormData {
  header: WIPBalanceHeaderFormData;
  details: WIPBalanceDetailFormData[];
}

// ============================================================================
// ADJUSTMENT FORMS
// ============================================================================

/**
 * Adjustment Header Form Data
 */
export interface AdjustmentHeaderFormData {
  wms_id: string;
  company_code: string;
  trx_date: Date | string;
  wms_timestamp: Date | string;
  wms_doc_type?: string;
  internal_evidence_number: string;
  remarks?: string;
}

/**
 * Adjustment Detail Form Data
 */
export interface AdjustmentDetailFormData {
  wms_id: string;
  item_code: string;
  item_name: string;
  item_type_code: ItemTypeCode;
  uom: string;
  qty: number;  // Always positive
  adjustment_type: AdjustmentType;  // GAIN or LOSS
  reason?: string;
}

/**
 * Adjustment Form Data (Complete)
 */
export interface AdjustmentFormData {
  header: AdjustmentHeaderFormData;
  details: AdjustmentDetailFormData[];
}

// ============================================================================
// BEGINNING BALANCE FORMS
// ============================================================================

/**
 * Beginning Balance Form Data
 */
export interface BeginningBalanceFormData {
  company_code: string;
  item_type_code: ItemTypeCode;
  item_code: string;
  item_name: string;
  uom: string;
  qty: number;
  effective_date: Date | string;
  remarks?: string;
  ppkek_numbers?: string[];
}

// ============================================================================
// HELPER TYPES FOR AUTOCOMPLETE/SELECT
// ============================================================================

/**
 * Item Option for Autocomplete
 */
export interface ItemOption {
  item_code: string;
  item_name: string;
  item_type_code: ItemTypeCode;
  uom: string;
  hs_code?: string;
  brand?: string;
}

/**
 * Company Option
 */
export interface CompanyOption {
  company_code: string;
  company_name: string;
  is_active: boolean;
}

/**
 * PPKEK Option for Autocomplete
 */
export interface PPKEKOption {
  ppkek_number: string;
  item_code: string;
  item_name: string;
  available_qty: number;
  uom: string;
  import_date: string;
}

/**
 * Work Order Option
 */
export interface WorkOrderOption {
  work_order_number: string;
  target_item_code?: string;
  target_item_name?: string;
  status: string;
  start_date: string;
}

// ============================================================================
// MULTI-STEP FORM
// ============================================================================

/**
 * Form Step Configuration
 */
export interface FormStep {
  id: string;
  label: string;
  description?: string;
  isOptional?: boolean;
  isValid?: boolean;
}

/**
 * Multi-Step Form State
 */
export interface MultiStepFormState<T> {
  currentStep: number;
  steps: FormStep[];
  formData: Partial<T>;
  errors: Record<string, string>;
  isSubmitting: boolean;
}

// ============================================================================
// DATE RANGE & FILTERS
// ============================================================================

/**
 * Date Range
 */
export interface DateRange {
  start_date: Date | string | null;
  end_date: Date | string | null;
}

/**
 * Transaction Filters
 */
export interface TransactionFilters {
  company_code?: string;
  date_range?: DateRange;
  customs_doc_type?: string;
  item_type_code?: string;
  item_code?: string;
  search?: string;
}

/**
 * Table Sort Config
 */
export interface TableSortConfig {
  field: string;
  order: 'asc' | 'desc';
}

/**
 * Table Pagination Config
 */
export interface TablePaginationConfig {
  page: number;
  page_size: number;
  total_records: number;
}
