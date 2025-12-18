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

    const { user } = authCheck;

    // Query from vw_lpj_barang_modal view (capital goods mutation)
    const result = await prisma.$queryRaw<any[]>`
      SELECT
        no,
        company_code,
        company_name,
        item_code,
        item_name,
        item_type,
        unit_quantity as unit,
        opening_balance as beginning,
        quantity_received as "in",
        quantity_issued_outgoing as "out",
        adjustment,
        closing_balance as ending,
        stock_count_result as "stockOpname",
        quantity_difference as variant,
        remarks
      FROM vw_lpj_barang_modal
      WHERE company_code = ${user.companyCode}
      ORDER BY item_code
    `;

    // Transform to expected format
    const transformedData = result.map((row: any) => ({
      id: `${row.item_code}-lpj`,
      itemCode: row.item_code,
      itemName: row.item_name,
      unit: row.unit || 'N/A',
      date: new Date(),
      beginning: Number(row.beginning || 0),
      in: Number(row.in || 0),
      out: Number(row.out || 0),
      adjustment: Number(row.adjustment || 0),
      ending: Number(row.ending || 0),
      stockOpname: Number(row.stockOpname || 0),
      variant: Number(row.variant || 0),
      remarks: row.remarks,
    }));

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error('[API Error] Failed to fetch capital goods mutations:', error);
    return NextResponse.json(
      { message: 'Error fetching capital goods mutations' },
      { status: 500 }
    );
  }
}
