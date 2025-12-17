import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/bigint-serializer';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const exportData = searchParams.get('export') === 'true';

    const skip = (page - 1) * pageSize;

    // Build where clause
    const where: any = {};

    if (search) {
      where.OR = [
        { action: { contains: search } },
        { description: { contains: search } },
        { users: { username: { contains: search } } },
      ];
    }

    if (status && status !== 'ALL') {
      where.status = status;
    }

    // If export, get all data
    if (exportData) {
      const logs = await prisma.activity_logs.findMany({
        where,
        orderBy: { created_at: 'desc' },
        include: {
          users: {
            select: {
              username: true,
              email: true,
            },
          },
        },
      });

      // Convert to CSV
      const headers = ['Date & Time', 'User', 'Email', 'Action', 'Description', 'Status', 'IP Address'];
      const csvData = logs.map(log => [
        new Date(log.created_at).toLocaleString(),
        log.users?.username || 'Unknown',
        log.users?.email || '-',
        log.action,
        log.description,
        log.status,
        log.ip_address || '-',
      ]);

      const csv = [
        headers.join(','),
        ...csvData.map(row => row.map(cell => `"${cell}"`).join(',')),
      ].join('\n');

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="activity-logs-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    // Get paginated data
    const [logs, total] = await Promise.all([
      prisma.activity_logs.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { created_at: 'desc' },
        include: {
          users: {
            select: {
              username: true,
              email: true,
            },
          },
        },
      }),
      prisma.activity_logs.count({ where }),
    ]);

    return NextResponse.json({
      data: logs,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
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
