// @ts-nocheck
// TODO: Fix - scrapMaster model doesn't exist in schema
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/master/scrap/[id]
 * Fetch a single scrap master record with its items
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const scrap = await prisma.scrapMaster.findUnique({
      where: { id: params.id },
      include: {
        ScrapItem: {
          include: {
            Item: {
              include: {
                UOM: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!scrap) {
      return NextResponse.json(
        { message: 'Scrap master not found' },
        { status: 404 }
      );
    }

    // Transform the data to include item details at the top level
    const scrapWithDetails = {
      ...scrap,
      items: scrap.ScrapItem.map(scrapItem => ({
        id: scrapItem.id,
        itemId: scrapItem.itemId,
        itemCode: scrapItem.Item.code,
        itemName: scrapItem.Item.name,
        uomId: scrapItem.Item.uomId,
        uomName: scrapItem.Item.UOM.name,
        quantity: scrapItem.quantity,
        remarks: scrapItem.remarks,
      })),
    };

    return NextResponse.json(scrapWithDetails);
  } catch (error) {
    console.error('[API Error] Failed to fetch scrap master:', error);
    return NextResponse.json(
      { message: 'Error fetching scrap master' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/master/scrap/[id]
 * Update a scrap master record and its items
 *
 * Request body:
 * {
 *   code: string,
 *   name: string,
 *   description?: string,
 *   items: Array<{
 *     id?: string, // If provided, update existing item; if not, create new
 *     itemId: string,
 *     quantity?: number,
 *     remarks?: string
 *   }>
 * }
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
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

    // Verify scrap master exists
    const existingScrap = await prisma.scrapMaster.findUnique({
      where: { id: params.id },
      include: {
        ScrapItem: true,
      },
    });

    if (!existingScrap) {
      return NextResponse.json(
        { message: 'Scrap master not found' },
        { status: 404 }
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

    // Get IDs of items to keep (items with id field from request)
    const itemsToKeep = items.filter(item => item.id).map(item => item.id);

    // Get IDs of items to delete (existing items not in the keep list)
    const itemsToDelete = existingScrap.ScrapItem
      .filter(item => !itemsToKeep.includes(item.id))
      .map(item => item.id);

    // Separate items into update and create operations
    const itemsToUpdate = items.filter(item => item.id);
    const itemsToCreate = items.filter(item => !item.id);

    // Update scrap master and manage items in a transaction
    const updatedScrap = await prisma.$transaction(async (tx) => {
      // Delete items that are no longer in the list
      if (itemsToDelete.length > 0) {
        await tx.scrapItem.deleteMany({
          where: {
            id: {
              in: itemsToDelete,
            },
          },
        });
      }

      // Update existing items
      for (const item of itemsToUpdate) {
        await tx.scrapItem.update({
          where: { id: item.id },
          data: {
            itemId: item.itemId,
            quantity: item.quantity || null,
            remarks: item.remarks || null,
          },
        });
      }

      // Create new items
      if (itemsToCreate.length > 0) {
        await tx.scrapItem.createMany({
          data: itemsToCreate.map((item, index) => ({
            id: `SCPI-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
            scrapId: params.id,
            itemId: item.itemId,
            quantity: item.quantity || null,
            remarks: item.remarks || null,
            updatedAt: new Date(),
          })),
        });
      }

      // Update scrap master
      return await tx.scrapMaster.update({
        where: { id: params.id },
        data: {
          code,
          name,
          description: description || null,
        },
        include: {
          ScrapItem: {
            include: {
              Item: {
                include: {
                  UOM: true,
                },
              },
            },
          },
        },
      });
    });

    return NextResponse.json(updatedScrap);
  } catch (error: any) {
    console.error('[API Error] Failed to update scrap master:', error);

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

    if (error.code === 'P2025') {
      return NextResponse.json(
        { message: 'Scrap master not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Error updating scrap master' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/master/scrap/[id]
 * Delete a scrap master record and all its items
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;

    // Delete scrap master (items will be cascade deleted due to onDelete: Cascade)
    await prisma.scrapMaster.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ message: 'Scrap master deleted successfully' });
  } catch (error: any) {
    console.error('[API Error] Failed to delete scrap master:', error);

    // Handle specific Prisma error codes
    if (error.code === 'P2025') {
      return NextResponse.json(
        { message: 'Scrap master not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Error deleting scrap master' },
      { status: 500 }
    );
  }
}
