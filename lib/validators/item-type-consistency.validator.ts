/**
 * Item Type Consistency Validation Utility
 * 
 * Purpose:
 * - Validate item_type consistency for company_code + item_code combinations
 * - Ensure item_type doesn't change across multiple transactions
 * - Allow revision only if single row exists in stock_daily_snapshot
 * 
 * Rules:
 * - If company_code + item_code has 0 rows: Allow (new item)
 * - If company_code + item_code has 1 row: Allow revision
 * - If company_code + item_code has >1 rows: Reject (inconsistent)
 */

import { prisma } from '@/lib/db/prisma';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Generic validation error for consistency checks
 */
export interface ItemTypeConsistencyError {
  location: string;
  field: string;
  code: string;
  message: string;
  item_index?: number;  // For item-level errors
  record_index?: number; // For wip-balance records
  item_code?: string;
}

// ============================================================================
// INTERFACES
// ============================================================================

export interface ItemTypeCheckItem {
  item_type: string;
  item_code: string;
  item_name: string;
}

// ============================================================================
// ITEM TYPE CONSISTENCY CHECK
// ============================================================================

/**
 * Validate item_type consistency across all endpoints
 * 
 * For each unique company_code + item_code combination:
 * - Check stock_daily_snapshot for existing records
 * - If 0 rows: Allow (new item)
 * - If 1 row: Allow revision (item_type can change)
 * - If >1 rows: Reject (inconsistent state)
 * 
 * @param companyCode - Company code from request
 * @param items - Array of items to validate
 * @returns Array of validation errors
 */
export async function validateItemTypeConsistency(
  companyCode: number,
  items: ItemTypeCheckItem[]
): Promise<ItemTypeConsistencyError[]> {
  const errors: ItemTypeConsistencyError[] = [];

  // Get unique item_code combinations
  const uniqueItemCodes = [...new Set(items.map(item => item.item_code))];

  try {
    // Batch query all existing item_codes for this company
    const existingSnapshots = await prisma.stock_daily_snapshot.findMany({
      where: {
        company_code: companyCode,
        item_code: {
          in: uniqueItemCodes,
        },
      },
      select: {
        item_code: true,
        item_type: true,
      },
    });

    // Group by item_code to count rows per item
    const snapshotsByItemCode = new Map<string, { item_type: string[] }>();
    
    existingSnapshots.forEach(snapshot => {
      if (!snapshotsByItemCode.has(snapshot.item_code)) {
        snapshotsByItemCode.set(snapshot.item_code, { item_type: [] });
      }
      snapshotsByItemCode.get(snapshot.item_code)!.item_type.push(snapshot.item_type);
    });

    // Validate each item
    items.forEach((item, itemIndex) => {
      const snapshots = snapshotsByItemCode.get(item.item_code);
      
      if (snapshots) {
        // Item exists in stock_daily_snapshot
        const rowCount = snapshots.item_type.length;
        const existingItemTypes = [...new Set(snapshots.item_type)];
        
        if (rowCount > 1) {
          // More than 1 row: REJECT
          errors.push({
            location: 'item',
            field: 'item_type',
            code: 'INCONSISTENT_ITEM_TYPE',
            message: `Cannot process item_code "${item.item_code}": multiple snapshot records exist (${rowCount} rows) with different or same item_type. Item type is locked and cannot be changed.`,
            item_index: itemIndex,
            item_code: item.item_code,
          });
        } else if (rowCount === 1 && existingItemTypes[0] !== item.item_type) {
          // Exactly 1 row, but item_type changed: ALLOW (revision)
          // No error - this is allowed per business rule
        }
        // If rowCount === 1 and item_type is same, all good
      }
      // If snapshots is undefined/empty, item is new - no check needed
    });
  } catch (error) {
    // If database query fails, log but don't block
    console.error('Error validating item_type consistency:', error);
    // Don't add errors - let transaction proceed, database constraints will catch invalid item_types
  }

  return errors;
}

/**
 * Get existing item_type for a company_code + item_code
 * Used for updating stock_daily_snapshot to maintain consistency
 * 
 * @param companyCode - Company code
 * @param itemCode - Item code  
 * @returns item_type if exists (with row count), null if new
 */
export async function getExistingItemType(
  companyCode: number,
  itemCode: string
): Promise<{ item_type: string; rowCount: number } | null> {
  try {
    const snapshots = await prisma.stock_daily_snapshot.findMany({
      where: {
        company_code: companyCode,
        item_code: itemCode,
      },
      select: {
        item_type: true,
      },
      distinct: ['item_type'],
    });

    if (snapshots.length === 0) {
      return null; // New item
    }

    // Get actual row count
    const rowCount = await prisma.stock_daily_snapshot.count({
      where: {
        company_code: companyCode,
        item_code: itemCode,
      },
    });

    return {
      item_type: snapshots[0].item_type,
      rowCount,
    };
  } catch (error) {
    console.error('Error getting existing item_type:', error);
    return null;
  }
}
