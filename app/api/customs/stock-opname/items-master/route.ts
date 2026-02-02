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

    // Get items with latest stock snapshot
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items = await prisma.items.findMany({
      where,
      select: {
        item_code: true,
        item_name: true,
        item_type: true,
        uom: true,
        company_code: true,
      },
      orderBy: [{ item_code: 'asc' }],
      take: limit,
    });

    // Fetch latest stock snapshots for all items
    const itemCodes = items.map((item) => item.item_code);
    const snapshots = await prisma.stock_daily_snapshot.findMany({
      where: {
        company_code: companyCode,
        item_code: { in: itemCodes },
        snapshot_date: { lte: today },
      },
      select: {
        item_code: true,
        closing_balance: true,
        snapshot_date: true,
      },
      orderBy: {
        snapshot_date: 'desc',
      },
    });

    // Create a map of item_code to latest snapshot
    const snapshotMap = new Map<string, number>();
    snapshots.forEach((snapshot) => {
      if (!snapshotMap.has(snapshot.item_code)) {
        snapshotMap.set(snapshot.item_code, Number(snapshot.closing_balance));
      }
    });

    // Transform items to match ItemMaster interface
    const transformedItems = items.map((item) => ({
      item_code: item.item_code,
      item_name: item.item_name,
      item_type: item.item_type,
      uom: item.uom,
      end_stock: snapshotMap.get(item.item_code) || 0,
    }));

    return NextResponse.json(serializeBigInt(transformedItems));
  } catch (error) {
    console.error('[API Error] Failed to fetch items master:', error);
    return NextResponse.json(
      { message: 'Error fetching items master' },
      { status: 500 }
    );
  }
}
