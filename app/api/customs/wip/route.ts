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

    // Query from vw_lpj_wip view (WIP balances with stock_date)
    // Returns all fields except company_code and updated_at
    let query = `
      SELECT
        no,
        company_name,
        item_code,
        item_name,
        item_type,
        unit_quantity,
        quantity,
        stock_date,
        remarks,
        created_at
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

    // Transform to match vw_lpj_wip structure
    const transformedData = result.map((row: any) => ({
      id: `${row.item_code}-${row.stock_date}`,
      no: Number(row.no),
      companyName: row.company_name,
      itemCode: row.item_code,
      itemName: row.item_name,
      itemType: row.item_type,
      unitQuantity: row.unit_quantity,
      quantity: Number(row.quantity || 0),
      stockDate: row.stock_date,
      remarks: row.remarks,
      createdAt: row.created_at,
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
