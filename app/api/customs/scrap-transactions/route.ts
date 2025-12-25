import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';

/**
 * GET /api/customs/scrap-transactions
 * Fetch scrap transaction records (incoming and outgoing) from scrap_transactions table
 *
 * Query parameters:
 * - startDate: Start date filter (optional)
 * - endDate: End date filter (optional)
 * - page: Page number for pagination (optional, default: 1)
 * - pageSize: Number of records per page (optional, default: 50)
 *
 * Returns combined results with columns:
 * - No (auto-generated based on pagination)
 * - Company Name
 * - Doc Type (transaction_type: IN or OUT)
 * - Doc Number (document_number)
 * - Doc Date (transaction_date)
 * - Recipient Name (source for IN, recipient_name for OUT)
 * - Item Type (SCRAP)
 * - Item Code
 * - Item Name
 * - Unit (UOM)
 * - In (quantity for IN transactions, 0 for OUT)
 * - Out (quantity for OUT transactions, 0 for IN)
 * - Currency
 * - Value Amount
 * - Remarks
 * - Created At
 */
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
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);

    // Validate company code
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // Validate pagination parameters
    if (page < 1 || pageSize < 1 || pageSize > 1000) {
      return NextResponse.json(
        { message: 'Invalid pagination parameters. Page must be >= 1, pageSize must be between 1 and 1000.' },
        { status: 400 }
      );
    }

    const offset = (page - 1) * pageSize;

    // Build date filter conditions
    let dateFilter = '';
    const params: any[] = [companyCode];
    let paramIndex = 2;

    if (startDate) {
      dateFilter += ` AND st.transaction_date >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }

    if (endDate) {
      dateFilter += ` AND st.transaction_date <= $${paramIndex}`;
      params.push(new Date(endDate));
      paramIndex++;
    }

    // Count total records (for pagination)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM scrap_transactions st
      JOIN scrap_transaction_items sti ON st.company_code = sti.scrap_transaction_company
        AND st.id = sti.scrap_transaction_id
        AND st.transaction_date = sti.scrap_transaction_date
      WHERE st.company_code = $1
        AND st.deleted_at IS NULL
        AND sti.deleted_at IS NULL
        ${dateFilter}
    `;

    const countResult = await prisma.$queryRawUnsafe<[{ total: bigint }]>(
      countQuery,
      ...params
    );
    const totalRecords = Number(countResult[0]?.total || 0);

    // Fetch paginated data from scrap_transactions
    const dataQuery = `
      SELECT
        st.id,
        st.document_number as wms_id,
        st.company_code,
        c.name as company_name,
        st.transaction_type as doc_type,
        '' as ppkek_number,
        st.transaction_date as reg_date,
        st.document_number as doc_number,
        st.transaction_date as doc_date,
        CASE
          WHEN st.transaction_type = 'IN' THEN COALESCE(st.source, 'Scrap Collection')
          WHEN st.transaction_type = 'OUT' THEN st.recipient_name
        END as recipient_name,
        sti.item_type,
        sti.item_code,
        sti.item_name,
        sti.uom as unit,
        CASE WHEN st.transaction_type = 'IN' THEN sti.qty ELSE 0 END as quantity_in,
        CASE WHEN st.transaction_type = 'OUT' THEN sti.qty ELSE 0 END as quantity_out,
        sti.currency,
        sti.amount as value_amount,
        st.remarks,
        st.created_at,
        st.transaction_type
      FROM scrap_transactions st
      JOIN scrap_transaction_items sti ON st.company_code = sti.scrap_transaction_company
        AND st.id = sti.scrap_transaction_id
        AND st.transaction_date = sti.scrap_transaction_date
      JOIN companies c ON st.company_code = c.code
      WHERE st.company_code = $1
        AND st.deleted_at IS NULL
        AND sti.deleted_at IS NULL
        ${dateFilter}
      ORDER BY st.transaction_date DESC, st.id DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(pageSize, offset);

    const result = await prisma.$queryRawUnsafe<any[]>(dataQuery, ...params);

    // Transform to expected format
    const transformedData = result.map((row: any, index: number) => ({
      no: offset + index + 1,
      id: `${row.transaction_type}-${row.id}-${row.item_code}-${offset + index}`,
      wmsId: row.wms_id,
      companyCode: row.company_code,
      companyName: row.company_name,
      docType: row.doc_type,
      ppkekNumber: row.ppkek_number,
      regDate: row.reg_date,
      docNumber: row.doc_number,
      docDate: row.doc_date,
      recipientName: row.recipient_name,
      itemType: row.item_type,
      itemCode: row.item_code,
      itemName: row.item_name,
      unit: row.unit,
      quantityIn: Number(row.quantity_in || 0),
      quantityOut: Number(row.quantity_out || 0),
      currency: row.currency,
      valueAmount: Number(row.value_amount || 0),
      remarks: row.remarks,
      createdAt: row.created_at,
      transactionType: row.transaction_type,
    }));

    return NextResponse.json(
      serializeBigInt({
        data: transformedData,
        pagination: {
          page,
          pageSize,
          totalRecords,
          totalPages: Math.ceil(totalRecords / pageSize),
        },
      })
    );
  } catch (error) {
    console.error('[API Error] Failed to fetch scrap transactions:', error);
    return NextResponse.json(
      { message: 'Error fetching scrap transactions' },
      { status: 500 }
    );
  }
}
