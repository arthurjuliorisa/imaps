/**
 * Validation utilities for mutation records
 */

import { prisma } from '@/lib/prisma';

/**
 * Validates that an item exists in the database
 * @param itemId - The item ID to validate
 * @returns True if item exists, false otherwise
 */
export async function validateItemExists(itemId: string): Promise<boolean> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
  });
  return !!item;
}

/**
 * Validates that a UOM exists in the database
 * @param uomId - The UOM ID to validate
 * @returns True if UOM exists, false otherwise
 */
export async function validateUomExists(uomId: string): Promise<boolean> {
  const uom = await prisma.uOM.findUnique({
    where: { id: uomId },
  });
  return !!uom;
}

/**
 * Validates multiple items exist in batch
 * @param itemIds - Array of item IDs to validate
 * @returns Set of existing item IDs
 */
export async function validateItemsBatch(itemIds: string[]): Promise<Set<string>> {
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true },
  });
  return new Set(items.map((item) => item.id));
}

/**
 * Validates multiple UOMs exist in batch
 * @param uomIds - Array of UOM IDs to validate
 * @returns Set of existing UOM IDs
 */
export async function validateUomsBatch(uomIds: string[]): Promise<Set<string>> {
  const uoms = await prisma.uOM.findMany({
    where: { id: { in: uomIds } },
    select: { id: true },
  });
  return new Set(uoms.map((uom) => uom.id));
}

/**
 * Validates a date string and returns a Date object
 * @param dateString - The date string to validate
 * @returns Date object if valid, null otherwise
 */
export function validateDate(dateString: string | Date): Date | null {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return null;
  }
  return date;
}

/**
 * Calculates ending balance for mutation records
 * @param beginning - Beginning balance
 * @param incoming - Incoming quantity
 * @param outgoing - Outgoing quantity
 * @param adjustment - Adjustment quantity
 * @returns Calculated ending balance
 */
export function calculateEnding(
  beginning: number,
  incoming: number,
  outgoing: number,
  adjustment: number
): number {
  return beginning + incoming - outgoing + adjustment;
}

/**
 * Calculates ending balance for INCOMING-only mutations
 * @param beginning - Beginning balance
 * @param incoming - Incoming quantity
 * @returns Calculated ending balance (beginning + incoming)
 */
export function calculateEndingIncoming(beginning: number, incoming: number): number {
  return beginning + incoming;
}

/**
 * Calculates variant for mutation records
 * @param stockOpname - Stock opname quantity
 * @param ending - Ending balance
 * @returns Calculated variant
 */
export function calculateVariant(stockOpname: number, ending: number): number {
  return stockOpname - ending;
}

/**
 * Validates and parses a numeric value
 * @param value - Value to parse
 * @param defaultValue - Default value if parsing fails
 * @returns Parsed number or default value
 */
export function parseNumericValue(value: any, defaultValue: number = 0): number {
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Gets the previous day's ending balance for an item
 * @param itemId - The item ID to query
 * @param currentDate - The current date (we'll look for records before this date)
 * @returns The ending balance from the previous day, or 0 if no previous record exists
 */
export async function getPreviousEndingBalance(
  itemId: string,
  currentDate: Date
): Promise<number> {
  // Find the most recent record before the current date for this item
  const previousRecord = await prisma.scrapMutation.findFirst({
    where: {
      itemId,
      date: {
        lt: currentDate,
      },
    },
    orderBy: {
      date: 'desc',
    },
    select: {
      ending: true,
    },
  });

  return previousRecord?.ending ?? 0;
}

/**
 * Looks up an item by its code
 * @param itemCode - The item code to look up
 * @returns The item if found, null otherwise
 */
export async function getItemByCode(itemCode: string): Promise<{ id: string; uomId: string } | null> {
  const item = await prisma.item.findUnique({
    where: { code: itemCode },
    select: { id: true, uomId: true },
  });
  return item;
}
