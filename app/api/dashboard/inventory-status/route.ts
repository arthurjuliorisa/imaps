import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ItemType } from '@prisma/client';

/**
 * Inventory status interface
 */
interface InventoryStatus {
  itemCode: string;
  itemName: string;
  type: ItemType;
  currentStock: number;
  unit: string;
  lastUpdated: Date;
}

/**
 * GET /api/dashboard/inventory-status
 * Returns inventory overview with current stock levels
 *
 * Queries the most recent mutation record for each item across all mutation tables:
 * - ScrapMutation
 * - RawMaterialMutation
 * - ProductionMutation
 * - CapitalGoodsMutation
 *
 * Returns the latest ending balance as current stock for each item
 */
export async function GET(request: Request) {
  try {
    // Get all items with their UOM
    const items = await prisma.item.findMany({
      include: {
        uom: {
          select: {
            code: true,
          },
        },
      },
      orderBy: {
        code: 'asc',
      },
    });

    // Prepare inventory status array
    const inventoryStatus: InventoryStatus[] = [];

    // For each item, find the most recent mutation record across all relevant tables
    for (const item of items) {
      let latestMutation: { ending: number; updatedAt: Date } | null = null;

      // Determine which mutation table to query based on item type
      switch (item.type) {
        case 'SCRAP':
          // Scrap mutations are now tracked at ScrapMaster level, not individual items
          // Find which scrap master collections contain this item
          const scrapItems = await prisma.scrapItem.findMany({
            where: { itemId: item.id },
            select: { scrapId: true },
          });

          if (scrapItems.length > 0) {
            // Get the most recent mutation from any scrap master containing this item
            latestMutation = await prisma.scrapMutation.findFirst({
              where: { scrapId: { in: scrapItems.map(si => si.scrapId) } },
              orderBy: { date: 'desc' },
              select: { ending: true, updatedAt: true },
            });
          }
          break;

        case 'RM':
          latestMutation = await prisma.rawMaterialMutation.findFirst({
            where: { itemId: item.id },
            orderBy: { date: 'desc' },
            select: { ending: true, updatedAt: true },
          });
          break;

        case 'FG':
        case 'SFG':
          latestMutation = await prisma.productionMutation.findFirst({
            where: { itemId: item.id },
            orderBy: { date: 'desc' },
            select: { ending: true, updatedAt: true },
          });
          break;

        case 'CAPITAL':
          latestMutation = await prisma.capitalGoodsMutation.findFirst({
            where: { itemId: item.id },
            orderBy: { date: 'desc' },
            select: { ending: true, updatedAt: true },
          });
          break;

        default:
          // If item type doesn't match any mutation table, skip or default to 0
          latestMutation = null;
      }

      // Add to inventory status
      inventoryStatus.push({
        itemCode: item.code,
        itemName: item.name,
        type: item.type,
        currentStock: latestMutation?.ending ?? 0,
        unit: item.uom.code,
        lastUpdated: latestMutation?.updatedAt ?? item.updatedAt,
      });
    }

    // Calculate summary statistics
    const totalItems = inventoryStatus.length;
    const inStock = inventoryStatus.filter(item => item.currentStock > 0).length;
    const lowStock = inventoryStatus.filter(item => item.currentStock > 0 && item.currentStock <= 10).length;
    const outOfStock = inventoryStatus.filter(item => item.currentStock === 0).length;

    // Calculate percentages for inventory categories
    const rawMaterialsCount = inventoryStatus.filter(item => item.type === 'RM').length;
    const finishedGoodsCount = inventoryStatus.filter(item => item.type === 'FG' || item.type === 'SFG').length;
    const workInProgressCount = inventoryStatus.filter(item => item.type === 'SCRAP').length;

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
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch inventory status:', error);
    return NextResponse.json(
      { message: 'Error fetching inventory status' },
      { status: 500 }
    );
  }
}
