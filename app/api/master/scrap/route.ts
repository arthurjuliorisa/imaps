import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/master/scrap
 * Returns list of scrap items from beginning_balances
 * Filters by item_type_code = 'SCRAP'
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Build where clause with company_code filter if applicable
    const whereClause: any = {
      item_type_code: 'SCRAP',
    };

    if (session.user.companyCode) {
      whereClause.company_code = session.user.companyCode;
    }

    // Get distinct scrap items from beginning_balances
    const scrapItems = await prisma.beginning_balances.findMany({
      where: whereClause,
      select: {
        item_code: true,
        item_name: true,
        uom: true,
      },
      distinct: ['item_code'],
      orderBy: {
        item_code: 'asc',
      },
    });

    // Transform to match the expected interface
    const formattedScrapItems = scrapItems.map((item) => ({
      id: item.item_code,
      code: item.item_code,
      name: item.item_name,
      uom: item.uom,
    }));

    return NextResponse.json(formattedScrapItems);
  } catch (error) {
    console.error('[API Error] Failed to fetch scrap items:', error);
    return NextResponse.json(
      { message: 'Error fetching scrap items', error: String(error) },
      { status: 500 }
    );
  }
}
