import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

/**
 * GET /api/dashboard/inventory-summary
 *
 * This endpoint is temporarily disabled because it depends on the stock_daily_snapshot table
 * which has been removed from the schema.
 *
 * To re-enable this endpoint, either:
 * 1. Add the stock_daily_snapshot table back to the schema
 * 2. Implement real-time stock calculation from transaction tables
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    success: false,
    message: 'This endpoint is temporarily disabled. The stock_daily_snapshot table has been removed from the schema.',
    summary: [],
    statistics: {
      totalItems: 0,
      itemsWithStock: 0,
      totalQuantity: 0,
      averageQuantityPerItem: 0,
    },
  }, { status: 503 });
}
