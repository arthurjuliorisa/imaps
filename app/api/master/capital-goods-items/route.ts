import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';

/**
 * GET /api/master/capital-goods-items
 * Get all capital goods items (HIBE_M, HIBE_E, HIBE_T types)
 * Returns unique items from stock_daily_snapshot table
 */
export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };

    // Validate company code
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    console.log('[Capital Goods API] Fetching from stock_daily_snapshot for company:', companyCode);

    // Build where clause for stock_daily_snapshot table
    const where: any = {
      company_code: companyCode,
      item_type: {
        in: ['HIBE_M', 'HIBE_E', 'HIBE_T'],
      },
    };

    // Get distinct capital goods items from stock_daily_snapshot
    const capitalGoodsItems = await prisma.stock_daily_snapshot.findMany({
      where,
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

    console.log('[Capital Goods API] Found items from snapshot:', capitalGoodsItems.length, capitalGoodsItems);

    // Transform to match frontend interface
    const transformedData = capitalGoodsItems.map((item, index) => ({
      id: index + 1, // Simple incremental ID for autocomplete
      itemCode: item.item_code,
      itemName: item.item_name,
      itemType: item.item_type,
      uom: item.uom,
      isActive: true, // Assume all items from beginning_balances are active
    }));

    return NextResponse.json(transformedData);
  } catch (error) {
    console.error('[API Error] Failed to fetch capital goods items:', error);
    return NextResponse.json(
      { message: 'Error fetching capital goods items', error: String(error) },
      { status: 500 }
    );
  }
}
