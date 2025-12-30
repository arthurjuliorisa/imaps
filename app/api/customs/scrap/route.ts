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

    // Validate company code with detailed error messages
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // Query function directly with custom date range
    // This allows flexible date filtering instead of hardcoded view behavior
    let startDateParam = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1); // Default: Jan 1
    let endDateParam = endDate ? new Date(endDate) : new Date(); // Default: Today

    const query = `
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
      FROM fn_calculate_lpj_barang_sisa(
        ARRAY['SCRAP'],
        $1::DATE,
        $2::DATE
      )
      WHERE company_code = $3
      ORDER BY item_code
    `;

    const params = [startDateParam, endDateParam, companyCode];

    const result = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    console.log('[DEBUG] Raw result count:', result.length);
    if (result.length > 0) {
      console.log('[DEBUG] First record keys:', Object.keys(result[0]));
    }


    // Transform to expected format
    const transformedData = result.map((row: any, index: number) => ({
      id: `${row.item_code}-${row.snapshot_date}-${index}`,
      rowNumber: row.no || (index + 1),
      companyCode: row.company_code,
      companyName: row.company_name,
      itemCode: row.item_code,
      itemName: row.item_name,
      itemType: row.item_type,
      unit: row.unit || 'N/A',
      date: row.snapshot_date,
      beginning: Number(row.beginning || 0),
      in: Number(row.in || 0),
      out: Number(row.out || 0),
      adjustment: Number(row.adjustment || 0),
      ending: Number(row.ending || 0),
      stockOpname: Number(row.stockOpname || 0),
      variant: Number(row.variant || 0),
      valueAmount: Number(row.value_amount || 0),
      currency: row.currency,
      remarks: row.remarks,
    }));

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error('[API Error] Failed to fetch scrap mutations:', error);
    return NextResponse.json(
      { message: 'Error fetching scrap mutations', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
