import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';

/**
 * GET /api/customs/scrap-transactions
 * Fetch scrap transaction records from two sources:
 * 1. scrap_transactions table (internal scrap IN/OUT)
 * 2. outgoing_goods table with item_type='SCRAP' (customs scrap outgoing)
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
 * - Doc Type (IN/OUT)
 * - PPKEK Number (for customs outgoing)
 * - Reg Date (registration date)
 * - Doc Number
 * - Doc Date
 * - Recipient Name / Source
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
    let dateFilterScrap = '';
    let dateFilterOutgoing = '';
    const params: any[] = [companyCode];
    let paramIndex = 2;

    if (startDate) {
      const startDateObj = new Date(startDate);
      dateFilterScrap += ` AND st.transaction_date >= $${paramIndex}`;
      dateFilterOutgoing += ` AND og.outgoing_date >= $${paramIndex}`;
      params.push(startDateObj);
      paramIndex++;
    }

    if (endDate) {
      const endDateObj = new Date(endDate);
      dateFilterScrap += ` AND st.transaction_date <= $${paramIndex}`;
      dateFilterOutgoing += ` AND og.outgoing_date <= $${paramIndex}`;
      params.push(endDateObj);
      paramIndex++;
    }

    // Count total records from both sources (for pagination)
    const countQuery = `
      SELECT COUNT(*) as total FROM (
        -- Count from scrap_transactions
        SELECT 1
        FROM scrap_transactions st
        JOIN scrap_transaction_items sti ON st.company_code = sti.scrap_transaction_company
          AND st.id = sti.scrap_transaction_id
          AND st.transaction_date = sti.scrap_transaction_date
        WHERE st.company_code = $1
          AND st.deleted_at IS NULL
          AND sti.deleted_at IS NULL
          ${dateFilterScrap}
        
        UNION ALL
        
        -- Count from outgoing_goods with SCRAP items
        SELECT 1
        FROM outgoing_goods og
        JOIN outgoing_good_items ogi ON og.company_code = ogi.outgoing_good_company
          AND og.id = ogi.outgoing_good_id
          AND og.outgoing_date = ogi.outgoing_good_date
        WHERE og.company_code = $1
          AND og.deleted_at IS NULL
          AND ogi.deleted_at IS NULL
          AND ogi.item_type = 'SCRAP'
          ${dateFilterOutgoing}
      ) combined_count
    `;

    const countResult = await prisma.$queryRawUnsafe<[{ total: bigint }]>(
      countQuery,
      ...params
    );
    const totalRecords = Number(countResult[0]?.total || 0);

    // Fetch paginated data from both scrap_transactions and outgoing_goods
    const dataQuery = `
      SELECT * FROM (
        -- Data from scrap_transactions
        SELECT
          'SCRAP_' || st.id as record_id,
          st.id as source_id,
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
          st.transaction_type,
          st.transaction_date as sort_date
        FROM scrap_transactions st
        JOIN scrap_transaction_items sti ON st.company_code = sti.scrap_transaction_company
          AND st.id = sti.scrap_transaction_id
          AND st.transaction_date = sti.scrap_transaction_date
        JOIN companies c ON st.company_code = c.code
        WHERE st.company_code = $1
          AND st.deleted_at IS NULL
          AND sti.deleted_at IS NULL
          ${dateFilterScrap}
        
        UNION ALL
        
        -- Data from outgoing_goods with SCRAP items
        SELECT
          'OUTGOING_' || og.id as record_id,
          og.id as source_id,
          og.wms_id,
          og.company_code,
          c.name as company_name,
          'OUT' as doc_type,
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
          'OUT' as transaction_type,
          og.outgoing_date as sort_date
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
      ) combined_data
      ORDER BY sort_date DESC, record_id DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(pageSize, offset);

    const result = await prisma.$queryRawUnsafe<any[]>(dataQuery, ...params);

    // Transform to expected format
    const transformedData = result.map((row: any, index: number) => ({
      no: offset + index + 1,
      id: `${row.record_id}-${row.item_code}-${offset + index}`,
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
      inQty: Number(row.quantity_in || 0),
      outQty: Number(row.quantity_out || 0),
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
