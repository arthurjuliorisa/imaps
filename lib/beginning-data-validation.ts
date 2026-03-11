import { prisma } from '@/lib/prisma';
import { error } from 'console';

/**
 * Validation error details for beginning balance validation
 */
export interface BeginningBalanceValidationError {
  itemCode: string;
  reason: string;
}

/**
 * Result of beginning balance validation
 */
export interface BeginningBalanceValidationResult {
  valid: boolean;
  errors: BeginningBalanceValidationError[];
}

/**
 * Normalized item data for validation
 * All string fields are trimmed and multiple spaces reduced to single space
 */
interface NormalizedItemData {
  itemCode: string;
  itemName: string;
  itemType: string;
  uom: string;
}

/**
 * Normalizes whitespace in all string fields
 * - Trims leading/trailing spaces
 * - Reduces multiple consecutive spaces to single space
 *
 * @param data - Item data to normalize
 * @returns Normalized item data
 */
function normalizeItemData(data: {
  itemCode: string;
  itemName: string;
  itemType: string;
  uom: string;
}): NormalizedItemData {
  const normalizeString = (str: string): string => {
    return str.trim().replace(/\s+/g, ' ');
  };

  return {
    itemCode: normalizeString(data.itemCode),
    itemName: normalizeString(data.itemName),
    itemType: normalizeString(data.itemType),
    uom: normalizeString(data.uom),
  };
}

/**
 * Validates if an item can be added to beginning balances
 *
 * Validation Rules:
 * 1. Normalize whitespace for all fields (item_code, item_name, item_type, uom)
 * 2. REJECT if identical record exists (same item_code + uom + item_name + item_type)
 *    - Error: "Item sudah ada dengan data yang sama"
 * 3. REJECT if item_code + uom exists but with different item_name
 * 4. REJECT if item_code + uom exists but with different item_type
 * 5. REJECT if item has existing incoming transactions (same company)
 * 6. REJECT if item has existing outgoing transactions (same company)
 * 7. ALLOW if same item_code but different uom (allowed for same item with different units)
 *
 * @param companyCode - The company code to check against
 * @param itemCode - The item code to validate
 * @param itemName - The item name to validate
 * @param itemType - The item type to validate
 * @param uom - The unit of measure to validate
 * @returns Promise with validation result and specific error messages
 */
export async function validateBeginningBalanceItem(
  companyCode: number,
  itemCode: string,
  itemName: string,
  itemType: string,
  uom: string
): Promise<BeginningBalanceValidationResult> {
  const errors: BeginningBalanceValidationError[] = [];

  // Normalize all input data
  const normalized = normalizeItemData({
    itemCode,
    itemName,
    itemType,
    uom,
  });

  // Check 1: Check for existing beginning balance with identical data
  const identicalRecord = await prisma.beginning_balances.findFirst({
    where: {
      company_code: companyCode,
      item_code: normalized.itemCode,
      uom: normalized.uom,
      item_name: normalized.itemName,
      item_type: normalized.itemType,
      deleted_at: null,
    },
  });

  if (identicalRecord) {
    errors.push({
      itemCode: normalized.itemCode,
      reason: `Item sudah ada dengan data yang sama`,
    });
  }

  // Check 2: Check if item_code + uom exists with different item_name
  const differentNameRecord = await prisma.beginning_balances.findFirst({
    where: {
      company_code: companyCode,
      item_code: normalized.itemCode,
      uom: normalized.uom,
      item_name: { not: normalized.itemName },
      deleted_at: null,
    },
  });

  if (differentNameRecord) {
    errors.push({
      itemCode: normalized.itemCode,
      reason: `Item dengan kode ${normalized.itemCode} dan UOM ${normalized.uom} sudah ada dengan nama yang berbeda (${differentNameRecord.item_name})`,
    });
  }

  // Check 3: Check if item_code + uom exists with different item_type
  const differentTypeRecord = await prisma.beginning_balances.findFirst({
    where: {
      company_code: companyCode,
      item_code: normalized.itemCode,
      uom: normalized.uom,
      item_type: { not: normalized.itemType },
      deleted_at: null,
    },
  });

  if (differentTypeRecord) {
    errors.push({
      itemCode: normalized.itemCode,
      reason: `Item dengan kode ${normalized.itemCode} dan UOM ${normalized.uom} sudah ada dengan tipe yang berbeda (${differentTypeRecord.item_type})`,
    });
  }

  // Check 4: Check for existing incoming transactions
  const incomingTransaction = await prisma.incoming_good_items.findFirst({
    where: {
      incoming_good_company: companyCode,
      item_code: normalized.itemCode,
      deleted_at: null,
    },
    select: {
      id: true,
    },
  });

  if (incomingTransaction) {
    errors.push({
      itemCode: normalized.itemCode,
      reason: `Item ${normalized.itemCode} sudah memiliki transaksi pemasukan barang (incoming)`,
    });
  }

  // Check 5: Check for existing outgoing transactions
  const outgoingTransaction = await prisma.outgoing_good_items.findFirst({
    where: {
      outgoing_good_company: companyCode,
      item_code: normalized.itemCode,
      deleted_at: null,
    },
    select: {
      id: true,
    },
  });

  if (outgoingTransaction) {
    errors.push({
      itemCode: normalized.itemCode,
      reason: `Item ${normalized.itemCode} sudah memiliki transaksi pengeluaran barang (outgoing)`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates multiple items for beginning balance in batch
 * More efficient than calling validateBeginningBalanceItem multiple times
 *
 * Detects batch-internal duplicates and applies all validation rules
 *
 * @param companyCode - The company code to check against
 * @param items - Array of items to validate
 * @returns Promise with validation results indexed by unique key (item_code|uom|item_name|item_type)
 */
export async function validateBeginningBalanceItemsBatch(
  companyCode: number,
  items: Array<{
    itemCode: string;
    itemName: string;
    itemType: string;
    uom: string;
  }>
): Promise<Record<string, BeginningBalanceValidationResult>> {
  const results: Record<string, BeginningBalanceValidationResult> = {};

  if (items.length === 0) {
    return results;
  }



  // Normalize all items
  const normalizedItems = items.map((item, index) => ({
    ...normalizeItemData(item),
    originalIndex: index,
  }));

  // Create unique keys for each normalized item
  const createKey = (item: NormalizedItemData): string => {
    return `${item.itemCode}|${item.uom}|${item.itemName}|${item.itemType}`;
  };

  // Check 1: Detect duplicates within the batch itself
  // Track all occurrences of each key
  const keyOccurrences = new Map<string, number>();

  for (let i = 0; i < normalizedItems.length; i++) {
    const key = createKey(normalizedItems[i]);
    const count = keyOccurrences.get(key) || 0;
    keyOccurrences.set(key, count + 1);
  }

  // Identify keys that appear more than once (duplicates)
  const batchDuplicateKeys = new Set<string>();
  for (const [key, count] of keyOccurrences.entries()) {
    if (count > 1) {
      batchDuplicateKeys.add(key);
    }
  }

  // Get all unique normalized item codes for database queries
  const uniqueItemCodes = [...new Set(normalizedItems.map(item => item.itemCode))];
  const uniqueUoms = [...new Set(normalizedItems.map(item => item.uom))];

  // Batch fetch all database data in parallel
  const [existingBeginningBalances, incomingTransactions, outgoingTransactions] =
    await Promise.all([
      // Get all existing beginning balance records
      prisma.beginning_balances.findMany({
        where: {
          company_code: companyCode,
          deleted_at: null,
        },
        select: {
          item_code: true,
          uom: true,
          item_name: true,
          item_type: true,
        },
      }),

      // Check for incoming transactions
      prisma.incoming_good_items.findMany({
        where: {
          incoming_good_company: companyCode,
          item_code: { in: uniqueItemCodes },
          deleted_at: null,
        },
        select: {
          item_code: true,
        },
        distinct: ['item_code'],
      }),

      // Check for outgoing transactions
      prisma.outgoing_good_items.findMany({
        where: {
          outgoing_good_company: companyCode,
          item_code: { in: uniqueItemCodes },
          deleted_at: null,
        },
        select: {
          item_code: true,
        },
        distinct: ['item_code'],
      }),
    ]);

  // Build lookup maps
  const itemsWithIncoming = new Set(
    incomingTransactions.map(t => t.item_code)
  );

  const itemsWithOutgoing = new Set(
    outgoingTransactions.map(t => t.item_code)
  );

  // Build a map of existing records keyed by (item_code, uom) for quick lookup
  const existingByCodeAndUom = new Map<string, typeof existingBeginningBalances>();
  for (const record of existingBeginningBalances) {
    const codeUomKey = `${record.item_code}|${record.uom}`;
    if (!existingByCodeAndUom.has(codeUomKey)) {
      existingByCodeAndUom.set(codeUomKey, []);
    }
    existingByCodeAndUom.get(codeUomKey)!.push(record);
  }

  // Validate each item
  for (const normalizedItem of normalizedItems) {
    const key = createKey(normalizedItem);
    const errors: BeginningBalanceValidationError[] = [];

    // Check if this item has batch duplicates
    if (batchDuplicateKeys.has(key)) {
      errors.push({
        itemCode: normalizedItem.itemCode,
        reason: `Duplikat lengkap dalam batch`,
      });
    } else {
      // Only check database if no batch duplicates
      // Get all existing records with same item_code + uom
      const codeUomKey = `${normalizedItem.itemCode}|${normalizedItem.uom}`;
      const existingRecords = existingByCodeAndUom.get(codeUomKey) || [];

      // Check 2a: Identical record exists
      const identicalExists = existingRecords.some(
        record =>
          record.item_code === normalizedItem.itemCode &&
          record.uom === normalizedItem.uom &&
          record.item_name === normalizedItem.itemName &&
          record.item_type === normalizedItem.itemType
      );

      if (identicalExists) {
        errors.push({
          itemCode: normalizedItem.itemCode,
          reason: `Item sudah ada dengan data yang sama`,
        });
      }

      // Check 2b: Same item_code + uom but different item_name
      const differentNameExists = existingRecords.some(
        record =>
          record.item_code === normalizedItem.itemCode &&
          record.uom === normalizedItem.uom &&
          record.item_name !== normalizedItem.itemName
      );

      if (differentNameExists) {
        const conflictingRecord = existingRecords.find(
          r =>
            r.item_code === normalizedItem.itemCode &&
            r.uom === normalizedItem.uom &&
            r.item_name !== normalizedItem.itemName
        );
        errors.push({
          itemCode: normalizedItem.itemCode,
          reason: `Item dengan kode ${normalizedItem.itemCode} dan UOM ${normalizedItem.uom} sudah ada dengan nama yang berbeda (${conflictingRecord?.item_name})`,
        });
      }

      // Check 2c: Same item_code + uom but different item_type
      const differentTypeExists = existingRecords.some(
        record =>
          record.item_code === normalizedItem.itemCode &&
          record.uom === normalizedItem.uom &&
          record.item_type !== normalizedItem.itemType
      );

      if (differentTypeExists) {
        const conflictingRecord = existingRecords.find(
          r =>
            r.item_code === normalizedItem.itemCode &&
            r.uom === normalizedItem.uom &&
            r.item_type !== normalizedItem.itemType
        );
        errors.push({
          itemCode: normalizedItem.itemCode,
          reason: `Item dengan kode ${normalizedItem.itemCode} dan UOM ${normalizedItem.uom} sudah ada dengan tipe yang berbeda (${conflictingRecord?.item_type})`,
        });
      }
    }

    // Check 3: Has incoming transactions
    if (itemsWithIncoming.has(normalizedItem.itemCode)) {
      errors.push({
        itemCode: normalizedItem.itemCode,
        reason: `Item ${normalizedItem.itemCode} sudah memiliki transaksi pemasukan barang (incoming)`,
      });
    }

    // Check 4: Has outgoing transactions
    if (itemsWithOutgoing.has(normalizedItem.itemCode)) {
      errors.push({
        itemCode: normalizedItem.itemCode,
        reason: `Item ${normalizedItem.itemCode} sudah memiliki transaksi pengeluaran barang (outgoing)`,
      });
    }

    // Store result with unique key
    results[key] = {
      valid: errors.length === 0,
      errors,
    };
  }

  return results;
}
