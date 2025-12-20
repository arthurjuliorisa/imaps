import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';

export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const user = session.user;
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Parse companyCode as integer
    const companyCode = parseInt(user.companyCode);
    if (!companyCode || isNaN(companyCode)) {
      return NextResponse.json(
        { message: 'Invalid company code' },
        { status: 400 }
      );
    }

    // Query from vw_lpj_wip view (WIP balances with stock_date)
    let query = `
      SELECT
        no,
        company_code,
        company_name,
        item_code,
        item_name,
        item_type,
        unit_quantity as unit,
        quantity,
        stock_date,
        remarks
      FROM vw_lpj_wip
      WHERE company_code = $1
    `;

    const params: any[] = [companyCode];
    let paramIndex = 2;

    // Add date filtering if provided
    if (startDate) {
      query += ` AND stock_date >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }
    if (endDate) {
      query += ` AND stock_date <= $${paramIndex}`;
      params.push(new Date(endDate));
      paramIndex++;
    }

    query += ` ORDER BY stock_date DESC, item_code`;

    const result = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    // Transform to expected format
    const transformedData = result.map((row: any) => ({
      id: `${row.item_code}-${row.stock_date}`,
      rowNumber: row.no,
      companyCode: row.company_code,
      companyName: row.company_name,
      itemCode: row.item_code,
      itemName: row.item_name,
      itemType: row.item_type,
      unit: row.unit || 'N/A',
      date: row.stock_date,
      beginning: 0, // WIP doesn't have opening/closing - just quantity at date
      in: 0,
      out: 0,
      adjustment: 0,
      ending: Number(row.quantity || 0),
      stockOpname: 0,
      variant: 0,
      remarks: row.remarks,
    }));

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error('[API Error] Failed to fetch WIP records:', error);
    return NextResponse.json(
      { message: 'Error fetching WIP records' },
      { status: 500 }
    );
  }
}
