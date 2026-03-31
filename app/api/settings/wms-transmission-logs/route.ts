import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';

export async function GET(request: NextRequest) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const actionFilter = searchParams.get('action');
    const errorTypeFilter = searchParams.get('error_type');
    const transmissionStatusFilter = searchParams.get('transmission_status');
    const companyCodeFilter = searchParams.get('company_code');

    // Build where clause
    const where: any = {};

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = new Date(dateFrom);
      if (dateTo) where.created_at.lte = new Date(dateTo);
    }

    if (actionFilter && actionFilter !== 'ALL') {
      where.action = { contains: actionFilter };
    }

    if (errorTypeFilter && errorTypeFilter !== 'ALL') {
      where.error_type = errorTypeFilter;
    }

    if (transmissionStatusFilter && transmissionStatusFilter !== 'ALL') {
      where.transmission_status = transmissionStatusFilter;
    }

    if (companyCodeFilter && companyCodeFilter !== 'ALL') {
      where.company_code = parseInt(companyCodeFilter);
    }

    // Fetch logs
    const [logs, total] = await Promise.all([
      prisma.wms_transmission_logs.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { created_at: 'desc' },
      }),
      prisma.wms_transmission_logs.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: serializeBigInt(logs),
      pagination: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch WMS transmission logs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch WMS transmission logs' },
      { status: 500 }
    );
  }
}
