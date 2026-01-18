/**
 * Stock Opname Utilities
 * Helper functions for Stock Opname feature
 */

import { prisma } from '@/lib/prisma';
import { format } from 'date-fns';

/**
 * Generate Stock Opname Number
 * Format: STO-YYYYMMDD-XXX
 *
 * @param date - The date for the STO (defaults to current date)
 * @returns Generated STO number
 *
 * @example
 * const stoNumber = await generateSTONumber(); // STO-20260117-001
 * const stoNumber = await generateSTONumber(new Date('2026-01-15')); // STO-20260115-001
 */
export async function generateSTONumber(date: Date = new Date()): Promise<string> {
  const dateStr = format(date, 'yyyyMMdd');
  const prefix = `STO-${dateStr}-`;

  // Find the latest STO number for this date
  const latestSTO = await prisma.stock_opnames.findFirst({
    where: {
      sto_number: {
        startsWith: prefix,
      },
    },
    orderBy: {
      sto_number: 'desc',
    },
    select: {
      sto_number: true,
    },
  });

  let sequence = 1;
  if (latestSTO) {
    // Extract sequence number from last STO number
    const lastSequence = parseInt(latestSTO.sto_number.split('-')[2], 10);
    sequence = lastSequence + 1;
  }

  // Format sequence with leading zeros (3 digits)
  const sequenceStr = sequence.toString().padStart(3, '0');
  return `${prefix}${sequenceStr}`;
}

/**
 * Calculate end stock for an item at a specific datetime
 * This should query the LPJ mutasi or stock calculation system
 *
 * @param companyCode - Company code
 * @param itemCode - Item code
 * @param datetime - The datetime to calculate stock at
 * @returns End stock quantity
 */
export async function calculateEndStock(
  companyCode: number,
  itemCode: string,
  datetime: Date
): Promise<number> {
  // TODO: Implement actual stock calculation logic
  // This should integrate with your existing LPJ mutasi calculation
  // For now, returning 0 as placeholder

  // Example query (adjust based on your actual stock calculation logic):
  // const result = await prisma.$queryRaw`
  //   SELECT closing_balance as end_stock
  //   FROM fn_calculate_lpj_bahan_baku(...)
  //   WHERE company_code = ${companyCode}
  //     AND item_code = ${itemCode}
  //     AND snapshot_date <= ${datetime}
  //   ORDER BY snapshot_date DESC
  //   LIMIT 1
  // `;

  console.warn('calculateEndStock: Implementation needed - using placeholder value 0');
  return 0;
}

/**
 * Calculate variance between STO qty and end stock
 *
 * @param stoQty - Stock Opname quantity (physical count)
 * @param endStock - System stock quantity
 * @returns Variance (positive = surplus, negative = shortage)
 */
export function calculateVariant(stoQty: number, endStock: number): number {
  return stoQty - endStock;
}

/**
 * Validate if STO can be edited based on status
 *
 * @param status - Current STO status
 * @returns true if editable, false otherwise
 */
export function isSTOEditable(status: string): boolean {
  return status === 'OPEN' || status === 'PROCESS';
}

/**
 * Validate if STO can be deleted
 *
 * @param status - Current STO status
 * @returns true if deletable, false otherwise
 */
export function isSTODeletable(status: string): boolean {
  return status === 'OPEN';
}

/**
 * Get STO status color for UI
 *
 * @param status - STO status
 * @returns MUI color variant
 */
export function getSTOStatusColor(
  status: string
): 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'OPEN':
      return 'info';
    case 'PROCESS':
      return 'warning';
    case 'RELEASED':
      return 'success';
    default:
      return 'default';
  }
}

/**
 * Get variant color based on value
 *
 * @param variant - Variance value
 * @returns MUI color variant
 */
export function getVariantColor(
  variant: number
): 'success' | 'error' | 'default' {
  if (variant > 0) return 'success'; // Surplus
  if (variant < 0) return 'error'; // Shortage
  return 'default'; // No variance
}

/**
 * Format STO number for display
 *
 * @param stoNumber - STO number
 * @returns Formatted STO number with parts highlighted
 */
export function formatSTONumber(stoNumber: string): {
  prefix: string;
  date: string;
  sequence: string;
} {
  const parts = stoNumber.split('-');
  return {
    prefix: parts[0] || '',
    date: parts[1] || '',
    sequence: parts[2] || '',
  };
}

/**
 * Validate STO number format
 *
 * @param stoNumber - STO number to validate
 * @returns true if valid format, false otherwise
 */
export function isValidSTONumber(stoNumber: string): boolean {
  const regex = /^STO-\d{8}-\d{3}$/;
  return regex.test(stoNumber);
}
