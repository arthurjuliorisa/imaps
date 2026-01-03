import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/log-activity';

/**
 * POST /api/admin/refresh-views
 *
 * Refreshes all 7 materialized views used for Indonesian customs compliance reporting.
 * This endpoint executes REFRESH MATERIALIZED VIEW CONCURRENTLY for each view.
 *
 * Authentication:
 * - Requires ADMIN_SECRET environment variable to be provided in the request body
 *
 * Request Body:
 * {
 *   "secret": "your-admin-secret",
 *   "views": ["all"] | ["mv_laporan_pemasukan", "mv_laporan_pengeluaran", ...] (optional)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "All materialized views refreshed successfully",
 *   "results": [
 *     { "view": "mv_laporan_pemasukan", "status": "success", "rowCount": 150, "duration": 1234 },
 *     ...
 *   ],
 *   "totalDuration": 5678
 * }
 *
 * Error Response:
 * {
 *   "error": "Error message",
 *   "details": "Detailed error information"
 * }
 */

// List of all materialized views in order
const MATERIALIZED_VIEWS = [
  'mv_laporan_pemasukan',
  'mv_laporan_pengeluaran',
  'mv_mutasi_bahan_baku',
  'mv_posisi_wip',
  'mv_mutasi_finished_goods',
  'mv_mutasi_capital_goods',
  'mv_mutasi_scrap',
] as const;

type MaterializedView = typeof MATERIALIZED_VIEWS[number];

interface RefreshResult {
  view: string;
  status: 'success' | 'error';
  rowCount?: number;
  duration: number;
  error?: string;
}

/**
 * Refresh a single materialized view concurrently
 */
async function refreshView(viewName: MaterializedView): Promise<RefreshResult> {
  const startTime = Date.now();

  try {
    // Refresh the materialized view concurrently
    // CONCURRENTLY allows reads during refresh but requires unique index
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY ${Prisma.raw(viewName)}`;

    // Get row count after refresh
    const countResult = await prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count FROM ${Prisma.raw(viewName)}`;

    const rowCount = Number(countResult[0]?.count ?? 0);
    const duration = Date.now() - startTime;

    return {
      view: viewName,
      status: 'success',
      rowCount,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      view: viewName,
      status: 'error',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Analyze all materialized views for query optimization
 */
async function analyzeViews(): Promise<void> {
  for (const viewName of MATERIALIZED_VIEWS) {
    await prisma.$executeRaw`ANALYZE ${Prisma.raw(viewName)}`;
  }
}

export async function POST(request: Request) {
  const overallStartTime = Date.now();

  try {
    // Parse request body
    const body = await request.json();

    // Validate admin secret
    if (body.secret !== process.env.ADMIN_SECRET) {
      await logActivity({
        action: 'REFRESH_VIEWS_FAILED',
        description: 'Unauthorized attempt to refresh materialized views',
        metadata: {
          reason: 'Invalid admin secret',
        },
      });

      return NextResponse.json(
        { error: 'Unauthorized', details: 'Invalid admin secret' },
        { status: 401 }
      );
    }

    // Determine which views to refresh
    let viewsToRefresh: MaterializedView[] = MATERIALIZED_VIEWS as unknown as MaterializedView[];

    if (body.views && Array.isArray(body.views) && body.views[0] !== 'all') {
      // Validate requested views
      const invalidViews = body.views.filter(
        (v: string) => !MATERIALIZED_VIEWS.includes(v as MaterializedView)
      );

      if (invalidViews.length > 0) {
        return NextResponse.json(
          {
            error: 'Invalid view names',
            details: `Unknown views: ${invalidViews.join(', ')}`,
            availableViews: MATERIALIZED_VIEWS,
          },
          { status: 400 }
        );
      }

      viewsToRefresh = body.views;
    }

    // Refresh views sequentially (concurrent refresh locks are handled by PostgreSQL)
    const results: RefreshResult[] = [];

    for (const viewName of viewsToRefresh) {
      const result = await refreshView(viewName);
      results.push(result);

      // Log each view refresh
      // console.log(
      //   `[Materialized View] ${result.view}: ${result.status} - ${result.rowCount ?? 0} rows in ${result.duration}ms`
      // );
    }

    // Analyze views for query optimization
    await analyzeViews();

    const totalDuration = Date.now() - overallStartTime;
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const totalRows = results.reduce((sum, r) => sum + (r.rowCount ?? 0), 0);

    // Log activity
    await logActivity({
      action: 'REFRESH_VIEWS',
      description: `Refreshed ${successCount} of ${results.length} materialized views successfully`,
      metadata: {
        viewsRefreshed: successCount,
        viewsFailed: errorCount,
        totalRows,
        totalDuration,
        results: results.map(r => ({
          view: r.view,
          status: r.status,
          rowCount: r.rowCount,
          duration: r.duration,
        })),
      },
    });

    // Return results
    if (errorCount > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `${successCount} of ${results.length} views refreshed successfully, ${errorCount} failed`,
          results,
          totalDuration,
          statistics: {
            total: results.length,
            success: successCount,
            error: errorCount,
            totalRows,
          },
        },
        { status: 207 } // Multi-Status
      );
    }

    return NextResponse.json({
      success: true,
      message: 'All materialized views refreshed successfully',
      results,
      totalDuration,
      statistics: {
        total: results.length,
        success: successCount,
        error: errorCount,
        totalRows,
      },
    });
  } catch (error) {
    console.error('Error refreshing materialized views:', error);

    // Log failed activity
    await logActivity({
      action: 'REFRESH_VIEWS_FAILED',
      description: 'Failed to refresh materialized views',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return NextResponse.json(
      {
        error: 'Failed to refresh materialized views',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/refresh-views
 *
 * Returns information about available materialized views and their current status
 */
export async function GET(request: Request) {
  try {
    // Get URL and check for secret
    const url = new URL(request.url);
    const secret = url.searchParams.get('secret');

    // Validate admin secret
    if (secret !== process.env.ADMIN_SECRET) {
      return NextResponse.json(
        { error: 'Unauthorized', details: 'Invalid admin secret' },
        { status: 401 }
      );
    }

    // Get information about each materialized view
    const viewsInfo = await Promise.all(
      MATERIALIZED_VIEWS.map(async (viewName) => {
        try {
          // Get row count
          const countResult = await prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count FROM ${Prisma.raw(viewName)}`;

          const rowCount = Number(countResult[0]?.count ?? 0);

          // Get last refresh time from pg_stat_user_tables
          const statsResult = await prisma.$queryRaw<
            [{ last_vacuum?: Date; last_analyze?: Date }]
          >`SELECT last_vacuum, last_analyze
             FROM pg_stat_user_tables
             WHERE schemaname = 'public' AND relname = ${viewName}`;

          return {
            name: viewName,
            rowCount,
            lastAnalyze: statsResult[0]?.last_analyze ?? null,
            status: 'available',
          };
        } catch (error) {
          return {
            name: viewName,
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      views: viewsInfo,
      totalViews: MATERIALIZED_VIEWS.length,
      availableViews: MATERIALIZED_VIEWS,
    });
  } catch (error) {
    console.error('Error getting materialized views info:', error);

    return NextResponse.json(
      {
        error: 'Failed to get materialized views information',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
