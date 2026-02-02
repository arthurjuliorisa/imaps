import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { logActivity } from '@/lib/log-activity';
import { generateStoNumber } from '@/lib/stock-opname-helpers';

/**
 * GET /api/customs/stock-opname
 * List all stock opnames with pagination, filter, search
 * Query params: page, limit, search, status, date_from, date_to
 */
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const dateFrom = searchParams.get('date_from') || '';
    const dateTo = searchParams.get('date_to') || '';

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      company_code: companyCode,
      deleted_at: null,
    };

    // Search by STO number or PIC name
    if (search) {
      where.OR = [
        { sto_number: { contains: search, mode: 'insensitive' } },
        { pic_name: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Filter by status
    if (status && ['OPEN', 'PROCESS', 'RELEASED'].includes(status)) {
      where.status = status;
    }

    // Filter by date range
    if (dateFrom && dateTo) {
      where.sto_datetime = {
        gte: new Date(dateFrom),
        lte: new Date(dateTo + 'T23:59:59.999Z'),
      };
    } else if (dateFrom) {
      where.sto_datetime = { gte: new Date(dateFrom) };
    } else if (dateTo) {
      where.sto_datetime = { lte: new Date(dateTo + 'T23:59:59.999Z') };
    }

    // Get total count
    const total = await prisma.stock_opnames.count({ where });

    // Get paginated data
    const data = await prisma.stock_opnames.findMany({
      where,
      skip,
      take: limit,
      orderBy: { sto_datetime: 'desc' },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    return NextResponse.json({
      data: serializeBigInt(data),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch stock opnames:', error);
    return NextResponse.json(
      { message: 'Error fetching stock opnames' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customs/stock-opname
 * Create new stock opname header
 * Body: { sto_date, pic_name }
 */
export async function POST(request: Request) {
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

    const body = await request.json();
    const { sto_date, pic_name } = body;

    // Validation
    if (!sto_date) {
      return NextResponse.json(
        { message: 'Field sto_date is required' },
        { status: 400 }
      );
    }

    const stoDatetime = new Date(sto_date);

    // Validate date is not in the future
    if (stoDatetime > new Date()) {
      return NextResponse.json(
        { message: 'Stock opname date cannot be in the future' },
        { status: 400 }
      );
    }

    // Generate STO number
    const stoNumber = await generateStoNumber(companyCode, stoDatetime);

    // Create stock opname header
    const stockOpname = await prisma.stock_opnames.create({
      data: {
        sto_number: stoNumber,
        company_code: companyCode,
        sto_datetime: stoDatetime,
        pic_name: pic_name || null,
        status: 'OPEN',
        created_by: session.user.username || session.user.email,
      },
    });

    // Log activity
    await logActivity({
      action: 'CREATE_STOCK_OPNAME',
      description: `Created stock opname: ${stoNumber}`,
      status: 'success',
      metadata: {
        stock_opname_id: stockOpname.id,
        sto_number: stoNumber,
        sto_datetime: stoDatetime,
      },
    });

    return NextResponse.json(serializeBigInt(stockOpname), { status: 201 });
  } catch (error) {
    console.error('[API Error] Failed to create stock opname:', error);

    // Log failed activity
    await logActivity({
      action: 'CREATE_STOCK_OPNAME',
      description: 'Failed to create stock opname',
      status: 'error',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return NextResponse.json(
      { message: 'Error creating stock opname' },
      { status: 500 }
    );
  }
}
