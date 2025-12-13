/**
 * Stock Calculation Types
 *
 * Comprehensive TypeScript type definitions for the stock calculation system.
 * These types support customs document processing, inventory management,
 * and stock calculations across various document types.
 */

// ============================================================================
// ENUMS AND LITERAL TYPES
// ============================================================================

/**
 * Item Type Codes
 * Represents the classification of items in the inventory system
 */
export type ItemTypeCode = 'RM' | 'WIP' | 'FG' | 'SCRAP' | 'WASTE';

/**
 * Customs Document Types
 * All supported customs document types in the system
 */
export type CustomsDocumentType =
  | 'BC23'      // Import Declaration (Inbound)
  | 'BC25'      // Conversion to Free Zone
  | 'BC27'      // Export Declaration (Outbound)
  | 'BC28'      // Material Return
  | 'BC30'      // Destruction Document
  | 'BC41'      // Material Transfer Out
  | 'BC40'      // Material Transfer In
  | 'MUTATION'; // Internal Mutation

/**
 * Calculation Methods
 * Methods for calculating stock quantities
 */
export type CalculationMethod =
  | 'FIFO'      // First In First Out
  | 'LIFO'      // Last In First Out
  | 'AVERAGE'   // Weighted Average
  | 'MANUAL';   // Manual Selection

/**
 * Adjustment Types
 * Types of stock adjustments
 */
export type AdjustmentType =
  | 'OPNAME'           // Stock Opname/Physical Count
  | 'CORRECTION'       // Stock Correction
  | 'SCRAP'            // Scrap/Waste
  | 'DAMAGE'           // Damaged Goods
  | 'EXPIRED'          // Expired Items
  | 'FOUND'            // Found Items
  | 'LOST'             // Lost/Missing Items
  | 'CONVERSION'       // Type Conversion
  | 'SYSTEM';          // System Adjustment

/**
 * Document Status
 * Status of documents in the system
 */
export type DocumentStatus =
  | 'DRAFT'            // Draft - not yet submitted
  | 'PENDING'          // Pending approval
  | 'APPROVED'         // Approved
  | 'REJECTED'         // Rejected
  | 'CANCELLED'        // Cancelled
  | 'COMPLETED';       // Completed/Posted

/**
 * Transaction Type
 * Type of inventory transaction
 */
export type TransactionType =
  | 'IN'               // Inbound
  | 'OUT'              // Outbound
  | 'ADJUSTMENT'       // Adjustment
  | 'TRANSFER';        // Transfer

/**
 * Stock Status
 * Status of stock items
 */
export type StockStatus =
  | 'AVAILABLE'        // Available for use
  | 'RESERVED'         // Reserved for order
  | 'QUARANTINE'       // In quarantine
  | 'BLOCKED'          // Blocked from use
  | 'EXPIRED';         // Expired

// ============================================================================
// BASE INTERFACES
// ============================================================================

/**
 * Base Entity
 * Common fields for all entities
 */
export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

/**
 * Audit Fields
 * Common audit fields
 */
export interface AuditFields {
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

// ============================================================================
// DOCUMENT INTERFACES
// ============================================================================

/**
 * Document Header
 * Base interface for all customs document headers
 */
export interface DocumentHeader extends BaseEntity {
  documentNumber: string;
  documentDate: Date;
  documentType: CustomsDocumentType;
  referenceNumber?: string;
  referenceDate?: Date;
  status: DocumentStatus;
  notes?: string;
  attachments?: DocumentAttachment[];
  approvalHistory?: ApprovalHistory[];
}

/**
 * Document Item
 * Base interface for all document line items
 */
export interface DocumentItem extends BaseEntity {
  documentId: string;
  lineNumber: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemTypeCode;
  specification?: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  totalPrice?: number;
  hsCode?: string;
  countryOfOrigin?: string;
  notes?: string;
}

/**
 * Document Attachment
 * Attachments for documents
 */
export interface DocumentAttachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;
  uploadedAt: Date;
  uploadedBy: string;
}

/**
 * Approval History
 * Tracks document approval workflow
 */
export interface ApprovalHistory {
  id: string;
  documentId: string;
  approverName: string;
  approverRole: string;
  action: 'APPROVED' | 'REJECTED' | 'RETURNED';
  comments?: string;
  approvedAt: Date;
}

// ============================================================================
// BC23 - IMPORT DECLARATION (INBOUND)
// ============================================================================

/**
 * BC23 Document Header
 * Import declaration header
 */
export interface BC23Header extends DocumentHeader {
  documentType: 'BC23';
  bcNumber: string;
  bcDate: Date;
  supplierName: string;
  supplierAddress?: string;
  supplierCountry: string;
  invoiceNumber: string;
  invoiceDate: Date;
  invoiceValue: number;
  currency: string;
  exchangeRate: number;
  portOfLoading?: string;
  portOfDischarge?: string;
  vesselName?: string;
  billOfLadingNumber?: string;
  containerNumbers?: string[];
  customsOfficer?: string;
  items: BC23Item[];
}

/**
 * BC23 Document Item
 * Import declaration line item
 */
export interface BC23Item extends DocumentItem {
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  hsCode: string;
  countryOfOrigin: string;
  dutyRate?: number;
  dutyAmount?: number;
  taxRate?: number;
  taxAmount?: number;
}

// ============================================================================
// BC27 - EXPORT DECLARATION (OUTBOUND)
// ============================================================================

/**
 * BC27 Document Header
 * Export declaration header
 */
export interface BC27Header extends DocumentHeader {
  documentType: 'BC27';
  bcNumber: string;
  bcDate: Date;
  buyerName: string;
  buyerAddress?: string;
  buyerCountry: string;
  invoiceNumber: string;
  invoiceDate: Date;
  invoiceValue: number;
  currency: string;
  exchangeRate: number;
  portOfLoading?: string;
  destinationPort?: string;
  vesselName?: string;
  expectedShipmentDate?: Date;
  customsOfficer?: string;
  items: BC27Item[];
}

/**
 * BC27 Document Item
 * Export declaration line item with BOM linkage
 */
export interface BC27Item extends DocumentItem {
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  hsCode: string;
  bomId?: string;
  linkedMaterials?: LinkedMaterial[];
}

/**
 * Linked Material
 * Raw materials linked to finished goods for BC27
 */
export interface LinkedMaterial {
  id: string;
  rawMaterialId: string;
  rawMaterialCode: string;
  rawMaterialName: string;
  requiredQuantity: number;
  unit: string;
  bc23Reference?: string;
  stockSelectionMethod: CalculationMethod;
  selectedStockItems?: SelectedStockItem[];
}

/**
 * Selected Stock Item
 * Specific stock items selected for usage
 */
export interface SelectedStockItem {
  stockId: string;
  bc23Reference: string;
  quantity: number;
  unit: string;
  selectedAt: Date;
  selectedBy: string;
}

// ============================================================================
// BC40/BC41 - MATERIAL TRANSFER
// ============================================================================

/**
 * BC40 Document Header
 * Material Transfer In (from other bonded zone)
 */
export interface BC40Header extends DocumentHeader {
  documentType: 'BC40';
  bcNumber: string;
  bcDate: Date;
  sourceCompanyName: string;
  sourceNppbkc?: string;
  sourceAddress?: string;
  bc41Reference: string;
  bc41Date: Date;
  transportDetails?: string;
  items: BC40Item[];
}

/**
 * BC40 Document Item
 */
export interface BC40Item extends DocumentItem {
  quantity: number;
  unit: string;
  bc41ItemReference?: string;
}

/**
 * BC41 Document Header
 * Material Transfer Out (to other bonded zone)
 */
export interface BC41Header extends DocumentHeader {
  documentType: 'BC41';
  bcNumber: string;
  bcDate: Date;
  destinationCompanyName: string;
  destinationNppbkc?: string;
  destinationAddress?: string;
  transportDetails?: string;
  expectedArrivalDate?: Date;
  items: BC41Item[];
}

/**
 * BC41 Document Item
 */
export interface BC41Item extends DocumentItem {
  quantity: number;
  unit: string;
  originalBC23Reference?: string;
}

// ============================================================================
// BC28 - MATERIAL RETURN
// ============================================================================

/**
 * BC28 Document Header
 * Material return to supplier
 */
export interface BC28Header extends DocumentHeader {
  documentType: 'BC28';
  bcNumber: string;
  bcDate: Date;
  supplierName: string;
  supplierAddress?: string;
  originalBC23Reference: string;
  originalBC23Date: Date;
  returnReason: string;
  items: BC28Item[];
}

/**
 * BC28 Document Item
 */
export interface BC28Item extends DocumentItem {
  quantity: number;
  unit: string;
  originalBC23ItemReference?: string;
  returnReason?: string;
}

// ============================================================================
// BC30 - DESTRUCTION DOCUMENT
// ============================================================================

/**
 * BC30 Document Header
 * Destruction of materials/goods
 */
export interface BC30Header extends DocumentHeader {
  documentType: 'BC30';
  bcNumber: string;
  bcDate: Date;
  destructionMethod: string;
  destructionLocation: string;
  destructionDate: Date;
  witnessName?: string;
  witnessPosition?: string;
  customsOfficer?: string;
  items: BC30Item[];
}

/**
 * BC30 Document Item
 */
export interface BC30Item extends DocumentItem {
  quantity: number;
  unit: string;
  destructionReason: string;
  originalDocumentReference?: string;
}

// ============================================================================
// BC25 - CONVERSION TO FREE ZONE
// ============================================================================

/**
 * BC25 Document Header
 * Conversion from bonded to free zone
 */
export interface BC25Header extends DocumentHeader {
  documentType: 'BC25';
  bcNumber: string;
  bcDate: Date;
  conversionReason: string;
  dutyPaymentDetails?: string;
  taxPaymentDetails?: string;
  items: BC25Item[];
}

/**
 * BC25 Document Item
 */
export interface BC25Item extends DocumentItem {
  quantity: number;
  unit: string;
  originalBC23Reference?: string;
  dutyAmount?: number;
  taxAmount?: number;
}

// ============================================================================
// MUTATION - INTERNAL MOVEMENT
// ============================================================================

/**
 * Mutation Document Header
 * Internal stock mutations (RM to WIP, WIP to FG, etc.)
 */
export interface MutationHeader extends DocumentHeader {
  documentType: 'MUTATION';
  mutationNumber: string;
  mutationDate: Date;
  mutationType: 'RM_TO_WIP' | 'WIP_TO_FG' | 'FG_TO_SCRAP' | 'OTHER';
  workOrderNumber?: string;
  batchNumber?: string;
  items: MutationItem[];
}

/**
 * Mutation Document Item
 */
export interface MutationItem extends DocumentItem {
  sourceItemType: ItemTypeCode;
  targetItemType: ItemTypeCode;
  quantity: number;
  unit: string;
  conversionRatio?: number;
}

// ============================================================================
// STOCK MANAGEMENT
// ============================================================================

/**
 * Stock Item
 * Current stock information
 */
export interface StockItem extends BaseEntity {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemTypeCode;
  quantity: number;
  unit: string;
  status: StockStatus;
  locationCode?: string;
  warehouseCode?: string;
  lotNumber?: string;
  batchNumber?: string;
  serialNumber?: string;
  expiryDate?: Date;
  manufactureDate?: Date;
  bc23Reference?: string;
  lastMovementDate?: Date;
}

/**
 * Stock Transaction
 * History of stock movements
 */
export interface StockTransaction extends BaseEntity {
  transactionNumber: string;
  transactionDate: Date;
  transactionType: TransactionType;
  itemId: string;
  itemCode: string;
  itemType: ItemTypeCode;
  quantity: number;
  unit: string;
  documentType: CustomsDocumentType;
  documentNumber: string;
  documentDate: Date;
  referenceNumber?: string;
  fromLocation?: string;
  toLocation?: string;
  notes?: string;
}

/**
 * Stock Balance
 * Current stock balance by item and type
 */
export interface StockBalance {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemTypeCode;
  totalQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  quarantineQuantity: number;
  blockedQuantity: number;
  unit: string;
  lastUpdated: Date;
}

/**
 * Stock Adjustment
 * Stock adjustments and corrections
 */
export interface StockAdjustment extends BaseEntity {
  adjustmentNumber: string;
  adjustmentDate: Date;
  adjustmentType: AdjustmentType;
  itemId: string;
  itemCode: string;
  itemType: ItemTypeCode;
  quantityBefore: number;
  quantityAdjustment: number;
  quantityAfter: number;
  unit: string;
  reason: string;
  approvedBy?: string;
  approvedAt?: Date;
}

// ============================================================================
// BOM (BILL OF MATERIALS)
// ============================================================================

/**
 * BOM Header
 * Bill of Materials master data
 */
export interface BOMHeader extends BaseEntity {
  bomNumber: string;
  finishedGoodId: string;
  finishedGoodCode: string;
  finishedGoodName: string;
  version: string;
  effectiveDate: Date;
  expiryDate?: Date;
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT';
  baseQuantity: number;
  baseUnit: string;
  items: BOMItem[];
}

/**
 * BOM Item
 * Raw materials for finished goods
 */
export interface BOMItem extends BaseEntity {
  bomId: string;
  lineNumber: number;
  rawMaterialId: string;
  rawMaterialCode: string;
  rawMaterialName: string;
  requiredQuantity: number;
  unit: string;
  wastagePercentage?: number;
  notes?: string;
}

// ============================================================================
// FORM STATE INTERFACES
// ============================================================================

/**
 * Form State
 * Generic form state for multi-step forms
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
 * Validation Result
 * Result of form validation
 */
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  warnings?: Record<string, string>;
}

/**
 * Step Configuration
 * Configuration for multi-step forms
 */
export interface StepConfig {
  id: string;
  label: string;
  description?: string;
  optional?: boolean;
  component: React.ComponentType<any>;
  validate?: (data: any) => ValidationResult;
}

// ============================================================================
// UI COMPONENT PROPS
// ============================================================================

/**
 * Item Option
 * Option for item autocomplete
 */
export interface ItemOption {
  id: string;
  code: string;
  name: string;
  type: ItemTypeCode;
  specification?: string;
  unit: string;
  hsCode?: string;
  disabled?: boolean;
}

/**
 * Date Range
 * Date range selection
 */
export interface DateRange {
  startDate: Date | null;
  endDate: Date | null;
}

/**
 * Filter Options
 * Common filter options for listings
 */
export interface FilterOptions {
  documentType?: CustomsDocumentType[];
  status?: DocumentStatus[];
  dateRange?: DateRange;
  itemType?: ItemTypeCode[];
  searchText?: string;
}

/**
 * Pagination
 * Pagination parameters
 */
export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Sort Options
 * Sorting configuration
 */
export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * API Response
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

/**
 * Paginated Response
 * Response with pagination
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
  filters?: FilterOptions;
  sort?: SortOptions;
}

/**
 * Validation Error
 * Validation error details
 */
export interface ValidationError {
  field: string;
  message: string;
  code?: string;
}

/**
 * API Error Response
 * Error response from API
 */
export interface ApiErrorResponse {
  success: false;
  error: string;
  message: string;
  validationErrors?: ValidationError[];
  timestamp: string;
}
