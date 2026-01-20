import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/bigint-serializer';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
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

    // Get all data (client-side pagination will be handled by DataTable)
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

    return NextResponse.json(data);
  } catch (error) {
    console.error('[API Error] Failed to fetch activity logs:', error);

    return NextResponse.json([], { status: 500 });
  }
}
