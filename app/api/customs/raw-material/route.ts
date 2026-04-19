import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';

export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Extract and validate pagination parameters
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    
    // Validate pagination values (min 10, max 500 per page)
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 10), 500);
    const offset = (page - 1) * limit;

    // Validate company code with detailed error messages
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // Query from function with custom date range support and pagination
    let query = `
      SELECT
        no,
        company_code,
        company_name,
        item_code,
        item_name,
        item_type,
        unit_quantity as unit,
        snapshot_date,
        opening_balance as beginning,
        quantity_received as "in",
        quantity_issued_outgoing as "out",
        adjustment,
        closing_balance as ending,
        stock_count_result as "stockOpname",
        quantity_difference as variant,
        value_amount,
        currency,
        remarks
      FROM fn_calculate_lpj_bahan_baku(
        ARRAY['ROH', 'HALB', 'HIBE'],
        $2::DATE,
        $3::DATE
      )
      WHERE company_code = $1
    `;

    const params: any[] = [companyCode];
    let paramIndex = 2;

    // Use provided dates or fallback to defaults
    let startDateParam: Date;
    let endDateParam: Date;

    if (startDate) {
      startDateParam = new Date(startDate);
    } else {
      // Default: Jan 1 of current year (year-to-date)
      const currentDate = new Date();
      startDateParam = new Date(currentDate.getFullYear(), 0, 1);
    }

    if (endDate) {
      endDateParam = new Date(endDate);
    } else {
      // Default: Today
      endDateParam = new Date();
    }

    params.push(startDateParam, endDateParam);
    paramIndex += 2;

    query += ` ORDER BY item_code`;

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT ROW(item_code, unit_quantity)) as count
      FROM fn_calculate_lpj_bahan_baku(
        ARRAY['ROH', 'HALB', 'HIBE'],
        $2::DATE,
        $3::DATE
      )
      WHERE company_code = $1
    `;
    
    const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      countQuery,
      companyCode,
      startDateParam,
      endDateParam
    );
    const totalCount = Number(countResult[0]?.count ?? 0);

    // Add pagination to main query
    query += ` LIMIT $${paramIndex}::integer OFFSET $${paramIndex + 1}::integer`;
    params.push(limit, offset);

    const result = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    // Transform to expected format with data-based ID and decimal precision preservation
    const transformedData = result.map((row: any) => ({
      id: `${Number(row.company_code)}-${row.item_code}-${row.unit}`,
      rowNumber: Number(row.no ?? 0),
      companyCode: Number(row.company_code ?? 0),
      companyName: row.company_name,
      itemCode: row.item_code,
      itemName: row.item_name,
      itemType: row.item_type,
      unit: row.unit || 'N/A',
      date: row.snapshot_date,
      // Return as strings to preserve decimal precision
      beginning: row.beginning?.toString() ?? '0',
      in: row.in?.toString() ?? '0',
      out: row.out?.toString() ?? '0',
      adjustment: row.adjustment?.toString() ?? '0',
      ending: row.ending?.toString() ?? '0',
      stockOpname: row.stockOpname?.toString() ?? '0',
      variant: row.variant?.toString() ?? '0',
      valueAmount: row.value_amount?.toString() ?? '0',
      currency: row.currency || 'IDR',
      remarks: row.remarks,
    }));

    return NextResponse.json(
      serializeBigInt({
        success: true,
        data: transformedData,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
      })
    );
  } catch (error) {
    console.error('[API Error] Failed to fetch raw material mutations:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Error fetching raw material mutations',
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
