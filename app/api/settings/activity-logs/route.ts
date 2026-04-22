import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { checkAuth } from '@/lib/api-auth';

export async function GET(request: Request) {
  try {
    // Check authentication
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const session = authCheck.session as any;
    const userCompanyCode = session?.user?.companyCode;
    const userRole = session?.user?.role;
    const isSuperAdmin = userRole === 'SUPER_ADMIN';

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const companyCodeParam = searchParams.get('companyCode');
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);

    // Pagination parameters
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 10), 500);
    const offset = (page - 1) * limit;

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

    // ===================== COMPANY FILTERING LOGIC =====================
    // SUPER_ADMIN can view all activity logs or filter by specific company
    // Non-SUPER_ADMIN can only view logs from their assigned company
    // Note: company_code is denormalized in activity_logs for direct filtering (no JOIN needed)
    if (companyCodeParam && companyCodeParam !== 'ALL') {
      const requestedCompanyCode = parseInt(companyCodeParam, 10);

      // Authorization check: prevent non-SUPER_ADMIN from accessing other companies
      if (!isSuperAdmin && requestedCompanyCode !== parseInt(userCompanyCode || '0', 10)) {
        return NextResponse.json({ success: false, data: [], pagination: { page, limit, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false } }, { status: 403 });
      }

      where.company_code = requestedCompanyCode;
    } else if (!isSuperAdmin && userCompanyCode) {
      // Non-SUPER_ADMIN users always see only their company's logs by default
      where.company_code = parseInt(userCompanyCode, 10);
    }
    // SUPER_ADMIN with no company filter: see all company logs (no where clause)

    // Get total count for pagination
    const totalCount = await prisma.activity_logs.count({ where });

    // Fetch paginated logs
    const logs = await prisma.activity_logs.findMany({
      where,
      include: {
        users: {
          select: {
            id: true,
            username: true,
            email: true,
            full_name: true,
            company_code: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
      skip: offset,
    });

    // Transform data for frontend
    const data = logs.map(log => ({
      id: serializeBigInt(log.id),
      userId: log.user_id,
      companyCode: log.company_code,
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

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch activity logs:', error);

    return NextResponse.json(
      { success: false, data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false }, error: String(error) },
      { status: 500 }
    );
  }
}
