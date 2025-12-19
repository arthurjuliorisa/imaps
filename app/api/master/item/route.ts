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
    const itemType = searchParams.get('type');

    const where: any = {
      is_active: true,
      deleted_at: null,
    };

    // Filter by company code if user has company context
    if (session.user?.companyCode) {
      where.company_code = session.user.companyCode;
    }

    // Filter by item type if provided
    if (itemType) {
      where.item_type = itemType;
    }

    const items = await prisma.items.findMany({
      where,
      select: {
        id: true,
        item_code: true,
        item_name: true,
        item_type: true,
        uom: true,
        hs_code: true,
        currency: true,
      },
      orderBy: [
        { item_code: 'asc' },
      ],
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error('[API Error] Failed to fetch items:', error);
    return NextResponse.json(
      { message: 'Error fetching items' },
      { status: 500 }
    );
  }
}
