// @ts-nocheck
// TODO: Fix - item model doesn't exist in schema
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const body = await request.json();
    const { code, name, uomId } = body;

    const item = await prisma.item.update({
      where: { id: params.id },
      data: {
        code,
        name,
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
