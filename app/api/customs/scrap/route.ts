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
    const search = searchParams.get('search')?.trim();
    const itemType = searchParams.get('itemType')?.trim();

    // Extract and validate pagination parameters
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    
    // Validate pagination values (min 5, max 500 per page)
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 5), 500);
    const offset = (page - 1) * limit;

    // Validate company code with detailed error messages
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // Query from function with custom date range support and pagination
    let query = `
      WITH lpj AS (
        SELECT *
        FROM fn_calculate_lpj_barang_sisa(
          ARRAY['SCRAP'],
          $2::DATE,
          $3::DATE
        )
      ),
      range_adjustments AS (
        SELECT
          company_code,
          item_code,
          uom,
          SUM(adjustment_qty)::NUMERIC(15,3) AS adjustment
        FROM stock_daily_snapshot
        WHERE item_type = 'SCRAP'
          AND company_code = $1
          AND snapshot_date BETWEEN $2::DATE AND $3::DATE
        GROUP BY company_code, item_code, uom
      )
      SELECT
        lpj.no,
        lpj.company_code,
        lpj.company_name,
        lpj.item_code,
        lpj.item_name,
        lpj.item_type,
        lpj.unit_quantity as unit,
        lpj.snapshot_date,
        lpj.opening_balance as beginning,
        lpj.quantity_received as "in",
        lpj.quantity_issued_outgoing as "out",
        COALESCE(range_adjustments.adjustment, lpj.adjustment, 0::NUMERIC(15,3)) as adjustment,
        lpj.closing_balance as ending,
        lpj.stock_count_result as "stockOpname",
        lpj.quantity_difference as variant,
        lpj.value_amount,
        lpj.currency,
        lpj.remarks
      FROM lpj
      LEFT JOIN range_adjustments
        ON range_adjustments.company_code = lpj.company_code
       AND range_adjustments.item_code = lpj.item_code
       AND COALESCE(range_adjustments.uom, 'UNIT') = lpj.unit_quantity
      WHERE lpj.company_code = $1
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

    if (itemType) {
      query += ` AND lpj.item_type = $${paramIndex}`;
      params.push(itemType);
      paramIndex++;
    }

    if (search) {
      query += ` AND (
        lpj.company_name ILIKE $${paramIndex}
        OR lpj.item_code ILIKE $${paramIndex}
        OR lpj.item_name ILIKE $${paramIndex}
        OR lpj.item_type ILIKE $${paramIndex}
        OR lpj.unit_quantity ILIKE $${paramIndex}
        OR COALESCE(lpj.remarks, '') ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY lpj.item_code`;

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT ROW(item_code, unit_quantity)) as count
      FROM fn_calculate_lpj_barang_sisa(
        ARRAY['SCRAP'],
        $2::DATE,
        $3::DATE
      )
      WHERE company_code = $1
    `;

    const countParams: any[] = [companyCode, startDateParam, endDateParam];
    let countParamIndex = 4;

    if (itemType) {
      countQuery += ` AND item_type = $${countParamIndex}`;
      countParams.push(itemType);
      countParamIndex++;
    }

    if (search) {
      countQuery += ` AND (
        company_name ILIKE $${countParamIndex}
        OR item_code ILIKE $${countParamIndex}
        OR item_name ILIKE $${countParamIndex}
        OR item_type ILIKE $${countParamIndex}
        OR unit_quantity ILIKE $${countParamIndex}
        OR COALESCE(remarks, '') ILIKE $${countParamIndex}
      )`;
      countParams.push(`%${search}%`);
    }
    
    const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      countQuery,
      ...countParams
    );
    const totalCount = Number(countResult[0]?.count ?? 0);

    // Add pagination to main query
    query += ` LIMIT $${paramIndex}::integer OFFSET $${paramIndex + 1}::integer`;
    params.push(limit, offset);

    const result = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    // Transform to expected format with decimal precision preservation
    const transformedData = result.map((row: any, index: number) => ({
      id: `scrap-${row.item_code}-${row.snapshot_date}-${index}`,
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
      remarks: '-',
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
    console.error('[API Error] Failed to fetch scrap mutations:', error);
    if (error instanceof Error) {
      console.error('[API Error] Error message:', error.message);
      console.error('[API Error] Error stack:', error.stack);
    }
    return NextResponse.json(
      { message: 'Error fetching scrap mutations', error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
