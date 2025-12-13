import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ItemTypeCode } from '@prisma/client';

/**
 * Inventory summary by item type
 */
interface InventoryTypeSummary {
  type: ItemTypeCode;
  typeName: string;
  totalQuantity: number;
  itemCount: number;
  percentage: number;
}

/**
 * GET /api/dashboard/inventory-summary
 * Returns inventory summary grouped by item type from StockDailySnapshot
 *
 * Uses the new StockDailySnapshot table which aggregates all transactions
 * Returns:
 * - Stock levels by item type (ROH, FERT, HALB, HIBE, SCRAP, etc.)
 * - Total quantity by type
 * - Count of items per type
 * - Percentage distribution
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Build where clause with companyCode filter
    const whereClause: any = {};
    if (session.user.companyCode) {
      whereClause.company_code = session.user.companyCode;
    }

    // Get the most recent snapshot date
    const latestSnapshot = await prisma.stock_daily_snapshot.findFirst({
      where: whereClause,
      orderBy: { snapshot_date: 'desc' },
      select: { snapshot_date: true },
    });

    if (!latestSnapshot) {
      // No snapshots available, return empty summary
      return NextResponse.json({
        summary: [],
        statistics: {
          totalItems: 0,
          itemsWithStock: 0,
          totalQuantity: 0,
          averageQuantityPerItem: 0,
        },
      });
    }

    // Get all snapshots for the latest date grouped by item type
    const snapshots = await prisma.stock_daily_snapshot.findMany({
      where: {
        snapshot_date: latestSnapshot.snapshot_date,
        ...whereClause,
      },
      select: {
        item_type_code: true,
        item_code: true,
        closing_balance: true,
      },
    });

    // Initialize summary map for all item types
    const summaryMap = new Map<ItemTypeCode, { totalQuantity: number; items: Set<string> }>();

    // Process each snapshot
    snapshots.forEach(snapshot => {
      const existing = summaryMap.get(snapshot.item_type_code as ItemTypeCode) || {
        totalQuantity: 0,
        items: new Set(),
      };

      existing.totalQuantity += Number(snapshot.closing_balance);
      existing.items.add(snapshot.item_code);

      summaryMap.set(snapshot.item_type_code as ItemTypeCode, existing);
    });

    // Calculate total quantity across all types
    let totalQuantityAllTypes = 0;
    summaryMap.forEach(summary => {
      totalQuantityAllTypes += summary.totalQuantity;
    });

    // Define type names mapping
    const typeNames: Record<ItemTypeCode, string> = {
      ROH: 'Raw Materials',
      HALB: 'Work in Progress',
      FERT: 'Finished Goods',
      HIBE_M: 'Capital Goods - Machinery',
      HIBE_E: 'Capital Goods - Engineering',
      HIBE_T: 'Capital Goods - Tools',
      HIBE: 'Capital Goods - General',
      SCRAP: 'Scrap',
      DIEN: 'Services',
    };

    // Build response with percentages
    const inventorySummary: InventoryTypeSummary[] = Array.from(summaryMap.entries()).map(([type, summary]) => {
      const percentage = totalQuantityAllTypes > 0
        ? Number(((summary.totalQuantity / totalQuantityAllTypes) * 100).toFixed(1))
        : 0;

      return {
        type,
        typeName: typeNames[type] || type,
        totalQuantity: Number(summary.totalQuantity.toFixed(2)),
        itemCount: summary.items.size,
        percentage,
      };
    });

    // Sort by total quantity descending
    inventorySummary.sort((a, b) => b.totalQuantity - a.totalQuantity);

    // Calculate additional statistics
    const totalItems = snapshots.length;
    const itemsWithStock = snapshots.filter(s => Number(s.closing_balance) > 0).length;
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
      snapshot_date: latestSnapshot.snapshot_date.toISOString(),
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch inventory summary:', error);
    return NextResponse.json(
      { message: 'Error fetching inventory summary', error: String(error) },
      { status: 500 }
    );
  }
}
