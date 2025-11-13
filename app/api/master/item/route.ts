import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Valid ItemType enum values from Prisma schema
const VALID_ITEM_TYPES = ['RM', 'FG', 'SFG', 'CAPITAL', 'SCRAP'] as const;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get('type');

    // Build where clause based on type filter
    const whereClause: any = {};
    if (typeFilter) {
      // Map itemType values to database enum values
      const typeMap: Record<string, string> = {
        'RAW_MATERIAL': 'RM',
        'FINISH_GOOD': 'FG',
        'CAPITAL_GOODS': 'CAPITAL',
        'SCRAP': 'SCRAP',
        'SEMI_FINISH_GOOD': 'SFG',
      };

      const dbType = typeMap[typeFilter] || typeFilter;

      if (VALID_ITEM_TYPES.includes(dbType as any)) {
        whereClause.type = dbType;
      }
    }

    const items = await prisma.item.findMany({
      where: whereClause,
      include: {
        uom: true,
      },
      orderBy: {
        code: 'asc',
      },
    });

    const itemsWithUomName = items.map(item => ({
      ...item,
      uomName: item.uom.name,
    }));

    return NextResponse.json(itemsWithUomName);
  } catch (error) {
    console.error('[API Error] Failed to fetch items:', error);
    return NextResponse.json({ message: 'Error fetching items' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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

    const item = await prisma.item.create({
      data: {
        code,
        name,
        type,
        uomId,
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
