import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';

/**
 * Parse PostgreSQL array field to JavaScript array
 * Handles format: {id1,id2,id3} or null
 */
function parseArrayField(field: any): string[] {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  if (typeof field === 'string') {
    // Handle PostgreSQL array format: {id1,id2,id3}
    return field.replace(/[{}]/g, '').split(',').filter(Boolean);
  }
  return [];
}

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

    // Parse companyCode as integer
    const companyCode = parseInt(session.user.companyCode);
    if (!companyCode || isNaN(companyCode)) {
      return NextResponse.json(
        { message: 'Invalid company code' },
        { status: 400 }
      );
    }

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
        production_output_wms_ids,
        created_at
      FROM vw_laporan_pengeluaran
      WHERE company_code = $1
    `;

    const params: any[] = [companyCode];
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
      companyName: row.company_name,
      documentType: row.customs_document_type,
      ppkekNumber: row.ppkek_number,
      registrationDate: row.registration_date,
      documentNumber: row.doc_number,
      date: row.doc_date,
      recipientName: row.recipient_name,
      typeCode: row.type_code,
      itemCode: row.item_code,
      itemName: row.item_name,
      unit: row.unit,
      qty: Number(row.quantity || 0),
      currency: row.currency,
      amount: Number(row.value_amount || 0),
      productionOutputWmsIds: parseArrayField(row.production_output_wms_ids),
      createdAt: row.created_at,
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
