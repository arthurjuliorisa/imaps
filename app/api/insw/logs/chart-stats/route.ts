import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/insw/logs/chart-stats
 * Returns aggregated SUCCESS and FAILED counts per day for the last 7 days
 * Response:
 * {
 *   success: true,
 *   data: [{ date: "2026-02-15", success: 12, failed: 3 }, ...]
 * }
 */
export async function GET() {
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

    const rows = await prisma.$queryRaw<Array<{
      day: Date;
      status: string;
      count: bigint;
    }>>`
      SELECT
        DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') AS day,
        insw_status AS status,
        COUNT(*) AS count
      FROM insw_tracking_log
      WHERE
        company_code = ${companyCode}
        AND created_at >= NOW() - INTERVAL '7 days'
        AND insw_status IN ('SUCCESS', 'FAILED')
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `;

    // Build a map of the last 7 days with zero defaults
    const dayMap = new Map<string, { date: string; success: number; failed: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      d.setUTCHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      dayMap.set(key, { date: key, success: 0, failed: 0 });
    }

    for (const row of rows) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      if (!dayMap.has(key)) continue;
      const entry = dayMap.get(key)!;
      if (row.status === 'SUCCESS') entry.success = Number(row.count);
      else if (row.status === 'FAILED') entry.failed = Number(row.count);
    }

    const data = Array.from(dayMap.values());

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching INSW chart stats:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch chart stats' },
      { status: 500 }
    );
  }
}
