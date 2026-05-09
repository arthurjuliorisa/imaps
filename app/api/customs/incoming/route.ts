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
    const search = searchParams.get('search')?.trim();
    const itemType = searchParams.get('itemType')?.trim();

    // Extract and validate pagination parameters
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    
    // Validate pagination values (min 5, max 500 per page)
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 5), 500);
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

    if (itemType) {
      query += ` AND type_code = $${paramIndex}`;
      params.push(itemType);
      paramIndex++;
    }

    if (search) {
      query += ` AND (
        company_name ILIKE $${paramIndex}
        OR COALESCE(customs_document_type::text, '') ILIKE $${paramIndex}
        OR COALESCE(cust_doc_registration_no, '') ILIKE $${paramIndex}
        OR COALESCE(doc_number, '') ILIKE $${paramIndex}
        OR COALESCE(shipper_name, '') ILIKE $${paramIndex}
        OR COALESCE(type_code, '') ILIKE $${paramIndex}
        OR COALESCE(item_code, '') ILIKE $${paramIndex}
        OR COALESCE(item_name, '') ILIKE $${paramIndex}
        OR COALESCE(unit, '') ILIKE $${paramIndex}
        OR COALESCE(currency, '') ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY doc_date DESC, id DESC`;

    // Get total count for pagination (without LIMIT/OFFSET)
    // Build count query by replacing the multiline SELECT list with COUNT(*).
    const baseCountQuery = query.replace(
      /^\s*SELECT[\s\S]*?\sFROM\s+vw_laporan_pemasukan/i,
      'SELECT COUNT(*) as count FROM vw_laporan_pemasukan'
    );
    const countQueryClean = baseCountQuery.split('ORDER BY')[0]; // Remove ORDER BY for count
    
    // Use only the params up to the current paramIndex (excluding LIMIT/OFFSET placeholders)
    const countParams = params.slice(); // Copy current params (before adding LIMIT/OFFSET)
    const countResult = await prisma.$queryRawUnsafe<[{ count: string }]>(
      countQueryClean,
      ...countParams
    );
    const totalCount = Number(countResult[0]?.count ?? 0);

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
