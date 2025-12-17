import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/bigint-serializer';

// TODO: Re-enable when activity_logs table is added back to schema
// Currently the schema only has audit_logs which has a different structure
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');
    const exportData = searchParams.get('export') === 'true';

    // If export, return empty CSV
    if (exportData) {
      const headers = ['Date & Time', 'User', 'Email', 'Action', 'Description', 'Status', 'IP Address'];
      const csv = headers.join(',');

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="activity-logs-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    // Return empty data - activity_logs table doesn't exist in current schema
    return NextResponse.json({
      data: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
      message: 'Activity logs feature is currently disabled. Please add activity_logs table to schema.',
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch activity logs:', error);

    // Return empty data instead of error to allow graceful degradation
    return NextResponse.json({
      data: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
