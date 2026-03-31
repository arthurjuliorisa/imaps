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

    // Fetch company type to determine field mapping for SEZ companies
    const company = await prisma.companies.findUnique({
      where: { code: companyCode },
      select: { company_type: true },
    });
    const companyType = company?.company_type || null;

    // Query from vw_internal_outgoing view with date filtering
    let query = `
      SELECT
        id,
        wms_id,
        company_code,
        company_name,
        internal_evidence_number as document_number,
        transaction_date,
        section,
        type_code,
        item_code_bahasa,
        item_code,
        item_name,
        unit,
        quantity,
        value_amount
      FROM vw_internal_outgoing
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

    // Transform to expected format with SEZ-specific logic
    const transformedData = result.map((row: any, index: number) => {
      const baseData = {
        id: `${row.id}-${row.item_code}-${index}`,
        wmsId: row.wms_id,
        companyCode: row.company_code,
        companyName: row.company_name,
        companyType: companyType,
        date: row.transaction_date,
        recipientName: row.section || '-',
        typeCode: row.type_code,
        itemCodeBahasa: row.item_code_bahasa || '',
        itemCode: row.item_code,
        itemName: row.item_name,
        unit: row.unit,
        qty: Number(row.quantity || 0),
        currency: 'USD',
        amount: Number(row.value_amount || 0),
      };

      // For SEZ companies: documentNumber uses wms_id, and add internalDocument from internal_evidence_number
      // For other companies: documentNumber uses internal_evidence_number as usual
      if (companyType === 'SEZ') {
        return {
          ...baseData,
          documentNumber: String(row.wms_id),
          internalDocument: row.document_number,
        };
      } else {
        return {
          ...baseData,
          documentNumber: row.document_number,
        };
      }
    });

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error(
      '[API Error] Failed to fetch internal transaction outgoing:',
      error
    );
    return NextResponse.json(
      { message: 'Error fetching internal transaction outgoing data' },
      { status: 500 }
    );
  }
}
