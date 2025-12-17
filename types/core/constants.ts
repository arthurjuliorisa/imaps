/**
 * iMAPS v2.4.2 - Constants
 *
 * Constant values and labels used across the system.
 */

import {
  ItemTypeCode,
  CustomsDocumentType,
  CurrencyCode,
  AdjustmentType,
  QualityGrade
} from './enums';

/**
 * Item Type Labels (Human-readable)
 */
export const ITEM_TYPE_LABELS: Record<ItemTypeCode, string> = {
  [ItemTypeCode.ROH]: 'Raw Materials',
  [ItemTypeCode.HALB]: 'Work in Process',
  [ItemTypeCode.FERT]: 'Finished Goods',
  [ItemTypeCode.HIBE]: 'Capital Goods - General',
  [ItemTypeCode.HIBE_M]: 'Capital Goods - Machinery',
  [ItemTypeCode.HIBE_E]: 'Capital Goods - Equipment',
  [ItemTypeCode.HIBE_T]: 'Capital Goods - Tools',
  [ItemTypeCode.DIEN]: 'Services',
  [ItemTypeCode.SCRAP]: 'Scrap and Waste'
};

/**
 * Currency Labels
 */
export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  [CurrencyCode.USD]: 'US Dollar',
  [CurrencyCode.IDR]: 'Indonesian Rupiah',
  [CurrencyCode.CNY]: 'Chinese Yuan',
  [CurrencyCode.EUR]: 'Euro',
  [CurrencyCode.JPY]: 'Japanese Yen'
};

/**
 * Currency Symbols
 */
export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  [CurrencyCode.USD]: '$',
  [CurrencyCode.IDR]: 'Rp',
  [CurrencyCode.CNY]: '¥',
  [CurrencyCode.EUR]: '€',
  [CurrencyCode.JPY]: '¥'
};

/**
 * Customs Document Type Labels (Incoming)
 */
export const INCOMING_DOC_TYPE_LABELS: Record<string, string> = {
  [CustomsDocumentType.BC23]: 'BC23 - Import Declaration (New Import)',
  [CustomsDocumentType.BC27]: 'BC27 - Import Declaration (Return from Export)',
  [CustomsDocumentType.BC40]: 'BC40 - Transfer In from Bonded Zone'
};

/**
 * Customs Document Type Labels (Outgoing)
 */
export const OUTGOING_DOC_TYPE_LABELS: Record<string, string> = {
  [CustomsDocumentType.BC30]: 'BC30 - Export Declaration (Sales Export)',
  [CustomsDocumentType.BC25]: 'BC25 - Conversion to Free Zone',
  [CustomsDocumentType.BC27]: 'BC27 - Export Declaration (Return to Supplier)',
  [CustomsDocumentType.BC262]: 'BC262 - Subcontracting Outgoing'
};

/**
 * Adjustment Type Labels
 */
export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  [AdjustmentType.GAIN]: 'Stock Increase (Gain)',
  [AdjustmentType.LOSS]: 'Stock Decrease (Loss)'
};

/**
 * Quality Grade Labels
 */
export const QUALITY_GRADE_LABELS: Record<QualityGrade, string> = {
  [QualityGrade.A]: 'Grade A (Best Quality)',
  [QualityGrade.B]: 'Grade B',
  [QualityGrade.C]: 'Grade C',
  [QualityGrade.REJECT]: 'Rejected/Defect'
};

/**
 * Default pagination settings
 */
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/**
 * Date format for display
 */
export const DATE_DISPLAY_FORMAT = 'dd/MM/yyyy';
export const DATETIME_DISPLAY_FORMAT = 'dd/MM/yyyy HH:mm:ss';
export const DATE_API_FORMAT = 'yyyy-MM-dd';
export const DATETIME_API_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX";
