// @ts-nocheck
// TODO: Fix - item model doesn't exist in schema
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const items = await prisma.item.findMany({
      orderBy: {
        code: 'asc',
      },
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error('[API Error] Failed to fetch items:', error);
    return NextResponse.json({ message: 'Error fetching items' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code, name, uomId } = body;

    const id = `ITEM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const item = await prisma.item.create({
      data: {
        id,
        code,
        name,
        uomId,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error: any) {
    console.error('[API Error] Failed to create item:', error);

    // Handle specific Prisma error codes
    if (error.code === 'P2002') {
      return NextResponse.json({ message: 'Item code already exists' }, { status: 400 });
    }
    if (error.code === 'P2003') {
      return NextResponse.json({ message: 'Invalid UOM selected' }, { status: 400 });
    }

    return NextResponse.json({ message: 'Error creating item' }, { status: 500 });
  }
}
