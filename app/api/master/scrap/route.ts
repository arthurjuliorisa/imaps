import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/master/scrap
 * Fetch all scrap master records with their items
 */
export async function GET() {
  try {
    const scraps = await prisma.scrapMaster.findMany({
      include: {
        items: {
          include: {
            item: {
              include: {
                uom: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
      orderBy: {
        code: 'asc',
      },
    });

    // Transform the data to include item details at the top level
    const scrapsWithDetails = scraps.map(scrap => ({
      ...scrap,
      items: scrap.items.map(scrapItem => ({
        id: scrapItem.id,
        itemId: scrapItem.itemId,
        itemCode: scrapItem.item.code,
        itemName: scrapItem.item.name,
        itemType: scrapItem.item.type,
        uomId: scrapItem.item.uomId,
        uomName: scrapItem.item.uom.name,
        quantity: scrapItem.quantity,
        remarks: scrapItem.remarks,
      })),
    }));

    return NextResponse.json(scrapsWithDetails);
  } catch (error) {
    console.error('[API Error] Failed to fetch scrap masters:', error);
    return NextResponse.json(
      { message: 'Error fetching scrap masters' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/master/scrap
 * Create a new scrap master record with items
 *
 * Request body:
 * {
 *   code: string,
 *   name: string,
 *   description?: string,
 *   items: Array<{
 *     itemId: string,
 *     quantity?: number,
 *     remarks?: string
 *   }>
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code, name, description, items } = body;

    // Validate required fields
    if (!code || !name) {
      return NextResponse.json(
        { message: 'Code and name are required' },
        { status: 400 }
      );
    }

    // Validate items array
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { message: 'At least one item is required' },
        { status: 400 }
      );
    }

    // Validate each item has itemId
    const invalidItems = items.filter(item => !item.itemId);
    if (invalidItems.length > 0) {
      return NextResponse.json(
        { message: 'All items must have an itemId' },
        { status: 400 }
      );
    }

    // Verify all items exist
    const itemIds = items.map(item => item.itemId);
    const existingItems = await prisma.item.findMany({
      where: {
        id: {
          in: itemIds,
        },
      },
      select: {
        id: true,
      },
    });

    if (existingItems.length !== itemIds.length) {
      return NextResponse.json(
        { message: 'One or more items do not exist' },
        { status: 400 }
      );
    }

    // Create scrap master with items in a transaction
    const scrap = await prisma.scrapMaster.create({
      data: {
        code,
        name,
        description: description || null,
        items: {
          create: items.map(item => ({
            itemId: item.itemId,
            quantity: item.quantity || null,
            remarks: item.remarks || null,
          })),
        },
      },
      include: {
        items: {
          include: {
            item: {
              include: {
                uom: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json(scrap, { status: 201 });
  } catch (error: any) {
    console.error('[API Error] Failed to create scrap master:', error);

    // Handle specific Prisma error codes
    if (error.code === 'P2002') {
      return NextResponse.json(
        { message: 'Scrap code already exists' },
        { status: 400 }
      );
    }

    if (error.code === 'P2003') {
      return NextResponse.json(
        { message: 'Invalid item reference' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Error creating scrap master' },
      { status: 500 }
    );
  }
}
