/**
 * Type definitions for Scrap Import Template
 */

/**
 * Represents a single row of scrap mutation data in the import template
 */
export interface ScrapImportRow {
  /** Date of the scrap mutation in YYYY-MM-DD format */
  date: string;

  /** Unique code of the scrap item (must exist in Item master) */
  itemCode: string;

  /** Quantity of incoming scrap (must be >= 0) */
  incoming: number;

  /** Optional notes about the mutation */
  remarks?: string;
}

/**
 * Template structure configuration
 */
export interface TemplateConfig {
  /** Name of the main worksheet */
  mainSheetName: string;

  /** Name of the instructions worksheet */
  instructionsSheetName: string;

  /** Column headers */
  headers: string[];

  /** Format hints for each column */
  formatHints: string[];

  /** Column widths in characters */
  columnWidths: number[];

  /** Base filename (without extension and timestamp) */
  baseFilename: string;
}

/**
 * Excel generation options
 */
export interface ExcelGenerationOptions {
  /** Include sample data rows */
  includeSampleData?: boolean;

  /** Number of sample data rows to include */
  sampleDataCount?: number;

  /** Include instructions sheet */
  includeInstructions?: boolean;

  /** Custom date format for the filename */
  filenameDateFormat?: string;
}

/**
 * Default template configuration
 */
export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  mainSheetName: 'Scrap Import Template',
  instructionsSheetName: 'Instructions',
  headers: ['Date', 'Item Code', 'Incoming', 'Remarks'],
  formatHints: ['YYYY-MM-DD', 'e.g., SCRAP-001', 'Positive number', 'Optional notes'],
  columnWidths: [15, 20, 15, 30],
  baseFilename: 'Scrap_Import_Template',
};

/**
 * Sample data for the template
 */
export const SAMPLE_DATA: ScrapImportRow[] = [
  {
    date: '2025-01-15',
    itemCode: 'SCRAP-001',
    incoming: 50,
    remarks: 'New scrap received',
  },
  {
    date: '2025-01-16',
    itemCode: 'SCRAP-002',
    incoming: 75,
    remarks: 'Additional scrap',
  },
  {
    date: '2025-01-17',
    itemCode: 'SCRAP-001',
    incoming: 30,
    remarks: 'Daily intake',
  },
];

/**
 * Validation rules for import data
 */
export interface ValidationRules {
  /** Date must be in this format */
  dateFormat: string;

  /** Maximum length for remarks field */
  remarksMaxLength: number;

  /** Minimum value for incoming quantity */
  incomingMinValue: number;

  /** Maximum value for incoming quantity (optional) */
  incomingMaxValue?: number;

  /** Whether future dates are allowed */
  allowFutureDates: boolean;
}

/**
 * Default validation rules
 */
export const DEFAULT_VALIDATION_RULES: ValidationRules = {
  dateFormat: 'YYYY-MM-DD',
  remarksMaxLength: 500,
  incomingMinValue: 0,
  allowFutureDates: false,
};
