/**
 * iMAPS v2.4.2 - Type Definitions
 *
 * Main export file for all v2.4.2 type definitions.
 * Import from this file to get all types in one place.
 *
 * @example
 * ```typescript
 * import {
 *   ItemTypeCode,
 *   IncomingHeader,
 *   IncomingTransactionFormData,
 *   ApiResponse
 * } from '@/types/v2.4.2';
 * ```
 */

// ============================================================================
// ENUMS - Import first, then re-export
// ============================================================================
import {
  ItemTypeCode,
  CustomsDocumentTypeIncoming,
  CustomsDocumentTypeOutgoing,
  CurrencyCode,
  AdjustmentType,
  UserRole,
  QualityGrade,
  CalculationMethod,
  TransactionType,
  DocumentStatus,
  ReversalStatus,
  JobType,
  JobStatus,
  // Type guards and utilities
  isCapitalGoods,
  usesTransactionCalculation,
  usesWIPSnapshotCalculation,
  getCalculationMethod
} from './enums';

// Re-export for consumers
export {
  ItemTypeCode,
  CustomsDocumentTypeIncoming,
  CustomsDocumentTypeOutgoing,
  CurrencyCode,
  AdjustmentType,
  UserRole,
  QualityGrade,
  CalculationMethod,
  TransactionType,
  DocumentStatus,
  ReversalStatus,
  JobType,
  JobStatus,
  isCapitalGoods,
  usesTransactionCalculation,
  usesWIPSnapshotCalculation,
  getCalculationMethod
};

// ============================================================================
// TRANSACTIONS
// ============================================================================
export type {
  // Base types
  BaseHeader,
  BaseDetail,

  // Incoming
  IncomingHeader,
  IncomingDetail,

  // Outgoing
  OutgoingHeader,
  OutgoingDetail,

  // Material Usage
  MaterialUsageHeader,
  MaterialUsageDetail,

  // Production
  FinishedGoodsProductionHeader,
  FinishedGoodsProductionDetail,

  // WIP Balance
  WIPBalanceHeader,
  WIPBalanceDetail,

  // Adjustments
  AdjustmentHeader,
  AdjustmentDetail,

  // Master Data
  BeginningBalance,
  Company,
  ItemType,

  // Traceability
  WorkOrderItemLinkage,
  OutgoingItemLinkage,
  FinishedGoodsWorkOrderLinkage,

  // Union types
  AnyHeader,
  AnyDetail,
  TransactionWithDetails
} from './transactions';

// ============================================================================
// API TYPES
// ============================================================================
export type {
  // Generic API responses
  ApiSuccessResponse,
  ApiErrorResponse,
  ApiResponse,
  PaginatedResponse,
  ValidationError,

  // WMS API requests
  IncomingTransactionRequest,
  OutgoingTransactionRequest,
  MaterialUsageRequest,
  ProductionOutputRequest,
  WIPBalanceRequest,
  AdjustmentRequest,

  // WMS API responses
  TransactionSubmissionResponse,
  BulkTransactionResponse,

  // Frontend API requests
  ListQueryParams,
  TransactionListParams,
  BeginningBalanceRequest,

  // Dashboard & Reports
  DashboardMetrics,
  InventoryByItemType,
  TransactionTrendDataPoint,
  RecentActivity,
  StockDailySnapshot,
  PPKEKTraceability,
  WorkOrderSummary,

  // Batch processing
  BatchJobStatus,
  MaterializedViewRefreshResponse,

  // User & Access
  UserProfile,
  UserWithPermissions,
  MenuPermission,
  ActivityLog,

  // Import/Export
  ImportResult,
  ExportParams
} from './api';

// ============================================================================
// FORMS
// ============================================================================
export type {
  // Form state management
  FormState,
  FormFieldError,
  ValidationResult,

  // Incoming forms
  IncomingHeaderFormData,
  IncomingDetailFormData,
  IncomingTransactionFormData,

  // Outgoing forms
  OutgoingHeaderFormData,
  OutgoingDetailFormData,
  OutgoingTransactionFormData,

  // Material Usage forms
  MaterialUsageHeaderFormData,
  MaterialUsageDetailFormData,
  MaterialUsageFormData,

  // Production forms
  ProductionHeaderFormData,
  ProductionDetailFormData,
  ProductionFormData,

  // WIP Balance forms
  WIPBalanceHeaderFormData,
  WIPBalanceDetailFormData,
  WIPBalanceFormData,

  // Adjustment forms
  AdjustmentHeaderFormData,
  AdjustmentDetailFormData,
  AdjustmentFormData,

  // Beginning Balance forms
  BeginningBalanceFormData,

  // Helper types for UI
  ItemOption,
  CompanyOption,
  PPKEKOption,
  WorkOrderOption,

  // Multi-step forms
  FormStep,
  MultiStepFormState,

  // Filters and pagination
  DateRange,
  TransactionFilters,
  TableSortConfig,
  TablePaginationConfig
} from './forms';

// ============================================================================
// CONSTANTS
// ============================================================================
export {
  ITEM_TYPE_LABELS,
  CURRENCY_LABELS,
  CURRENCY_SYMBOLS,
  INCOMING_DOC_TYPE_LABELS,
  OUTGOING_DOC_TYPE_LABELS,
  ADJUSTMENT_TYPE_LABELS,
  QUALITY_GRADE_LABELS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  DATE_DISPLAY_FORMAT,
  DATETIME_DISPLAY_FORMAT,
  DATE_API_FORMAT,
  DATETIME_API_FORMAT
} from './constants';
