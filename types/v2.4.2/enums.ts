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
  HIBE_M = 'HIBE_M',   // Capital Goods - Machinery (Mesin)
  HIBE_E = 'HIBE_E',   // Capital Goods - Equipment (Peralatan)
  HIBE_T = 'HIBE_T',   // Capital Goods - Tools (Perkakas)
  DIEN = 'DIEN',       // Services (Jasa)
  SCRAP = 'SCRAP'      // Scrap and Waste (Sisa/Sampah)
}

/**
 * Customs Document Types for Incoming Goods
 */
export enum CustomsDocumentTypeIncoming {
  BC23 = 'BC23',  // Import Declaration - New Import
  BC27 = 'BC27',  // Import Declaration - Return from Export
  BC40 = 'BC40'   // Import Declaration - Transfer In from Another Bonded Zone
}

/**
 * Customs Document Types for Outgoing Goods
 */
export enum CustomsDocumentTypeOutgoing {
  BC30 = 'BC30',  // Export Declaration - Sales Export
  BC25 = 'BC25',  // Conversion to Free Zone (Non-Export)
  BC27 = 'BC27',  // Export Declaration - Return to Supplier
  BC41 = 'BC41'   // Transfer Out to Another Bonded Zone
}

/**
 * Currency Codes - ISO 4217
 */
export enum CurrencyCode {
  USD = 'USD',    // US Dollar
  IDR = 'IDR',    // Indonesian Rupiah
  CNY = 'CNY',    // Chinese Yuan
  EUR = 'EUR',    // Euro
  JPY = 'JPY'     // Japanese Yen
}

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

/**
 * Job Types for Batch Processing
 */
export enum JobType {
  REFRESH_MATERIALIZED_VIEWS = 'REFRESH_MATERIALIZED_VIEWS',
  STOCK_CALCULATION = 'STOCK_CALCULATION',
  PARTITION_MAINTENANCE = 'PARTITION_MAINTENANCE',
  DATA_CLEANUP = 'DATA_CLEANUP'
}

/**
 * Job Status
 */
export enum JobStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
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
 */
export function usesTransactionCalculation(itemType: ItemTypeCode): boolean {
  return [
    ItemTypeCode.ROH,
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
 */
export function usesWIPSnapshotCalculation(itemType: ItemTypeCode): boolean {
  return itemType === ItemTypeCode.HALB;
}

/**
 * Get calculation method for item type
 */
export function getCalculationMethod(itemType: ItemTypeCode): CalculationMethod {
  return usesWIPSnapshotCalculation(itemType)
    ? CalculationMethod.WIP_SNAPSHOT
    : CalculationMethod.TRANSACTION;
}
