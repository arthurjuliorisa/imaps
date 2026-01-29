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
    const stockDate = searchParams.get('stockDate');

    // Validate company code with detailed error messages
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // console.log('[WIP API] Company Code from session:', companyCode);
    // console.log('[WIP API] Session user:', session.user?.email, 'Company:', session.user?.companyCode);

    // Query from vw_lpj_wip view (Laporan Posisi Barang Dalam Proses at specific date)
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
    if (stockDate) {
      query += ` AND stock_date = $${paramIndex}::DATE`;
      params.push(stockDate);
      paramIndex++;
    }

    query += ` ORDER BY item_code`;

    // console.log('[WIP API] Query:', query);
    // console.log('[WIP API] Params:', params);

    const result = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    // console.log('[WIP API] Query result count:', result.length);

    // Transform to match vw_lpj_wip structure
    const transformedData = result.map((row: any, index: number) => ({
      id: `${row.item_code}-${row.stock_date}-${index}`,
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
    console.error('[API Error] Failed to fetch Laporan Posisi Barang Dalam Proses records:', error);
    return NextResponse.json(
      { message: 'Gagal mengambil data Laporan Posisi Barang Dalam Proses' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };

    // Validate company code with detailed error messages
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // Get latest stock date for this company
    const latestDateResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT MAX(stock_date) as latest_date FROM vw_lpj_wip WHERE company_code = $1`,
      companyCode
    );

    const latestDate = latestDateResult[0]?.latest_date;

    if (!latestDate) {
      return NextResponse.json({ latestDate: null });
    }

    // Format the date to YYYY-MM-DD
    const formattedDate = latestDate.toISOString().split('T')[0];

    return NextResponse.json({ latestDate: formattedDate });
  } catch (error) {
    console.error('[API Error] Failed to fetch latest stock date:', error);
    return NextResponse.json(
      { message: 'Error fetching latest stock date' },
      { status: 500 }
    );
  }
}
