/**
 * Duplicate Item Validation Utility
 * 
 * Purpose:
 * - Check for duplicate items within a single API request
 * - Prevent duplicate entries in various endpoints
 * 
 * Pattern:
 * - Each endpoint has specific combination of fields to check
 * - Returns array of validation errors (empty if no duplicates)
 */

import type { ValidationErrorDetail } from '@/lib/validators/schemas/incoming-goods.schema';

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Item with minimal fields for duplicate checking
 */
export interface DuplicateCheckItem {
  item_code: string;
  item_name: string;
  uom: string;
  ppkek_number?: string | null; // For material-usage
  stock_date?: string; // For wip-balance
}

export interface DuplicateCheckWipItem {
  company_code: number;
  item_code: string;
  item_name: string;
  uom: string;
  stock_date: string;
}

// ============================================================================
// DUPLICATE CHECK FUNCTIONS
// ============================================================================

/**
 * Check duplicate items for incoming-goods, adjustment
 * Combination: (item_code, item_name, uom)
 * 
 * @param items - Array of items to check
 * @returns Array of validation errors
 */
export function checkDuplicateItems(
  items: DuplicateCheckItem[],
  endpointType: 'incoming-goods' | 'adjustment'
): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];
  const seen = new Map<string, number>();

  items.forEach((item, index) => {
    const key = `${item.item_code}|${item.item_name}|${item.uom}`;
    
    if (seen.has(key)) {
      const firstIndex = seen.get(key)!;
      errors.push({
        location: 'item',
        field: 'item_code',
        code: 'DUPLICATE_ITEM',
        message: `Duplicate item: item_code="${item.item_code}", item_name="${item.item_name}", uom="${item.uom}" found at row ${firstIndex + 1} and row ${index + 1}`,
        item_index: index,
        item_code: item.item_code,
      });
    } else {
      seen.set(key, index);
    }
  });

  return errors;
}

/**
 * Check duplicate items for material-usage
 * Combination: (item_code, item_name, uom, ppkek_number)
 * 
 * @param items - Array of items to check
 * @returns Array of validation errors
 */
export function checkDuplicateMaterialUsageItems(
  items: DuplicateCheckItem[]
): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];
  const seen = new Map<string, number>();

  items.forEach((item, index) => {
    const key = `${item.item_code}|${item.item_name}|${item.uom}|${item.ppkek_number || ''}`;
    
    if (seen.has(key)) {
      const firstIndex = seen.get(key)!;
      const ppkekInfo = item.ppkek_number ? `, ppkek_number="${item.ppkek_number}"` : '';
      errors.push({
        location: 'item',
        field: 'item_code',
        code: 'DUPLICATE_ITEM',
        message: `Duplicate item: item_code="${item.item_code}", item_name="${item.item_name}", uom="${item.uom}"${ppkekInfo} found at row ${firstIndex + 1} and row ${index + 1}`,
        item_index: index,
        item_code: item.item_code,
      });
    } else {
      seen.set(key, index);
    }
  });

  return errors;
}

/**
 * Check duplicate items for wip-balance
 * Combination: (company_code, item_code, item_name, uom, stock_date)
 * 
 * Note: This also handles idempotency (wms_id + stock_date)
 * within the batch - subsequent records with same wms_id+stock_date
 * will replace the previous ones
 * 
 * @param items - Array of items to check
 * @returns Array of validation errors
 */
export function checkDuplicateWipBalanceItems(
  items: DuplicateCheckWipItem[]
): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];
  const seen = new Map<string, number>();

  items.forEach((item, index) => {
    const key = `${item.company_code}|${item.item_code}|${item.item_name}|${item.uom}|${item.stock_date}`;
    
    if (seen.has(key)) {
      const firstIndex = seen.get(key)!;
      errors.push({
        location: 'item',
        field: 'item_code',
        code: 'DUPLICATE_ITEM',
        message: `Duplicate item in batch: company_code="${item.company_code}", item_code="${item.item_code}", item_name="${item.item_name}", uom="${item.uom}", stock_date="${item.stock_date}" found at row ${firstIndex + 1} and row ${index + 1}`,
        item_index: index,
        item_code: item.item_code,
      });
    } else {
      seen.set(key, index);
    }
  });

  return errors;
}
