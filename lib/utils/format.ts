/**
 * Format a number as quantity with comma as thousands separator and dot for decimal
 * @param value - The numeric value to format
 * @returns Formatted string with 3 decimal places
 */
export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '0.000';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

/**
 * Format a number as amount with comma as thousands separator and dot for decimal
 * @param value - The numeric value to format
 * @returns Formatted string with 4 decimal places
 */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '0.0000';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/**
 * Format a number with custom decimal places
 * @param value - The numeric value to format
 * @param decimals - Number of decimal places (default: 0)
 * @returns Formatted string
 */
export function formatNumber(value: number | null | undefined, decimals: number = 0): string {
  if (value === null || value === undefined) {
    return '0';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
