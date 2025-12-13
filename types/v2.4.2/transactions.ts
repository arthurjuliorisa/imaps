/**
 * iMAPS v2.4.2 - Transaction Type Definitions
 *
 * TypeScript interfaces for all transaction types in the v2.4.2 system.
 * These types match the database schema (snake_case) and support the
 * header-detail pattern used throughout the system.
 */

import {
  ItemTypeCode,
  CustomsDocumentTypeIncoming,
  CustomsDocumentTypeOutgoing,
  CurrencyCode,
  AdjustmentType,
  QualityGrade,
  ReversalStatus
} from './enums';

// ============================================================================
// BASE TYPES
// ============================================================================

/**
 * Base Header Type
 * Common fields for all transaction headers
 */
export interface BaseHeader {
  id: string;
  wms_id: string;
  company_code: string;
  trx_date: Date;
  wms_timestamp: Date;
  received_at: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Base Detail Type
 * Common fields for all transaction details
 */
export interface BaseDetail {
  id: string;
  header_id: string;
  wms_id: string;
  company_code: string;
  trx_date: Date;
  item_code: string;
  item_name: string;
  uom: string;
  qty: number;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// INCOMING TRANSACTIONS (BC23, BC27, BC40)
// ============================================================================

/**
 * Incoming Header
 * Represents incoming goods transactions (BC23, BC27, BC40)
 */
export interface IncomingHeader extends BaseHeader {
  customs_doc_type: CustomsDocumentTypeIncoming;
  customs_doc_number: string;
  customs_doc_date: Date;
  supplier_code?: string;
  supplier_name?: string;
  origin_country?: string;
  owner: string;  // v2.4.2: Added for consignment tracking
  ppkek_number?: string;
  pib_number?: string;
  pib_date?: Date;
  invoice_number?: string;
  invoice_date?: Date;
  bl_awb_number?: string;
  bl_awb_date?: Date;
  remarks?: string;

  // Relations
  details?: IncomingDetail[];
}

/**
 * Incoming Detail
 * Line items for incoming transactions
 * v2.4.2: Currency and amount moved to detail level
 */
export interface IncomingDetail extends BaseDetail {
  item_type_code: ItemTypeCode;
  currency: CurrencyCode;      // v2.4.2: Item-level currency
  amount: number;               // v2.4.2: Item-level amount
  hs_code?: string;
  brand?: string;
  ppkek_number?: string;        // For tracking/traceability
}

// ============================================================================
// OUTGOING TRANSACTIONS (BC30, BC25, BC27, BC41)
// ============================================================================

/**
 * Outgoing Header
 * Represents outgoing goods transactions (BC30, BC25, BC27, BC41)
 */
export interface OutgoingHeader extends BaseHeader {
  customs_doc_type: CustomsDocumentTypeOutgoing;
  customs_doc_number: string;
  customs_doc_date: Date;
  ppkek_number: string;         // v2.4.2: MANDATORY (NOT NULL)
  buyer_code?: string;
  buyer_name?: string;
  destination_country?: string;
  peb_number?: string;
  peb_date?: Date;
  invoice_number?: string;
  invoice_date?: Date;
  bl_awb_number?: string;
  bl_awb_date?: Date;
  remarks?: string;

  // Relations
  details?: OutgoingDetail[];
}

/**
 * Outgoing Detail
 * Line items for outgoing transactions
 * v2.4.2: Currency and amount moved to detail level
 */
export interface OutgoingDetail extends BaseDetail {
  item_type_code: ItemTypeCode;
  currency: CurrencyCode;       // v2.4.2: Item-level currency
  amount: number;                // v2.4.2: Item-level amount
  hs_code?: string;
  brand?: string;
}

// ============================================================================
// MATERIAL USAGE (Production Consumption)
// ============================================================================

/**
 * Material Usage Header
 * Represents raw materials consumed in production
 */
export interface MaterialUsageHeader extends BaseHeader {
  work_order_number: string;
  remarks?: string;

  // Relations
  details?: MaterialUsageDetail[];
}

/**
 * Material Usage Detail
 * Line items for material consumption
 * Only ROH and HALB can be consumed
 */
export interface MaterialUsageDetail extends BaseDetail {
  item_type_code: ItemTypeCode;  // Only 'ROH' or 'HALB' allowed
  ppkek_number: string;           // Required for traceability
  is_reversal: boolean;           // v2.4.2: Support material return to warehouse
}

// ============================================================================
// PRODUCTION OUTPUT
// ============================================================================

/**
 * Finished Goods Production Header
 * Represents production output (FERT or SCRAP)
 */
export interface FinishedGoodsProductionHeader extends BaseHeader {
  work_order_number: string;
  remarks?: string;

  // Relations
  details?: FinishedGoodsProductionDetail[];
}

/**
 * Finished Goods Production Detail
 * Line items for production output
 * v2.4.2: work_order_numbers moved to detail level (array)
 */
export interface FinishedGoodsProductionDetail extends BaseDetail {
  item_type_code: ItemTypeCode;   // Only 'FERT' or 'SCRAP' allowed
  quality_grade?: QualityGrade;   // For FERT only
  work_order_numbers: string[];   // v2.4.2: Array at item level
  reversal_status: ReversalStatus; // v2.4.2: Track reversals
}

// ============================================================================
// WIP BALANCE (Snapshot-based)
// ============================================================================

/**
 * WIP Balance Header
 * Snapshot of work-in-process inventory
 */
export interface WIPBalanceHeader extends BaseHeader {
  remarks?: string;

  // Relations
  details?: WIPBalanceDetail[];
}

/**
 * WIP Balance Detail
 * Line items for WIP snapshot
 * Only HALB items (item_type_code will always be 'HALB')
 */
export interface WIPBalanceDetail extends BaseDetail {
  item_type_code: ItemTypeCode;  // Always 'HALB'
  work_order_number: string;     // Associated work order
}

// ============================================================================
// ADJUSTMENTS (Stock Corrections)
// ============================================================================

/**
 * Adjustment Header
 * Stock adjustments for corrections, damages, etc.
 */
export interface AdjustmentHeader extends BaseHeader {
  wms_doc_type?: string;
  internal_evidence_number: string;
  remarks?: string;

  // Relations
  details?: AdjustmentDetail[];
}

/**
 * Adjustment Detail
 * Line items for adjustments
 * v2.4.2: adjustment_type at detail level, qty always positive
 */
export interface AdjustmentDetail extends BaseDetail {
  item_type_code: ItemTypeCode;
  adjustment_type: AdjustmentType;  // v2.4.2: GAIN or LOSS at item level
  reason?: string;                   // v2.4.2: Reason at item level
  // qty is always positive, adjustment_type determines direction
}

// ============================================================================
// BEGINNING BALANCES (Master Data)
// ============================================================================

/**
 * Beginning Balance
 * Initial stock balances for each company/item/item_type
 */
export interface BeginningBalance {
  id: string;
  company_code: string;
  item_type_code: ItemTypeCode;
  item_code: string;
  item_name: string;
  uom: string;
  qty: number;
  effective_date: Date;
  remarks?: string;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// COMPANY (Master Data)
// ============================================================================

/**
 * Company
 * Company master data
 */
export interface Company {
  company_code: string;  // PK
  company_name: string;
  is_active: boolean;
}

// ============================================================================
// ITEM TYPE (Master Data)
// ============================================================================

/**
 * Item Type
 * Item type master data
 */
export interface ItemType {
  item_type_code: ItemTypeCode;  // PK
  is_capital_goods: boolean;
}

// ============================================================================
// TRACEABILITY (v2.4.2)
// ============================================================================

/**
 * Work Order Item Linkage
 * Links work orders to their input materials for traceability
 */
export interface WorkOrderItemLinkage {
  id: string;
  company_code: string;
  work_order_number: string;
  input_item_code: string;
  input_item_name: string;
  input_item_type_code: ItemTypeCode;  // ROH or HALB
  input_ppkek_number: string;
  created_at: Date;
}

/**
 * Outgoing Item Linkage
 * Links outgoing items to their source work orders
 */
export interface OutgoingItemLinkage {
  id: string;
  company_code: string;
  outgoing_header_id: string;
  outgoing_item_code: string;
  source_work_order_number: string;
  created_at: Date;
}

/**
 * Finished Goods Work Order Linkage
 * Links finished goods to multiple work orders
 */
export interface FinishedGoodsWorkOrderLinkage {
  id: string;
  company_code: string;
  fg_production_detail_wms_id: string;
  fg_item_code: string;
  work_order_number: string;
  created_at: Date;
}

// ============================================================================
// UNION TYPES FOR GENERIC HANDLING
// ============================================================================

/**
 * All Header Types
 */
export type AnyHeader =
  | IncomingHeader
  | OutgoingHeader
  | MaterialUsageHeader
  | FinishedGoodsProductionHeader
  | WIPBalanceHeader
  | AdjustmentHeader;

/**
 * All Detail Types
 */
export type AnyDetail =
  | IncomingDetail
  | OutgoingDetail
  | MaterialUsageDetail
  | FinishedGoodsProductionDetail
  | WIPBalanceDetail
  | AdjustmentDetail;

/**
 * Transaction with Details
 * Generic transaction structure
 */
export interface TransactionWithDetails<H extends BaseHeader, D extends BaseDetail> {
  header: H;
  details: D[];
}
