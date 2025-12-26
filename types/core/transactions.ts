/**
 * iMAPS v2.4.2 - Transaction Type Definitions
 *
 * TypeScript interfaces for all transaction types in the v2.4.2 system.
 * These types match the database schema (snake_case) and support the
 * header-detail pattern used throughout the system.
 */

import {
  ItemTypeCode,
  CustomsDocumentType,
  Currency,
  AdjustmentType
} from './enums';

// ============================================================================
// BASE TYPES
// ============================================================================

/**
 * Base Header Type
 * Common fields for all transaction headers
 * NOTE: Different models have different date fields (incoming_date, outgoing_date, transaction_date, stock_date)
 */
export interface BaseHeader {
  id: number;
  wms_id: string;
  company_code: number;
  timestamp: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Base Detail Type
 * Common fields for all transaction details
 * NOTE: Each detail table has its own foreign key fields (e.g., incoming_good_id, outgoing_good_id)
 */
export interface BaseDetail {
  id: number;
  item_type: string;
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
 * Matches: incoming_goods table in Prisma schema
 */
export interface IncomingHeader extends BaseHeader {
  owner: number;
  customs_document_type: CustomsDocumentType;
  ppkek_number: string;
  customs_registration_date: Date;
  incoming_evidence_number: string;
  incoming_date: Date;
  invoice_number: string;
  invoice_date: Date;
  shipper_name: string;
  deleted_at?: Date;

  // Relations
  // NOTE: Due to partitioning, items relation is not available via Prisma
  // Use manual joins in queries
  // items?: IncomingDetail[];
}

/**
 * Incoming Detail
 * Line items for incoming transactions
 * Matches: incoming_good_items table in Prisma schema
 */
export interface IncomingDetail extends BaseDetail {
  incoming_good_id: number;
  incoming_good_company: number;
  incoming_good_date: Date;
  hs_code?: string;
  currency: Currency;
  amount: number;
  deleted_at?: Date;
}

// ============================================================================
// OUTGOING TRANSACTIONS (BC30, BC25, BC27, BC41)
// ============================================================================

/**
 * Outgoing Header
 * Represents outgoing goods transactions (BC30, BC25, BC27, BC41)
 * Matches: outgoing_goods table in Prisma schema
 */
export interface OutgoingHeader extends BaseHeader {
  owner: number;
  customs_document_type: CustomsDocumentType;
  ppkek_number: string;
  customs_registration_date: Date;
  outgoing_evidence_number: string;
  outgoing_date: Date;
  invoice_number: string;
  invoice_date: Date;
  recipient_name: string;
  deleted_at?: Date;

  // Relations
  items?: OutgoingDetail[];
}

/**
 * Outgoing Detail
 * Line items for outgoing transactions
 * Matches: outgoing_good_items table in Prisma schema
 */
export interface OutgoingDetail extends BaseDetail {
  outgoing_good_id: number;
  outgoing_good_company: number;
  outgoing_good_date: Date;
  production_output_wms_ids: string[];
  hs_code?: string;
  currency: Currency;
  amount: number;
  deleted_at?: Date;
}

// ============================================================================
// MATERIAL USAGE (Production Consumption)
// ============================================================================

/**
 * Material Usage Header
 * Represents raw materials consumed in production
 * Matches: material_usages table in Prisma schema
 */
export interface MaterialUsageHeader extends BaseHeader {
  work_order_number?: string;
  cost_center_number?: string;
  internal_evidence_number: string;
  transaction_date: Date;
  reversal?: string;
  deleted_at?: Date;

  // Relations
  items?: MaterialUsageDetail[];
}

/**
 * Material Usage Detail
 * Line items for material consumption
 * Matches: material_usage_items table in Prisma schema
 */
export interface MaterialUsageDetail extends BaseDetail {
  material_usage_id: number;
  material_usage_company: number;
  material_usage_date: Date;
  ppkek_number?: string;
  deleted_at?: Date;
}

// ============================================================================
// PRODUCTION OUTPUT
// ============================================================================

/**
 * Production Output Header
 * Represents production output (FERT or SCRAP)
 * Matches: production_outputs table in Prisma schema
 */
export interface ProductionOutputHeader extends BaseHeader {
  internal_evidence_number: string;
  transaction_date: Date;
  reversal?: string;
  deleted_at?: Date;

  // Relations
  items?: ProductionOutputDetail[];
}

/**
 * Production Output Detail
 * Line items for production output
 * Matches: production_output_items table in Prisma schema
 */
export interface ProductionOutputDetail extends BaseDetail {
  production_output_id: number;
  production_output_company: number;
  production_output_date: Date;
  work_order_numbers: string[];
  deleted_at?: Date;
}

// Aliases for backward compatibility
export type FinishedGoodsProductionHeader = ProductionOutputHeader;
export type FinishedGoodsProductionDetail = ProductionOutputDetail;

// ============================================================================
// WIP BALANCE (Snapshot-based)
// ============================================================================

/**
 * WIP Balance
 * Snapshot of work-in-process inventory
 * Matches: wip_balances table in Prisma schema
 * NOTE: This is a flat table (no header-detail pattern)
 */
export interface WIPBalance {
  id: number;
  wms_id: string;
  company_code: number;
  item_type: string;
  item_code: string;
  item_name: string;
  stock_date: Date;
  uom: string;
  qty: number;
  timestamp: Date;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

// Alias for consistency
export type WIPBalanceHeader = WIPBalance;

// ============================================================================
// ADJUSTMENTS (Stock Corrections)
// ============================================================================

/**
 * Adjustment Header
 * Stock adjustments for corrections, damages, etc.
 * Matches: adjustments table in Prisma schema
 */
export interface AdjustmentHeader extends BaseHeader {
  wms_doc_type?: string;
  internal_evidence_number: string;
  transaction_date: Date;
  deleted_at?: Date;

  // Relations
  items?: AdjustmentDetail[];
}

/**
 * Adjustment Detail
 * Line items for adjustments
 * Matches: adjustment_items table in Prisma schema
 */
export interface AdjustmentDetail extends BaseDetail {
  adjustment_id: number;
  adjustment_company: number;
  adjustment_date: Date;
  adjustment_type: AdjustmentType;
  reason?: string;
  deleted_at?: Date;
}

// ============================================================================
// BEGINNING BALANCES (Master Data)
// ============================================================================

/**
 * Beginning Balance
 * Initial stock balances for each company/item/item_type
 * Matches: beginning_balances table in Prisma schema
 */
export interface BeginningBalance {
  id: number;
  company_code: number;
  item_code: string;
  item_name: string;
  item_type: string;
  uom: string;
  qty: number;
  balance_date: Date;
  remarks?: string;
  ppkek_numbers?: string[];
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

// ============================================================================
// COMPANY (Master Data)
// ============================================================================

/**
 * Company
 * Company master data
 * Matches: companies table in Prisma schema
 */
export interface Company {
  id: number;
  code: number;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

// ============================================================================
// ITEM TYPE (Master Data)
// ============================================================================

/**
 * Item Type
 * Item type master data
 * Matches: item_types table in Prisma schema
 */
export interface ItemType {
  item_type_code: string;
  name_en: string;
  name_de?: string;
  name_id?: string;
  category: string;
  description?: string;
  is_active: boolean;
  sort_order?: number;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// ITEMS (Master Data)
// ============================================================================

/**
 * Item
 * Item master data
 * Matches: items table in Prisma schema
 */
export interface Item {
  id: number;
  company_code: number;
  item_code: string;
  item_name: string;
  item_type: string;
  hs_code?: string;
  uom: string;
  currency: Currency;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

// ============================================================================
// USERS & MENUS (Access Control)
// ============================================================================

/**
 * User
 * User account data
 * Matches: users table in Prisma schema
 */
export interface User {
  id: string;
  username: string;
  email: string;
  password: string;
  full_name: string;
  role: string;
  company_code?: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

/**
 * Menu
 * Menu items for application navigation
 * Matches: menus table in Prisma schema
 */
export interface Menu {
  id: string;
  parent_id?: string;
  menu_name: string;
  menu_path?: string;
  menu_icon?: string;
  menu_order?: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * User Access Menu
 * User permissions for menu items
 * Matches: user_access_menus table in Prisma schema
 */
export interface UserAccessMenu {
  id: string;
  user_id: string;
  menu_id: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Audit Log
 * Audit trail for data changes
 * Matches: audit_logs table in Prisma schema
 */
export interface AuditLog {
  id: bigint;
  table_name: string;
  record_id: number;
  action: string;
  old_values?: any;
  new_values?: any;
  changed_by?: string;
  changed_at: Date;
  ip_address?: string;
  user_agent?: string;
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
  | ProductionOutputHeader
  | WIPBalance
  | AdjustmentHeader;

/**
 * All Detail Types
 */
export type AnyDetail =
  | IncomingDetail
  | OutgoingDetail
  | MaterialUsageDetail
  | ProductionOutputDetail
  | AdjustmentDetail;

/**
 * Transaction with Details
 * Generic transaction structure
 */
export interface TransactionWithDetails<H extends BaseHeader, D extends BaseDetail> {
  header: H;
  details: D[];
}
