import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ItemType } from '@prisma/client';

/**
 * Inventory summary by item type
 */
interface InventoryTypeSummary {
  type: ItemType;
  typeName: string;
  totalQuantity: number;
  itemCount: number;
  percentage: number;
}

/**
 * GET /api/dashboard/inventory-summary
 * Returns inventory summary grouped by item type
 *
 * Returns:
 * - Stock levels by item type (RM, FG, SFG, CAPITAL, SCRAP)
 * - Total quantity by type
 * - Count of items per type
 * - Percentage distribution
 */
export async function GET(request: Request) {
  try {
    // Get all items with their types
    const items = await prisma.item.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
      },
    });

    // Initialize summary map
    const summaryMap = new Map<ItemType, { totalQuantity: number; items: Set<string> }>();

    // Initialize all item types
    const itemTypes: ItemType[] = ['RM', 'FG', 'SFG', 'CAPITAL', 'SCRAP'];
    itemTypes.forEach(type => {
      summaryMap.set(type, { totalQuantity: 0, items: new Set() });
    });

    // Process each item to get its latest stock level
    for (const item of items) {
      let latestStock = 0;

      // Determine which mutation table to query based on item type
      switch (item.type) {
        case 'RM':
          const rmMutation = await prisma.rawMaterialMutation.findFirst({
            where: { itemId: item.id },
            orderBy: { date: 'desc' },
            select: { ending: true },
          });
          latestStock = rmMutation?.ending ?? 0;
          break;

        case 'FG':
        case 'SFG':
          const prodMutation = await prisma.productionMutation.findFirst({
            where: { itemId: item.id },
            orderBy: { date: 'desc' },
            select: { ending: true },
          });
          latestStock = prodMutation?.ending ?? 0;
          break;

        case 'CAPITAL':
          const capMutation = await prisma.capitalGoodsMutation.findFirst({
            where: { itemId: item.id },
            orderBy: { date: 'desc' },
            select: { ending: true },
          });
          latestStock = capMutation?.ending ?? 0;
          break;

        case 'SCRAP':
          // Scrap items are tracked via ScrapMaster
          const scrapItems = await prisma.scrapItem.findMany({
            where: { itemId: item.id },
            select: { scrapId: true },
          });

          if (scrapItems.length > 0) {
            const scrapMutation = await prisma.scrapMutation.findFirst({
              where: { scrapId: { in: scrapItems.map(si => si.scrapId) } },
              orderBy: { date: 'desc' },
              select: { ending: true },
            });
            latestStock = scrapMutation?.ending ?? 0;
          }
          break;
      }

      // Update summary
      const summary = summaryMap.get(item.type);
      if (summary) {
        summary.totalQuantity += latestStock;
        summary.items.add(item.id);
      }
    }

    // Calculate total quantity across all types
    let totalQuantityAllTypes = 0;
    summaryMap.forEach(summary => {
      totalQuantityAllTypes += summary.totalQuantity;
    });

    // Build response with percentages
    const typeNames: Record<ItemType, string> = {
      RM: 'Raw Materials',
      FG: 'Finished Goods',
      SFG: 'Semi-Finished Goods',
      CAPITAL: 'Capital Goods',
      SCRAP: 'Scrap',
    };

    const inventorySummary: InventoryTypeSummary[] = itemTypes.map(type => {
      const summary = summaryMap.get(type)!;
      const percentage = totalQuantityAllTypes > 0
        ? Number(((summary.totalQuantity / totalQuantityAllTypes) * 100).toFixed(1))
        : 0;

      return {
        type,
        typeName: typeNames[type],
        totalQuantity: Number(summary.totalQuantity.toFixed(2)),
        itemCount: summary.items.size,
        percentage,
      };
    });

    // Sort by total quantity descending
    inventorySummary.sort((a, b) => b.totalQuantity - a.totalQuantity);

    // Calculate additional statistics
    const totalItems = items.length;
    const itemsWithStock = inventorySummary.reduce((sum, s) => sum + s.itemCount, 0);
    const totalQuantity = Number(totalQuantityAllTypes.toFixed(2));

    return NextResponse.json({
      summary: inventorySummary,
      statistics: {
        totalItems,
        itemsWithStock,
        totalQuantity,
        averageQuantityPerItem: totalItems > 0
          ? Number((totalQuantityAllTypes / totalItems).toFixed(2))
          : 0,
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch inventory summary:', error);
    return NextResponse.json(
      { message: 'Error fetching inventory summary' },
      { status: 500 }
    );
  }
}
