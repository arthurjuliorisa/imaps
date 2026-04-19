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

    const session = authCheck.session as any;
    const userCompanyCode = session?.user?.companyCode;
    const userRole = session?.user?.role;
    const isSuperAdmin = userRole === 'SUPER_ADMIN';

    const { searchParams } = new URL(request.url);
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const actionFilter = searchParams.get('action');
    const errorTypeFilter = searchParams.get('error_type');
    const transmissionStatusFilter = searchParams.get('transmission_status');
    const companyCodeFilter = searchParams.get('company_code');

    // Pagination parameters
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 10), 500);
    const offset = (page - 1) * limit;

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

    // ===================== COMPANY FILTERING LOGIC =====================
    // SUPER_ADMIN can view all WMS logs or filter by specific company
    // Non-SUPER_ADMIN can only view logs from their assigned company
    if (companyCodeFilter && companyCodeFilter !== 'ALL') {
      const requestedCompanyCode = parseInt(companyCodeFilter, 10);

      // Authorization check: prevent non-SUPER_ADMIN from accessing other companies
      if (!isSuperAdmin && requestedCompanyCode !== parseInt(userCompanyCode || '0', 10)) {
        return NextResponse.json(
          { success: false, data: [], error: 'Unauthorized - cannot access other company logs' },
          { status: 403 }
        );
      }

      where.company_code = requestedCompanyCode;
    } else if (!isSuperAdmin && userCompanyCode) {
      // Non-SUPER_ADMIN users always see only their company's logs by default
      where.company_code = parseInt(userCompanyCode, 10);
    }
    // SUPER_ADMIN with no company filter: see all company logs (no where clause)

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

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return NextResponse.json({
      success: true,
      data: serializeBigInt(logs),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage,
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
