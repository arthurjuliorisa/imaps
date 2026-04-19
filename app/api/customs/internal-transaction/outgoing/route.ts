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

    // Extract and validate pagination parameters
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    
    // Validate pagination values (min 10, max 500 per page)
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 10), 500);
    const offset = (page - 1) * limit;

    // Validate company code with detailed error messages
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // Query from vw_internal_outgoing view with company_type and pagination
    // Single efficient query with pagination support (company_type merged in view)
    // Note: ROW_NUMBER() added to generate unique IDs even for multiple items in same transaction
    let query = `
      SELECT
        id,
        wms_id,
        company_code,
        company_name,
        company_type,
        internal_evidence_number as document_number,
        transaction_date,
        section,
        type_code,
        item_code_bahasa,
        item_code,
        item_name,
        unit,
        quantity,
        value_amount,
        ROW_NUMBER() OVER (PARTITION BY id ORDER BY item_code) as item_seq,
        CASE 
          WHEN id IN (SELECT id FROM material_usages WHERE company_code = $1 AND deleted_at IS NULL AND reversal IS NULL) THEN 'MU'
          WHEN id IN (SELECT id FROM production_outputs WHERE company_code = $1 AND deleted_at IS NULL AND reversal = 'Y') THEN 'POR'
          WHEN id IN (SELECT id FROM scrap_transactions WHERE company_code = $1 AND deleted_at IS NULL AND transaction_type = 'OUT') THEN 'ST'
          ELSE 'UNKNOWN'
        END as source_type
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

    // Get total count for pagination
    // Build count query without ROW_NUMBER to avoid syntax error
    let countQuery = `SELECT COUNT(DISTINCT (id, item_code)) as count FROM vw_internal_outgoing WHERE company_code = $1`;
    const countParamsList: any[] = [companyCode];
    let countParamIndex = 2;

    if (startDate && endDate) {
      countQuery += ` AND (transaction_date::date >= $${countParamIndex}::date AND transaction_date::date <= $${countParamIndex + 1}::date)`;
      countParamsList.push(startDate, endDate);
      countParamIndex += 2;
    } else if (startDate) {
      countQuery += ` AND transaction_date::date >= $${countParamIndex}::date`;
      countParamsList.push(startDate);
      countParamIndex++;
    } else if (endDate) {
      countQuery += ` AND transaction_date::date <= $${countParamIndex}::date`;
      countParamsList.push(endDate);
      countParamIndex++;
    }

    const countResult = await prisma.$queryRawUnsafe<[{ count: string }]>(
      countQuery,
      ...countParamsList
    );
    const totalCount = parseInt(countResult[0]?.count || '0', 10);

    // Add pagination to main query
    query += ` LIMIT $${paramIndex}::integer OFFSET $${paramIndex + 1}::integer`;
    params.push(limit, offset);

    const result = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    // Transform to expected format with SEZ-specific logic and unique ID
    // ID format: ${source_type}-${id}-${item_code}-${item_seq}
    // Using primary key 'id' + item_seq ensures uniqueness even for multiple items in same transaction
    const transformedData = result.map((row: any) => {
      const uniqueId = `${(row as any).source_type}-${row.id}-${row.item_code}-${(row as any).item_seq}`;
      const baseData = {
        id: uniqueId,
        wmsId: row.wms_id,
        companyCode: row.company_code,
        companyName: row.company_name,
        companyType: row.company_type,
        date: row.transaction_date,
        recipientName: row.section || '-',
        typeCode: row.type_code,
        itemCodeBahasa: row.item_code_bahasa || '',
        itemCode: row.item_code,
        itemName: row.item_name,
        unit: row.unit,
        // Return as string to preserve decimal precision
        qty: row.quantity?.toString() ?? '0',
        currency: 'USD',
        amount: row.value_amount?.toString() ?? '0',
      };

      // For SEZ companies: documentNumber uses wms_id, and add internalDocument from internal_evidence_number
      // For other companies: documentNumber uses internal_evidence_number as usual
      if (row.company_type === 'SEZ') {
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

    return NextResponse.json(
      serializeBigInt({
        success: true,
        data: transformedData,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
      })
    );
  } catch (error) {
    console.error(
      '[API Error] Failed to fetch internal transaction outgoing:',
      error
    );
    return NextResponse.json(
      {
        success: false,
        message: 'Error fetching internal transaction outgoing data',
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
