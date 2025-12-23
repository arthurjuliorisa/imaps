import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';

/**
 * GET /api/customs/scrap-transactions
 * Fetch combined scrap transaction records (incoming and outgoing)
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
 * - Doc Type (CustomsDocumentType)
 * - PPKEK Number
 * - Reg Date (customs_registration_date)
 * - Doc Number (incoming_evidence_number or outgoing_evidence_number)
 * - Doc Date (incoming_date or outgoing_date)
 * - Recipient Name (shipper_name for incoming, recipient_name for outgoing)
 * - Item Type (SCRAP)
 * - Item Code
 * - Item Name
 * - Unit (UOM)
 * - In (quantity from incoming_good_items, 0 for outgoing)
 * - Out (quantity from outgoing_good_items, 0 for incoming)
 * - Currency
 * - Value Amount
 * - Remarks (optional, can be null)
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
    let dateFilterIncoming = '';
    let dateFilterOutgoing = '';
    const params: any[] = [companyCode];
    let paramIndex = 2;

    if (startDate) {
      dateFilterIncoming += ` AND ig.incoming_date >= $${paramIndex}`;
      dateFilterOutgoing += ` AND og.outgoing_date >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }

    if (endDate) {
      dateFilterIncoming += ` AND ig.incoming_date <= $${paramIndex}`;
      dateFilterOutgoing += ` AND og.outgoing_date <= $${paramIndex}`;
      params.push(new Date(endDate));
      paramIndex++;
    }

    // Count total records (for pagination)
    const countQuery = `
      SELECT COUNT(*) as total FROM (
        SELECT ig.id
        FROM incoming_goods ig
        JOIN incoming_good_items igi ON ig.company_code = igi.incoming_good_company
          AND ig.id = igi.incoming_good_id
          AND ig.incoming_date = igi.incoming_good_date
        WHERE ig.company_code = $1
          AND ig.deleted_at IS NULL
          AND igi.deleted_at IS NULL
          AND igi.item_type = 'SCRAP'
          ${dateFilterIncoming}

        UNION ALL

        SELECT og.id
        FROM outgoing_goods og
        JOIN outgoing_good_items ogi ON og.company_code = ogi.outgoing_good_company
          AND og.id = ogi.outgoing_good_id
          AND og.outgoing_date = ogi.outgoing_good_date
        WHERE og.company_code = $1
          AND og.deleted_at IS NULL
          AND ogi.deleted_at IS NULL
          AND ogi.item_type = 'SCRAP'
          ${dateFilterOutgoing}
      ) combined
    `;

    const countResult = await prisma.$queryRawUnsafe<[{ total: bigint }]>(
      countQuery,
      ...params
    );
    const totalRecords = Number(countResult[0]?.total || 0);

    // Fetch paginated data with combined incoming and outgoing scrap transactions
    const dataQuery = `
      SELECT * FROM (
        SELECT
          ig.id,
          ig.wms_id,
          ig.company_code,
          c.name as company_name,
          ig.customs_document_type as doc_type,
          ig.ppkek_number,
          ig.customs_registration_date as reg_date,
          ig.incoming_evidence_number as doc_number,
          ig.incoming_date as doc_date,
          ig.shipper_name as recipient_name,
          igi.item_type,
          igi.item_code,
          igi.item_name,
          igi.uom as unit,
          igi.qty as quantity_in,
          0::numeric(15,3) as quantity_out,
          igi.currency,
          igi.amount as value_amount,
          NULL::varchar as remarks,
          ig.created_at,
          'IN' as transaction_type
        FROM incoming_goods ig
        JOIN incoming_good_items igi ON ig.company_code = igi.incoming_good_company
          AND ig.id = igi.incoming_good_id
          AND ig.incoming_date = igi.incoming_good_date
        JOIN companies c ON ig.company_code = c.code
        WHERE ig.company_code = $1
          AND ig.deleted_at IS NULL
          AND igi.deleted_at IS NULL
          AND igi.item_type = 'SCRAP'
          ${dateFilterIncoming}

        UNION ALL

        SELECT
          og.id,
          og.wms_id,
          og.company_code,
          c.name as company_name,
          og.customs_document_type as doc_type,
          og.ppkek_number,
          og.customs_registration_date as reg_date,
          og.outgoing_evidence_number as doc_number,
          og.outgoing_date as doc_date,
          og.recipient_name,
          ogi.item_type,
          ogi.item_code,
          ogi.item_name,
          ogi.uom as unit,
          0::numeric(15,3) as quantity_in,
          ogi.qty as quantity_out,
          ogi.currency,
          ogi.amount as value_amount,
          NULL::varchar as remarks,
          og.created_at,
          'OUT' as transaction_type
        FROM outgoing_goods og
        JOIN outgoing_good_items ogi ON og.company_code = ogi.outgoing_good_company
          AND og.id = ogi.outgoing_good_id
          AND og.outgoing_date = ogi.outgoing_good_date
        JOIN companies c ON og.company_code = c.code
        WHERE og.company_code = $1
          AND og.deleted_at IS NULL
          AND ogi.deleted_at IS NULL
          AND ogi.item_type = 'SCRAP'
          ${dateFilterOutgoing}
      ) combined
      ORDER BY doc_date DESC, id
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
