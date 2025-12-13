/**
 * Stock Calculation Validators
 *
 * Provides validation helpers for stock calculation operations.
 * Validates input data, business rules, and calculation results.
 *
 * @module StockCalculationValidators
 */

import { PrismaClient } from '@prisma/client';

// =====================================================================
// Types and Interfaces
// =====================================================================

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface SnapshotValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface TransactionValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

// =====================================================================
// Item Type Validators
// =====================================================================

const VALID_ITEM_TYPES = ['ROH', 'HALB', 'FERT', 'HIBE', 'HIBE_M', 'HIBE_E', 'HIBE_T', 'SCRAP'];

export function validateItemType(itemType: string): boolean {
  return VALID_ITEM_TYPES.includes(itemType);
}

export function isCapitalGoodsType(itemType: string): boolean {
  return ['HIBE', 'HIBE_M', 'HIBE_E', 'HIBE_T'].includes(itemType);
}

// =====================================================================
// Date Validators
// =====================================================================

export function validateDateRange(startDate: Date, endDate: Date): ValidationError[] {
  const errors: ValidationError[] = [];

  if (startDate > endDate) {
    errors.push({
      field: 'dateRange',
      message: 'Start date must be before or equal to end date',
      code: 'INVALID_DATE_RANGE',
    });
  }

  const now = new Date();
  if (startDate > now) {
    errors.push({
      field: 'startDate',
      message: 'Start date cannot be in the future',
      code: 'FUTURE_DATE',
    });
  }

  return errors;
}

export function validateCalculationDate(targetDate: Date): ValidationError[] {
  const errors: ValidationError[] = [];

  const now = new Date();
  if (targetDate > now) {
    errors.push({
      field: 'targetDate',
      message: 'Calculation date cannot be in the future',
      code: 'FUTURE_DATE',
    });
  }

  // Check if date is too old (more than 5 years)
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  if (targetDate < fiveYearsAgo) {
    errors.push({
      field: 'targetDate',
      message: 'Calculation date is too old (more than 5 years)',
      code: 'DATE_TOO_OLD',
    });
  }

  return errors;
}

// =====================================================================
// Company Code Validators
// =====================================================================

export async function validateCompanyCode(
  prisma: PrismaClient,
  companyCode: string
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  if (!companyCode || companyCode.trim() === '') {
    errors.push({
      field: 'companyCode',
      message: 'Company code is required',
      code: 'REQUIRED_FIELD',
    });
    return errors;
  }

  try {
    const company = await prisma.$queryRaw<any[]>`
      SELECT 1 FROM companies WHERE company_code = ${companyCode} LIMIT 1
    `;

    if (!company || company.length === 0) {
      errors.push({
        field: 'companyCode',
        message: `Company code ${companyCode} does not exist`,
        code: 'INVALID_COMPANY_CODE',
      });
    }
  } catch (error) {
    errors.push({
      field: 'companyCode',
      message: 'Error validating company code',
      code: 'VALIDATION_ERROR',
    });
  }

  return errors;
}

// =====================================================================
// Item Code Validators
// =====================================================================

export async function validateItemCode(
  prisma: PrismaClient,
  companyCode: string,
  itemCode: string
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  if (!itemCode || itemCode.trim() === '') {
    errors.push({
      field: 'itemCode',
      message: 'Item code is required',
      code: 'REQUIRED_FIELD',
    });
    return errors;
  }

  if (itemCode.length > 50) {
    errors.push({
      field: 'itemCode',
      message: 'Item code must be 50 characters or less',
      code: 'FIELD_TOO_LONG',
    });
  }

  return errors;
}

// =====================================================================
// Quantity Validators
// =====================================================================

export function validateQuantity(quantity: number, fieldName: string = 'quantity'): ValidationError[] {
  const errors: ValidationError[] = [];

  if (isNaN(quantity)) {
    errors.push({
      field: fieldName,
      message: 'Quantity must be a valid number',
      code: 'INVALID_NUMBER',
    });
    return errors;
  }

  if (quantity <= 0) {
    errors.push({
      field: fieldName,
      message: 'Quantity must be greater than zero',
      code: 'INVALID_QUANTITY',
    });
  }

  // Check for reasonable precision (max 2 decimal places)
  const decimalPlaces = (quantity.toString().split('.')[1] || '').length;
  if (decimalPlaces > 2) {
    errors.push({
      field: fieldName,
      message: 'Quantity can have maximum 2 decimal places',
      code: 'EXCESSIVE_PRECISION',
    });
  }

  return errors;
}

// =====================================================================
// Balance Validators
// =====================================================================

export interface BalanceCheckResult {
  hasNegativeStock: boolean;
  negativeItems: Array<{
    itemCode: string;
    itemName: string;
    balance: number;
  }>;
}

export async function checkNegativeStock(
  prisma: PrismaClient,
  companyCode: string,
  targetDate: Date
): Promise<BalanceCheckResult> {
  try {
    const negativeItems = await prisma.$queryRaw<any[]>`
      SELECT
        item_code,
        item_name,
        closing_balance
      FROM stock_daily_snapshot
      WHERE company_code = ${companyCode}
        AND snapshot_date = ${targetDate}::DATE
        AND closing_balance < 0
      ORDER BY closing_balance ASC
    `;

    return {
      hasNegativeStock: negativeItems.length > 0,
      negativeItems: negativeItems.map((item) => ({
        itemCode: item.item_code,
        itemName: item.item_name,
        balance: Number(item.closing_balance),
      })),
    };
  } catch (error) {
    return {
      hasNegativeStock: false,
      negativeItems: [],
    };
  }
}

// =====================================================================
// Transaction Validators
// =====================================================================

export async function validateTransactionConsistency(
  prisma: PrismaClient,
  companyCode: string,
  targetDate: Date
): Promise<TransactionValidationResult> {
  const errors: ValidationError[] = [];

  try {
    // Check for transactions with missing required fields
    const missingFields = await prisma.$queryRaw<any[]>`
      SELECT 'incoming' AS source, COUNT(*) AS count
      FROM incoming_details
      WHERE company_code = ${companyCode}
        AND trx_date = ${targetDate}::DATE
        AND (item_code IS NULL OR item_name IS NULL OR qty IS NULL OR uom IS NULL)
      UNION ALL
      SELECT 'outgoing' AS source, COUNT(*) AS count
      FROM outgoing_details
      WHERE company_code = ${companyCode}
        AND trx_date = ${targetDate}::DATE
        AND (item_code IS NULL OR item_name IS NULL OR qty IS NULL OR uom IS NULL)
      UNION ALL
      SELECT 'material_usage' AS source, COUNT(*) AS count
      FROM material_usage_details
      WHERE company_code = ${companyCode}
        AND trx_date = ${targetDate}::DATE
        AND (item_code IS NULL OR item_name IS NULL OR qty IS NULL OR uom IS NULL)
    `;

    missingFields.forEach((row) => {
      if (Number(row.count) > 0) {
        errors.push({
          field: 'transactions',
          message: `${row.count} ${row.source} transactions have missing required fields`,
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }
    });

    // Check for invalid quantities
    const invalidQuantities = await prisma.$queryRaw<any[]>`
      SELECT 'incoming' AS source, COUNT(*) AS count
      FROM incoming_details
      WHERE company_code = ${companyCode}
        AND trx_date = ${targetDate}::DATE
        AND qty < 0
      UNION ALL
      SELECT 'outgoing' AS source, COUNT(*) AS count
      FROM outgoing_details
      WHERE company_code = ${companyCode}
        AND trx_date = ${targetDate}::DATE
        AND qty < 0
      UNION ALL
      SELECT 'material_usage' AS source, COUNT(*) AS count
      FROM material_usage_details
      WHERE company_code = ${companyCode}
        AND trx_date = ${targetDate}::DATE
        AND qty < 0
    `;

    invalidQuantities.forEach((row) => {
      if (Number(row.count) > 0) {
        errors.push({
          field: 'quantities',
          message: `${row.count} ${row.source} transactions have negative quantities`,
          code: 'NEGATIVE_QUANTITY',
        });
      }
    });
  } catch (error) {
    errors.push({
      field: 'validation',
      message: 'Error validating transaction consistency',
      code: 'VALIDATION_ERROR',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// =====================================================================
// Snapshot Validators
// =====================================================================

export async function validateSnapshot(
  prisma: PrismaClient,
  companyCode: string,
  targetDate: Date
): Promise<SnapshotValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  try {
    // Check for balance mismatches
    const balanceMismatches = await prisma.$queryRaw<any[]>`
      SELECT
        item_code,
        item_name,
        opening_balance,
        incoming_qty,
        material_usage_qty,
        production_qty,
        outgoing_qty,
        adjustment_qty,
        closing_balance,
        (opening_balance + COALESCE(incoming_qty, 0) - COALESCE(material_usage_qty, 0)
         + COALESCE(production_qty, 0) - COALESCE(outgoing_qty, 0) + COALESCE(adjustment_qty, 0)) AS expected_closing
      FROM stock_daily_snapshot
      WHERE company_code = ${companyCode}
        AND snapshot_date = ${targetDate}::DATE
        AND calculation_method = 'TRANSACTION'
        AND ABS(closing_balance - (opening_balance + COALESCE(incoming_qty, 0) - COALESCE(material_usage_qty, 0)
                + COALESCE(production_qty, 0) - COALESCE(outgoing_qty, 0) + COALESCE(adjustment_qty, 0))) > 0.01
    `;

    if (balanceMismatches.length > 0) {
      errors.push({
        field: 'closing_balance',
        message: `${balanceMismatches.length} items have balance calculation mismatches`,
        code: 'BALANCE_MISMATCH',
      });
    }

    // Check for negative stock
    const negativeStockResult = await checkNegativeStock(prisma, companyCode, targetDate);
    if (negativeStockResult.hasNegativeStock) {
      warnings.push(
        `${negativeStockResult.negativeItems.length} items have negative stock. This may indicate data issues.`
      );
    }

    // Check for missing WIP snapshots
    const missingWipSnapshots = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*) AS count
      FROM stock_daily_snapshot
      WHERE company_code = ${companyCode}
        AND snapshot_date = ${targetDate}::DATE
        AND item_type_code = 'HALB'
        AND calculation_method != 'WIP_SNAPSHOT'
    `;

    if (missingWipSnapshots[0] && Number(missingWipSnapshots[0].count) > 0) {
      warnings.push(
        `${missingWipSnapshots[0].count} HALB items are not using WIP_SNAPSHOT calculation method`
      );
    }

    // Check transaction consistency
    const transactionValidation = await validateTransactionConsistency(prisma, companyCode, targetDate);
    if (!transactionValidation.isValid) {
      errors.push(...transactionValidation.errors);
    }
  } catch (error) {
    errors.push({
      field: 'validation',
      message: 'Error validating snapshot',
      code: 'VALIDATION_ERROR',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// =====================================================================
// Beginning Balance Validators
// =====================================================================

export async function validateBeginningBalance(
  prisma: PrismaClient,
  companyCode: string,
  effectiveDate: Date
): Promise<TransactionValidationResult> {
  const errors: ValidationError[] = [];

  try {
    // Check for duplicate items
    const duplicates = await prisma.$queryRaw<any[]>`
      SELECT item_code, COUNT(*) AS count
      FROM beginning_balances
      WHERE company_code = ${companyCode}
        AND effective_date = ${effectiveDate}::DATE
      GROUP BY item_code
      HAVING COUNT(*) > 1
    `;

    if (duplicates.length > 0) {
      errors.push({
        field: 'beginning_balances',
        message: `${duplicates.length} items have duplicate beginning balance entries`,
        code: 'DUPLICATE_ENTRIES',
      });
    }

    // Check for negative balances
    const negativeBalances = await prisma.$queryRaw<any[]>`
      SELECT item_code, balance_qty
      FROM beginning_balances
      WHERE company_code = ${companyCode}
        AND effective_date = ${effectiveDate}::DATE
        AND balance_qty < 0
    `;

    if (negativeBalances.length > 0) {
      errors.push({
        field: 'balance_qty',
        message: `${negativeBalances.length} items have negative beginning balances`,
        code: 'NEGATIVE_BALANCE',
      });
    }
  } catch (error) {
    errors.push({
      field: 'validation',
      message: 'Error validating beginning balance',
      code: 'VALIDATION_ERROR',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// =====================================================================
// Export All Validators
// =====================================================================

export const validators = {
  validateItemType,
  isCapitalGoodsType,
  validateDateRange,
  validateCalculationDate,
  validateCompanyCode,
  validateItemCode,
  validateQuantity,
  checkNegativeStock,
  validateTransactionConsistency,
  validateSnapshot,
  validateBeginningBalance,
};

export default validators;
