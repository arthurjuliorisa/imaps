import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ItemTypeCode } from '@prisma/client';

/**
 * Inventory status interface
 */
interface InventoryStatus {
  itemCode: string;
  itemName: string;
  type: ItemTypeCode;
  currentStock: number;
  unit: string;
  lastUpdated: Date;
}

/**
 * GET /api/dashboard/inventory-status
 * Returns inventory overview with current stock levels from StockDailySnapshot
 *
 * Queries the most recent snapshot for each item to get current stock levels
 * Uses the new StockDailySnapshot table which aggregates all transactions
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
      // No snapshots available, return empty inventory
      return NextResponse.json({
        inventoryStatus: [],
        rawMaterials: 0,
        finishedGoods: 0,
        workInProgress: 0,
        inStock: 0,
        lowStock: 0,
        outOfStock: 0,
      });
    }

    // Get all items from latest snapshot
    const snapshots = await prisma.stock_daily_snapshot.findMany({
      where: {
        snapshot_date: latestSnapshot.snapshot_date,
        ...whereClause,
      },
      orderBy: {
        item_code: 'asc',
      },
    });

    // Transform to inventory status format
    const inventoryStatus: InventoryStatus[] = snapshots.map(snapshot => ({
      itemCode: snapshot.item_code,
      itemName: snapshot.item_name,
      type: snapshot.item_type_code as ItemTypeCode,
      currentStock: Number(snapshot.closing_balance),
      unit: 'KG', // TODO: Add UOM field to stock_daily_snapshot model
      lastUpdated: snapshot.updated_at,
    }));

    // Calculate summary statistics
    const totalItems = inventoryStatus.length;
    const inStock = inventoryStatus.filter(item => item.currentStock > 0).length;
    const lowStock = inventoryStatus.filter(item => item.currentStock > 0 && item.currentStock <= 10).length;
    const outOfStock = inventoryStatus.filter(item => item.currentStock === 0).length;

    // Calculate percentages for inventory categories based on new ItemTypeCode enum
    const rawMaterialsCount = inventoryStatus.filter(item => item.type === 'ROH').length;
    const finishedGoodsCount = inventoryStatus.filter(item => item.type === 'FERT').length;
    const workInProgressCount = inventoryStatus.filter(item => item.type === 'HALB').length;

    const rawMaterials = totalItems > 0 ? Math.round((rawMaterialsCount / totalItems) * 100) : 0;
    const finishedGoods = totalItems > 0 ? Math.round((finishedGoodsCount / totalItems) * 100) : 0;
    const workInProgress = totalItems > 0 ? Math.round((workInProgressCount / totalItems) * 100) : 0;

    return NextResponse.json({
      inventoryStatus,
      rawMaterials,
      finishedGoods,
      workInProgress,
      inStock,
      lowStock,
      outOfStock,
      snapshotDate: latestSnapshot.snapshot_date.toISOString(),
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch inventory status:', error);
    return NextResponse.json(
      { message: 'Error fetching inventory status', error: String(error) },
      { status: 500 }
    );
  }
}
