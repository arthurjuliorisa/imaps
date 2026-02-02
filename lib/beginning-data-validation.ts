import { prisma } from '@/lib/prisma';

/**
 * Validation error details for beginning balance validation
 */
export interface BeginningBalanceValidationError {
  itemCode: string;
  reason: string;
  balanceDate?: Date;
}

/**
 * Result of beginning balance validation
 */
export interface BeginningBalanceValidationResult {
  valid: boolean;
  errors: BeginningBalanceValidationError[];
}

/**
 * Validates if an item can be added to beginning balances
 *
 * An item CANNOT be added if ANY of these conditions are true:
 * 1. Combination of item_code + company_code + balance_date already exists in beginning_balances (where deleted_at is null)
 * 2. The item already has incoming transactions in incoming_good_items (where incoming_good_company = the selected company)
 * 3. The item already has outgoing transactions in outgoing_good_items (where outgoing_good_company = the selected company)
 *
 * @param companyCode - The company code to check against
 * @param itemCode - The item code to validate
 * @param balanceDate - The balance date for the beginning balance
 * @returns Promise with validation result and specific error messages
 */
export async function validateBeginningBalanceItem(
  companyCode: number,
  itemCode: string,
  balanceDate: Date
): Promise<BeginningBalanceValidationResult> {
  const errors: BeginningBalanceValidationError[] = [];

  // Check 1: Duplicate beginning balance record
  const existingBeginningBalance = await prisma.beginning_balances.findFirst({
    where: {
      company_code: companyCode,
      item_code: itemCode,
      balance_date: balanceDate,
      deleted_at: null,
    },
  });

  if (existingBeginningBalance) {
    const formattedDate = balanceDate.toLocaleDateString('en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    errors.push({
      itemCode,
      balanceDate,
      reason: `Item ${itemCode} sudah ada di beginning balances untuk tanggal ${formattedDate}`,
    });
  }

  // Check 2: Existing incoming transactions
  const incomingTransaction = await prisma.incoming_good_items.findFirst({
    where: {
      incoming_good_company: companyCode,
      item_code: itemCode,
      deleted_at: null,
    },
    select: {
      id: true,
    },
  });

  if (incomingTransaction) {
    errors.push({
      itemCode,
      reason: `Item ${itemCode} sudah memiliki transaksi pemasukan barang (incoming)`,
    });
  }

  // Check 3: Existing outgoing transactions
  const outgoingTransaction = await prisma.outgoing_good_items.findFirst({
    where: {
      outgoing_good_company: companyCode,
      item_code: itemCode,
      deleted_at: null,
    },
    select: {
      id: true,
    },
  });

  if (outgoingTransaction) {
    errors.push({
      itemCode,
      reason: `Item ${itemCode} sudah memiliki transaksi pengeluaran barang (outgoing)`,
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
 * @param companyCode - The company code to check against
 * @param items - Array of items to validate with their balance dates
 * @returns Promise with validation results for all items
 */
export async function validateBeginningBalanceItemsBatch(
  companyCode: number,
  items: Array<{ itemCode: string; balanceDate: Date }>
): Promise<Record<string, BeginningBalanceValidationResult>> {
  const itemCodes = items.map(item => item.itemCode);
  const uniqueItemCodes = [...new Set(itemCodes)];

  // Batch fetch all data in parallel for efficiency
  const [existingBeginningBalances, incomingTransactions, outgoingTransactions] = await Promise.all([
    // Check for existing beginning balances
    prisma.beginning_balances.findMany({
      where: {
        company_code: companyCode,
        item_code: { in: itemCodes },
        deleted_at: null,
      },
      select: {
        item_code: true,
        balance_date: true,
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

  // Build lookup sets for O(1) checking
  const beginningBalanceKeys = new Set(
    existingBeginningBalances.map(
      bb => `${bb.item_code}|${bb.balance_date.getTime()}`
    )
  );

  const itemsWithIncoming = new Set(
    incomingTransactions.map(t => t.item_code)
  );

  const itemsWithOutgoing = new Set(
    outgoingTransactions.map(t => t.item_code)
  );

  // Validate each item
  const results: Record<string, BeginningBalanceValidationResult> = {};

  for (const item of items) {
    const key = `${item.itemCode}|${item.balanceDate.getTime()}`;
    const errors: BeginningBalanceValidationError[] = [];

    // Check 1: Duplicate beginning balance
    if (beginningBalanceKeys.has(key)) {
      const formattedDate = item.balanceDate.toLocaleDateString('en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      errors.push({
        itemCode: item.itemCode,
        balanceDate: item.balanceDate,
        reason: `Item ${item.itemCode} sudah ada di beginning balances untuk tanggal ${formattedDate}`,
      });
    }

    // Check 2: Has incoming transactions
    if (itemsWithIncoming.has(item.itemCode)) {
      errors.push({
        itemCode: item.itemCode,
        reason: `Item ${item.itemCode} sudah memiliki transaksi pemasukan barang (incoming)`,
      });
    }

    // Check 3: Has outgoing transactions
    if (itemsWithOutgoing.has(item.itemCode)) {
      errors.push({
        itemCode: item.itemCode,
        reason: `Item ${item.itemCode} sudah memiliki transaksi pengeluaran barang (outgoing)`,
      });
    }

    // Store result with unique key for this item+date combination
    results[key] = {
      valid: errors.length === 0,
      errors,
    };
  }

  return results;
}
