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

    // Query from vw_internal_incoming view with date filtering
    let query = `
      SELECT
        id,
        company_code,
        company_name,
        internal_evidence_number as document_number,
        transaction_date,
        section,
        type_code,
        item_code,
        item_name,
        unit,
        quantity,
        value_amount
      FROM vw_internal_incoming
      WHERE company_code = $1
    `;

    const params: any[] = [companyCode];
    let paramIndex = 2;

    // Apply date range filter
    if (startDate && endDate) {
      query += ` AND transaction_date::date >= $${paramIndex}::date AND transaction_date::date <= $${paramIndex + 1}::date`;
      params.push(startDate, endDate);
      paramIndex += 2;
    } else if (startDate) {
      query += ` AND transaction_date::date >= $${paramIndex}::date`;
      params.push(startDate);
      paramIndex++;
    } else if (endDate) {
      query += ` AND transaction_date::date <= $${paramIndex}::date`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY transaction_date DESC, id`;

    const result = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    // Transform to expected format
    const transformedData = result.map((row: any, index: number) => ({
      id: `${row.id}-${row.item_code}-${index}`,
      companyCode: row.company_code,
      companyName: row.company_name,
      documentNumber: row.document_number,
      date: row.transaction_date,
      section: row.section,
      typeCode: row.type_code,
      itemCode: row.item_code,
      itemName: row.item_name,
      unit: row.unit,
      qty: Number(row.quantity || 0),
      currency: 'USD', // Default currency, can be updated if currency field is added to view
      amount: Number(row.value_amount || 0),
    }));

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error(
      '[API Error] Failed to fetch internal transaction incoming:',
      error
    );
    return NextResponse.json(
      { message: 'Error fetching internal transaction incoming data' },
      { status: 500 }
    );
  }
}
