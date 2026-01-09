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

    // Query from vw_laporan_pemasukan view with date filtering
    // Filter by doc_date OR reg_date within the date range
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
        shipper_name,
        type_code,
        item_code,
        item_name,
        unit,
        quantity,
        currency,
        value_amount,
        created_at
      FROM vw_laporan_pemasukan
      WHERE company_code = $1
    `;

    const params: any[] = [companyCode];
    let paramIndex = 2;

    // Apply date range filter using OR condition for both doc_date and reg_date
    if (startDate && endDate) {
      query += ` AND (
        (doc_date::date >= $${paramIndex}::date AND doc_date::date <= $${paramIndex + 1}::date)
        OR
        (reg_date::date >= $${paramIndex}::date AND reg_date::date <= $${paramIndex + 1}::date)
      )`;
      params.push(startDate, endDate);
      paramIndex += 2;
    } else if (startDate) {
      query += ` AND (doc_date::date >= $${paramIndex}::date OR reg_date::date >= $${paramIndex}::date)`;
      params.push(startDate);
      paramIndex++;
    } else if (endDate) {
      query += ` AND (doc_date::date <= $${paramIndex}::date OR reg_date::date <= $${paramIndex}::date)`;
      params.push(endDate);
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
      shipperName: row.shipper_name,
      typeCode: row.type_code,
      itemCode: row.item_code,
      itemName: row.item_name,
      unit: row.unit,
      qty: Number(row.quantity || 0),
      currency: row.currency,
      amount: Number(row.value_amount || 0),
      createdAt: row.created_at,
    }));

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error('[API Error] Failed to fetch incoming documents:', error);
    return NextResponse.json(
      { message: 'Error fetching incoming documents' },
      { status: 500 }
    );
  }
}
