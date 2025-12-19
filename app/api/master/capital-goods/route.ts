import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/master/capital-goods
 * Returns list of capital goods items from beginning_balances
 * Filters by item_type IN ('HIBE_M', 'HIBE_E', 'HIBE_T')
 *
 * Item types:
 * - HIBE_M: Machinery
 * - HIBE_E: Electronics
 * - HIBE_T: Tools
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Build where clause with company_code filter if applicable
    const whereClause: any = {
      item_type: {
        in: ['HIBE_M', 'HIBE_E', 'HIBE_T'],
      },
    };

    if (session.user.companyCode) {
      whereClause.company_code = parseInt(session.user.companyCode);
    }

    // Get distinct capital goods items from beginning_balances
    const capitalGoodsItems = await prisma.beginning_balances.findMany({
      where: whereClause,
      select: {
        item_code: true,
        item_name: true,
        item_type: true,
        uom: true,
      },
      distinct: ['item_code'],
      orderBy: {
        item_code: 'asc',
      },
    });

    // Transform to match the expected interface
    const formattedCapitalGoodsItems = capitalGoodsItems.map((item) => ({
      id: item.item_code,
      code: item.item_code,
      name: item.item_name,
      uom: item.uom,
      itemType: item.item_type,
    }));

    return NextResponse.json(formattedCapitalGoodsItems);
  } catch (error) {
    console.error('[API Error] Failed to fetch capital goods items:', error);
    return NextResponse.json(
      { message: 'Error fetching capital goods items', error: String(error) },
      { status: 500 }
    );
  }
}
