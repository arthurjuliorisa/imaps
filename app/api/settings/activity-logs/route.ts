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

    // Build where clause
    const where: any = {};

    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { users: { email: { contains: search, mode: 'insensitive' } } },
        { users: { username: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status && status !== 'ALL') {
      where.status = status.toLowerCase();
    }

    // Get total count
    const total = await prisma.activity_logs.count({ where });

    // Get paginated data
    const logs = await prisma.activity_logs.findMany({
      where,
      include: {
        users: {
          select: {
            id: true,
            username: true,
            email: true,
            full_name: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // If export, return CSV
    if (exportData) {
      const headers = ['Date & Time', 'User', 'Email', 'Action', 'Description', 'Status', 'IP Address'];
      const rows = logs.map(log => [
        log.created_at.toISOString(),
        log.users?.username || 'System',
        log.users?.email || '-',
        log.action,
        log.description,
        log.status,
        log.ip_address || '-',
      ]);

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
      ].join('\n');

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="activity-logs-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    // Transform data for frontend
    const data = logs.map(log => ({
      id: serializeBigInt(log.id),
      userId: log.user_id,
      user: {
        username: log.users?.username || 'System',
        email: log.users?.email || '-',
      },
      action: log.action,
      description: log.description,
      status: log.status,
      metadata: log.metadata,
      ipAddress: log.ip_address,
      userAgent: log.user_agent,
      createdAt: log.created_at.toISOString(),
    }));

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch activity logs:', error);

    return NextResponse.json({
      data: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
