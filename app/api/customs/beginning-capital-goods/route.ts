import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';

export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const { searchParams } = new URL(request.url);
    const itemCode = searchParams.get('itemCode');
    const itemName = searchParams.get('itemName');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const where: any = {
      item_type_code: {
        startsWith: 'HIBE',
      },
    };

    if (session.user?.companyCode) {
      where.company_code = session.user.companyCode;
    }

    if (itemCode) {
      where.item_code = {
        contains: itemCode,
        mode: 'insensitive',
      };
    }

    if (itemName) {
      where.item_name = {
        contains: itemName,
        mode: 'insensitive',
      };
    }

    if (startDate || endDate) {
      where.balance_date = {};
      if (startDate) {
        where.balance_date.gte = new Date(startDate);
      }
      if (endDate) {
        where.balance_date.lte = new Date(endDate);
      }
    }

    const beginningBalances = await prisma.beginning_balances.findMany({
      where,
      orderBy: [
        { balance_date: 'desc' },
        { item_code: 'asc' },
      ],
    });

    const transformedData = beginningBalances.map((balance) => ({
      id: balance.id.toString(),
      item: {
        code: balance.item_code,
        name: balance.item_name,
      },
      uom: {
        code: balance.uom,
      },
      beginningBalance: Number(balance.qty),
      beginningDate: balance.balance_date,
      remarks: null,
      itemId: balance.item_code,
      uomId: balance.uom,
    }));

    return NextResponse.json(transformedData);
  } catch (error) {
    console.error('[API Error] Failed to fetch beginning capital goods stocks:', error);
    return NextResponse.json(
      { message: 'Error fetching beginning capital goods stocks' },
      { status: 500 }
    );
  }
}
