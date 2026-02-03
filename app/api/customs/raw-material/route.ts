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

    // Query from function with custom date range support
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

    // Use dates from frontend request
    // Frontend is responsible for sending correct start_date and end_date
    if (startDate && endDate) {
      // Use EXACTLY what frontend provided
      params.push(new Date(startDate), new Date(endDate));
    } else {
      // Fallback: Default to Jan 1 - Today (year-to-date)
      const currentDate = new Date();
      const yearStart = new Date(currentDate.getFullYear(), 0, 1);
      params.push(yearStart, currentDate);
    }

    query += ` ORDER BY item_code`;

    const result = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    // Transform to expected format
    const transformedData = result.map((row: any, index: number) => ({
      id: `${row.item_code}-${row.snapshot_date}-${index}`,
      rowNumber: row.no,
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
      remarks: null,
    }));

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error('[API Error] Failed to fetch raw material mutations:', error);
    return NextResponse.json(
      { message: 'Error fetching raw material mutations' },
      { status: 500 }
    );
  }
}
