import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { serializeBigInt } from '@/lib/bigint-serializer';

/**
 * GET /api/customs/stock-opname/items-master
 * Get all available items for dropdown selection
 * Query params: search (for autocomplete)
 */
export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const limit = parseInt(searchParams.get('limit') || '50');

    // Build where clause
    const where: any = {
      company_code: companyCode,
      deleted_at: null,
      is_active: true,
    };

    // Search by item code or item name
    if (search) {
      where.OR = [
        { item_code: { contains: search, mode: 'insensitive' } },
        { item_name: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Get items
    const items = await prisma.items.findMany({
      where,
      select: {
        item_code: true,
        item_name: true,
        item_type: true,
        uom: true,
      },
      orderBy: [{ item_code: 'asc' }],
      take: limit,
    });

    return NextResponse.json(serializeBigInt(items));
  } catch (error) {
    console.error('[API Error] Failed to fetch items master:', error);
    return NextResponse.json(
      { message: 'Error fetching items master' },
      { status: 500 }
    );
  }
}
