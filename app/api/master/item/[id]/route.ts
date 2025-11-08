import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Valid ItemType enum values from Prisma schema
const VALID_ITEM_TYPES = ['RM', 'FG', 'SFG', 'CAPITAL', 'SCRAP'] as const;

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const body = await request.json();
    const { code, name, type, uomId } = body;

    // Validate ItemType
    if (!VALID_ITEM_TYPES.includes(type)) {
      return NextResponse.json(
        {
          message: `Invalid item type. Must be one of: ${VALID_ITEM_TYPES.join(', ')}`
        },
        { status: 400 }
      );
    }

    const item = await prisma.item.update({
      where: { id: params.id },
      data: {
        code,
        name,
        type,
        uomId,
      },
    });

    return NextResponse.json(item);
  } catch (error: any) {
    console.error('[API Error] Failed to update item:', error);

    // Handle specific Prisma error codes
    if (error.code === 'P2002') {
      return NextResponse.json({ message: 'Item code already exists' }, { status: 400 });
    }
    if (error.code === 'P2003') {
      return NextResponse.json({ message: 'Invalid UOM selected' }, { status: 400 });
    }
    if (error.code === 'P2025') {
      return NextResponse.json({ message: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Error updating item' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    await prisma.item.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ message: 'Item deleted successfully' });
  } catch (error: any) {
    console.error('[API Error] Failed to delete item:', error);

    // Handle specific Prisma error codes
    if (error.code === 'P2025') {
      return NextResponse.json({ message: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Error deleting item' }, { status: 500 });
  }
}
