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
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Query from vw_laporan_pengeluaran view with date filtering
    let query = `
      SELECT
        id,
        company_code,
        company_name,
        customs_document_type,
        cust_doc_registration_no as ppkek_number,
        reg_date as registration_date,
        doc_number,
        doc_date,
        recipient_name,
        type_code,
        item_code,
        item_name,
        unit,
        quantity,
        currency,
        value_amount,
        production_output_wms_ids
      FROM vw_laporan_pengeluaran
      WHERE company_code = $1
    `;

    const params: any[] = [session.user.companyCode];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND doc_date >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }
    if (endDate) {
      query += ` AND doc_date <= $${paramIndex}`;
      params.push(new Date(endDate));
      paramIndex++;
    }

    query += ` ORDER BY doc_date DESC, id`;

    const result = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    // Transform to expected format
    const transformedData = result.map((row: any) => ({
      id: `${row.id}-${row.item_code}`,
      wmsId: row.id,
      companyCode: row.company_code,
      documentType: row.customs_document_type,
      ppkekNumber: row.ppkek_number,
      registrationDate: row.registration_date,
      documentNumber: row.doc_number,
      date: row.doc_date,
      recipientName: row.recipient_name,
      itemCode: row.item_code,
      itemName: row.item_name,
      unit: row.unit,
      qty: Number(row.quantity || 0),
      currency: row.currency,
      amount: Number(row.value_amount || 0),
    }));

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error('[API Error] Failed to fetch outgoing documents:', error);
    return NextResponse.json(
      { message: 'Error fetching outgoing documents' },
      { status: 500 }
    );
  }
}
