import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';

/**
 * GET /api/customs/capital-goods
 *
 * This endpoint is temporarily disabled because it depends on the stock_daily_snapshot table
 * which has been removed from the schema.
 *
 * To re-enable this endpoint, either:
 * 1. Add the stock_daily_snapshot table back to the schema
 * 2. Implement real-time stock calculation from transaction tables
 */
export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    return NextResponse.json({
      success: false,
      message: 'This endpoint is temporarily disabled. The stock_daily_snapshot table has been removed from the schema.',
      data: []
    }, { status: 503 });
  } catch (error) {
    console.error('[API Error] Failed to fetch capital goods mutations:', error);
    return NextResponse.json(
      { message: 'Error fetching capital goods mutations' },
      { status: 500 }
    );
  }
}
