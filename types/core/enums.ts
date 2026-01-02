/**
 * iMAPS v2.4.2 - Enum Type Definitions
 *
 * All enum types used across the v2.4.2 system.
 * These match the PostgreSQL ENUM types defined in the database.
 */

// ============================================================================
// DATABASE ENUMS (Match PostgreSQL ENUMs exactly)
// ============================================================================

/**
 * Item Type Codes - v2.4.2
 * Based on SAP Material Types and customs requirements
 */
export enum ItemTypeCode {
  ROH = 'ROH',         // Raw Materials (Bahan Baku)
  HALB = 'HALB',       // Work in Process / Semi-Finished (Barang Setengah Jadi)
  FERT = 'FERT',       // Finished Goods (Barang Jadi)
  HIBE = 'HIBE',       // Capital Goods - General (Barang Modal)
  HIBE_M = 'HIBE-M',   // Capital Goods - Machinery (Mesin)
  HIBE_E = 'HIBE-E',   // Capital Goods - Equipment (Peralatan)
  HIBE_T = 'HIBE-T',   // Capital Goods - Tools (Perkakas)
  DIEN = 'DIEN',       // Services (Jasa)
  SCRAP = 'SCRAP'      // Scrap and Waste (Sisa/Sampah)
}

/**
 * Customs Document Types
 * Used for both incoming and outgoing goods
 * Matches: CustomsDocumentType enum in Prisma schema
 */
export enum CustomsDocumentType {
  BC23 = 'BC23',   // Import Declaration
  BC27 = 'BC27',   // Other Bonded Zone Release (Incoming & Outgoing)
  BC40 = 'BC40',   // Local Purchase from Non-Bonded Zone
  BC30 = 'BC30',   // Export Declaration
  BC25 = 'BC25',   // Local Sales to Non-Bonded Zone
  BC261 = 'BC261', // Subcontracting - Incoming
  BC262 = 'BC262'  // Subcontracting - Outgoing
}

/**
 * Legacy aliases for backward compatibility
 * @deprecated Use CustomsDocumentType instead
 */
export const CustomsDocumentTypeIncoming = CustomsDocumentType;
export const CustomsDocumentTypeOutgoing = CustomsDocumentType;

/**
 * Currency Codes - ISO 4217
 * Matches: Currency enum in Prisma schema
 */
export enum Currency {
  USD = 'USD',    // US Dollar
  IDR = 'IDR',    // Indonesian Rupiah
  CNY = 'CNY',    // Chinese Yuan
  EUR = 'EUR',    // Euro
  JPY = 'JPY'     // Japanese Yen
}

/**
 * Legacy alias for backward compatibility
 * @deprecated Use Currency instead
 */
export const CurrencyCode = Currency;
export type CurrencyCode = Currency;

/**
 * Adjustment Types - v2.4.2
 * Note: In v2.4.2, type is at detail level, qty is always positive
 */
export enum AdjustmentType {
  GAIN = 'GAIN',  // Stock increase (e.g., found items, correction up)
  LOSS = 'LOSS'   // Stock decrease (e.g., damage, expired, theft, correction down)
}

/**
 * User Roles
 */
export enum UserRole {
  ADMIN = 'ADMIN',      // Full system access
  USER = 'USER',        // Standard user (operator)
  VIEWER = 'VIEWER'     // Read-only access
}

/**
 * Quality Grade for Production Output
 */
export enum QualityGrade {
  A = 'A',              // Grade A (Best quality)
  B = 'B',              // Grade B
  C = 'C',              // Grade C
  REJECT = 'REJECT'     // Rejected/Defect
}

// ============================================================================
// APPLICATION ENUMS
// ============================================================================

/**
 * Stock Calculation Methods
 */
export enum CalculationMethod {
  TRANSACTION = 'TRANSACTION',  // Cumulative calculation (ROH, FERT, HIBE, SCRAP)
  WIP_SNAPSHOT = 'WIP_SNAPSHOT' // Snapshot-based (HALB only)
}

/**
 * Transaction Types
 */
export enum TransactionType {
  INCOMING = 'INCOMING',           // Incoming goods
  OUTGOING = 'OUTGOING',           // Outgoing goods
  MATERIAL_USAGE = 'MATERIAL_USAGE', // Material usage in production
  PRODUCTION = 'PRODUCTION',       // Production output
  WIP = 'WIP',                     // WIP balance snapshot
  ADJUSTMENT = 'ADJUSTMENT'        // Stock adjustment
}

/**
 * Document Status
 */
export enum DocumentStatus {
  DRAFT = 'DRAFT',               // Draft - not yet submitted
  SUBMITTED = 'SUBMITTED',       // Submitted to WMS
  RECEIVED = 'RECEIVED',         // Received from WMS
  PROCESSED = 'PROCESSED',       // Processed successfully
  ERROR = 'ERROR'                // Processing error
}

/**
 * Reversal Status for Production
 */
export enum ReversalStatus {
  NORMAL = 'NORMAL',             // Normal production
  REVERSED = 'REVERSED',         // Reversed (returned to warehouse)
  PARTIAL_REVERSAL = 'PARTIAL_REVERSAL' // Partially reversed
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if item type is capital goods
 */
export function isCapitalGoods(itemType: ItemTypeCode): boolean {
  return [
    ItemTypeCode.HIBE,
    ItemTypeCode.HIBE_M,
    ItemTypeCode.HIBE_E,
    ItemTypeCode.HIBE_T
  ].includes(itemType);
}

/**
 * Check if item type uses TRANSACTION calculation method
 * All item types use TRANSACTION method (including HALB - semi-finished goods)
 * Note: WIP snapshot is separate data sent by WMS, not used for balance calculation
 */
export function usesTransactionCalculation(itemType: ItemTypeCode): boolean {
  return [
    ItemTypeCode.ROH,
    ItemTypeCode.HALB,
    ItemTypeCode.FERT,
    ItemTypeCode.HIBE,
    ItemTypeCode.HIBE_M,
    ItemTypeCode.HIBE_E,
    ItemTypeCode.HIBE_T,
    ItemTypeCode.SCRAP
  ].includes(itemType);
}

/**
 * Check if item type uses WIP_SNAPSHOT calculation method
 * No item types use WIP_SNAPSHOT - all use TRANSACTION method
 * WIP snapshot is stored for reference but not used for balance calculation
 */
export function usesWIPSnapshotCalculation(itemType: ItemTypeCode): boolean {
  return false; // HALB is semi-finished goods, not WIP (Work In Progress)
}

/**
 * Get calculation method for item type
 * All item types use TRANSACTION calculation
 */
export function getCalculationMethod(itemType: ItemTypeCode): CalculationMethod {
  return CalculationMethod.TRANSACTION;
}
