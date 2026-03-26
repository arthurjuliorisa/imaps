import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';

export async function GET(request: Request) {
  try {
    // Check authentication
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const session = authCheck.session as any;
    const userRole = session?.user?.role;
    const userCompanyCode = session?.user?.companyCode;
    const isSuperAdmin = userRole === 'SUPER_ADMIN';

    // Build where clause
    const where: any = {
      status: 'ACTIVE',
    };

    // ===================== COMPANY FILTERING LOGIC =====================
    // SUPER_ADMIN can see all companies
    // Other roles only see their assigned company
    if (!isSuperAdmin && userCompanyCode) {
      where.code = parseInt(userCompanyCode, 10);
    }

    // Get companies
    const companies = await prisma.companies.findMany({
      where,
      select: {
        code: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return NextResponse.json(companies);
  } catch (error) {
    console.error('[API Error] Failed to fetch user companies:', error);
    return NextResponse.json([], { status: 500 });
  }
}
