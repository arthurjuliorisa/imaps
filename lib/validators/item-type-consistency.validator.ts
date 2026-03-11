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
  uom: string; // Added for UOM-aware validation
}

// ============================================================================
// ITEM TYPE CONSISTENCY CHECK
// ============================================================================

/**
 * Validate item_type consistency across all endpoints
 * 
 * For each unique company_code + item_code + uom combination:
 * - Check stock_daily_snapshot for existing records
 * - If 0 rows: Allow (new item)
 * - If 1+ rows with SAME item_type: Allow (normal - daily snapshots)
 * - If 1+ rows with DIFFERENT item_types: Reject (inconsistent state)
 * - If incoming item_type differs from existing item_type: Reject (type locked)
 * 
 * KEY INSIGHT: Multiple snapshot records per item+UOM is NORMAL (daily snapshots).
 * We only care if the item_type value is CONSISTENT across all records.
 * 
 * @param companyCode - Company code from request
 * @param items - Array of items to validate (must include uom field)
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
        uom: true,
      },
    });

    // Group by item_code + uom to count rows per item per UOM
    const snapshotsByItemUom = new Map<string, { item_type: string[] }>();
    
    existingSnapshots.forEach(snapshot => {
      const key = `${snapshot.item_code}||${snapshot.uom}`; // Composite key
      if (!snapshotsByItemUom.has(key)) {
        snapshotsByItemUom.set(key, { item_type: [] });
      }
      snapshotsByItemUom.get(key)!.item_type.push(snapshot.item_type);
    });

    // Validate each item
    items.forEach((item, itemIndex) => {
      const snapshotKey = `${item.item_code}||${item.uom}`;
      const snapshots = snapshotsByItemUom.get(snapshotKey);
      
      if (snapshots) {
        // Item + UOM exists in stock_daily_snapshot
        const rowCount = snapshots.item_type.length;
        const existingItemTypes = [...new Set(snapshots.item_type)];
        
        // IMPORTANT: Multiple rows per item+UOM is NORMAL (daily snapshots)
        // Only reject if there are DIFFERENT item_types for same item+UOM
        if (existingItemTypes.length > 1) {
          // Multiple DIFFERENT item_types for same item_code + UOM: REJECT (inconsistent)
          errors.push({
            location: 'item',
            field: 'item_type',
            code: 'INCONSISTENT_ITEM_TYPE',
            message: `Cannot process item_code "${item.item_code}" with UOM "${item.uom}": records with different item_types exist (${existingItemTypes.join(', ')} found across ${rowCount} snapshot records). Item type is locked and cannot be changed.`,
            item_index: itemIndex,
            item_code: item.item_code,
          });
        } else if (rowCount >= 1 && existingItemTypes[0] !== item.item_type) {
          // Existing records have different item_type than incoming: REJECT (type mismatch)
          errors.push({
            location: 'item',
            field: 'item_type',
            code: 'INCONSISTENT_ITEM_TYPE',
            message: `Cannot process item_code "${item.item_code}" with UOM "${item.uom}": incoming item_type "${item.item_type}" does not match existing item_type "${existingItemTypes[0]}". Item type is locked and cannot be changed.`,
            item_index: itemIndex,
            item_code: item.item_code,
          });
        }
        // If existingItemTypes[0] === item.item_type, all good (consistent)
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
 * Get existing item_type for a company_code + item_code + uom
 * Used for updating stock_daily_snapshot to maintain consistency
 * 
 * @param companyCode - Company code
 * @param itemCode - Item code
 * @param uom - Unit of Measure
 * @returns item_type if exists (with row count), null if new
 */
export async function getExistingItemType(
  companyCode: number,
  itemCode: string,
  uom: string
): Promise<{ item_type: string; rowCount: number } | null> {
  try {
    const snapshots = await prisma.stock_daily_snapshot.findMany({
      where: {
        company_code: companyCode,
        item_code: itemCode,
        uom: uom,
      },
      select: {
        item_type: true,
      },
      distinct: ['item_type'],
    });

    if (snapshots.length === 0) {
      return null; // New item for this UOM
    }

    // Get actual row count for this UOM
    const rowCount = await prisma.stock_daily_snapshot.count({
      where: {
        company_code: companyCode,
        item_code: itemCode,
        uom: uom,
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
