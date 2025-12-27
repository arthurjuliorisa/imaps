import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export interface StockCheckItem {
  itemCode: string;
  itemType: string;
  qtyRequested: number;
}

export interface StockCheckResult {
  itemCode: string;
  itemType: string;
  currentStock: number;
  qtyRequested: number;
  available: boolean;
  shortfall?: number;
}

export interface BatchStockCheckResult {
  results: StockCheckResult[];
  allAvailable: boolean;
}

/**
 * Check stock availability for a single item
 */
export async function checkStockAvailability(
  companyCode: number,
  itemCode: string,
  itemType: string,
  qtyRequested: number
): Promise<StockCheckResult> {
  let currentStock = 0;

  try {
    if (itemType === 'SCRAP') {
      // Query vw_lpj_barang_sisa for scrap items
      const result = await prisma.$queryRaw<Array<{ closing_balance: Prisma.Decimal }>>`
        SELECT closing_balance
        FROM vw_lpj_barang_sisa
        WHERE company_code = ${companyCode}
          AND item_code = ${itemCode}
        LIMIT 1
      `;

      if (result.length > 0) {
        currentStock = Number(result[0].closing_balance);
      }
    } else if (['HIBE_M', 'HIBE_E', 'HIBE_T'].includes(itemType)) {
      // Query vw_lpj_barang_modal for capital goods items
      const result = await prisma.$queryRaw<Array<{ closing_balance: Prisma.Decimal }>>`
        SELECT closing_balance
        FROM vw_lpj_barang_modal
        WHERE company_code = ${companyCode}
          AND item_code = ${itemCode}
        LIMIT 1
      `;

      if (result.length > 0) {
        currentStock = Number(result[0].closing_balance);
      }
    } else {
      throw new Error(`Unsupported item type: ${itemType}`);
    }

    const available = currentStock >= qtyRequested;
    const shortfall = available ? undefined : qtyRequested - currentStock;

    return {
      itemCode,
      itemType,
      currentStock,
      qtyRequested,
      available,
      shortfall,
    };
  } catch (error) {
    console.error(`[Stock Check Error] Failed to check stock for ${itemCode}:`, error);
    throw error;
  }
}

/**
 * Check stock availability for multiple items (batch)
 */
export async function checkBatchStockAvailability(
  companyCode: number,
  items: StockCheckItem[]
): Promise<BatchStockCheckResult> {
  const results: StockCheckResult[] = [];

  for (const item of items) {
    const result = await checkStockAvailability(
      companyCode,
      item.itemCode,
      item.itemType,
      item.qtyRequested
    );
    results.push(result);
  }

  const allAvailable = results.every((r) => r.available);

  return {
    results,
    allAvailable,
  };
}
