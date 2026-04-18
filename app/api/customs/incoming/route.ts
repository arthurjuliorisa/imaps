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

    // Query from vw_laporan_pemasukan view with company_type and pagination
    // Single efficient query with pagination support
    let query = `
      SELECT
        id,
        company_code,
        company_name,
        company_type,
        customs_document_type,
        cust_doc_registration_no as ppkek_number,
        reg_date as registration_date,
        doc_number,
        wms_id,
        doc_date,
        shipper_name,
        type_code,
        item_code,
        item_name,
        unit,
        quantity,
        currency,
        value_amount,
        item_code_bahasa,
        created_at
      FROM vw_laporan_pemasukan
      WHERE company_code = $1
        AND deleted_at IS NULL
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

    query += ` ORDER BY doc_date DESC, id DESC`;

    // Get total count for pagination (without LIMIT/OFFSET)
    // Build count query by replacing SELECT with COUNT(*)
    const baseCountQuery = query.replace(/SELECT.*?FROM/, 'SELECT COUNT(DISTINCT id, item_code) as count FROM');
    const countQueryClean = baseCountQuery.split('ORDER BY')[0]; // Remove ORDER BY for count
    
    // Use only the params up to the current paramIndex (excluding LIMIT/OFFSET placeholders)
    const countParams = params.slice(); // Copy current params (before adding LIMIT/OFFSET)
    const countResult = await prisma.$queryRawUnsafe<[{ count: string }]>(
      countQueryClean,
      ...countParams
    );
    const totalCount = parseInt(countResult[0]?.count || '0', 10);

    // Add pagination to main query
    query += ` LIMIT $${paramIndex}::integer OFFSET $${paramIndex + 1}::integer`;
    params.push(limit, offset);

    const result = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    // Transform to expected format
    const transformedData = result.map((row: any) => {
      // Generate deterministic ID based on data, not array index
      // Use wms_id + item_code to ensure consistency across requests
      const uniqueId = `${row.wms_id || row.id}-${row.item_code}`;

      const baseData = {
        id: uniqueId,
        wmsId: row.wms_id || row.id,
        companyCode: row.company_code,
        companyName: row.company_name,
        companyType: row.company_type,
        documentType: row.customs_document_type,
        ppkekNumber: row.ppkek_number,
        registrationDate: row.registration_date,
        date: row.doc_date,
        shipperName: row.shipper_name,
        typeCode: row.type_code,
        itemCodeBahasa: row.item_code_bahasa || '',
        itemCode: row.item_code,
        itemName: row.item_name,
        unit: row.unit,
        // Return as string to preserve decimal precision
        qty: row.quantity?.toString() ?? '0',
        currency: row.currency,
        amount: row.value_amount?.toString() ?? '0',
        createdAt: row.created_at,
      };

      // For SEZ companies: documentNumber uses wms_id, and add internalDocument from doc_number
      // For other companies: documentNumber uses doc_number as usual
      if (row.company_type === 'SEZ') {
        return {
          ...baseData,
          documentNumber: String(row.wms_id || row.id),
          internalDocument: row.doc_number,
        };
      } else {
        return {
          ...baseData,
          documentNumber: row.doc_number,
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
    console.error('[API Error] Failed to fetch incoming documents:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Error fetching incoming documents',
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
