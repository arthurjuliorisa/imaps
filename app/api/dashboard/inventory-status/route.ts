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
          latestMutation = await prisma.scrapMutation.findFirst({
            where: { itemId: item.id },
            orderBy: { date: 'desc' },
            select: { ending: true, updatedAt: true },
          });
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

    return NextResponse.json({
      inventoryStatus,
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch inventory status:', error);
    return NextResponse.json(
      { message: 'Error fetching inventory status' },
      { status: 500 }
    );
  }
}
