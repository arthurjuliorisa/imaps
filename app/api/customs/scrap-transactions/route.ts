import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';
import { buildScrapTransactionListProjection } from '@/lib/scrap-transaction-list-projection';

/**
 * GET /api/customs/scrap-transactions
 * Fetch scrap transaction records from:
 * - scrap_transactions table for SCRAP IN (transaction_type = 'IN')
 * - outgoing_goods table for SCRAP OUT (with SCRAP item_type)
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
 * - Transaction Type (IN/OUT)
 * - Doc Type (customs document type)
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
    const search = searchParams.get('search')?.trim();
    const view = searchParams.get('view') === 'summary' ? 'summary' : 'detail';
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawPageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const page = Number.isFinite(rawPage) ? rawPage : 1;
    const pageSize = Number.isFinite(rawPageSize) ? Math.min(rawPageSize, 100) : 50;

    // Validate company code
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // Validate pagination parameters
    if (page < 1 || pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { message: 'Invalid pagination parameters. Page must be >= 1, pageSize must be between 1 and 100.' },
        { status: 400 }
      );
    }

    const offset = (page - 1) * pageSize;

    // Build date filter conditions
    let dateFilterScrap = '';
    let dateFilterOutgoing = '';
    let searchFilterScrap = '';
    let searchFilterOutgoing = '';
    const params: any[] = [companyCode];
    let paramIndex = 2;

    if (search) {
      searchFilterScrap = ` AND (
        c.name ILIKE $${paramIndex}
        OR 'IN' ILIKE $${paramIndex}
        OR COALESCE(st.customs_document_type::text, '') ILIKE $${paramIndex}
        OR COALESCE(st.ppkek_number, '') ILIKE $${paramIndex}
        OR COALESCE(st.document_number, '') ILIKE $${paramIndex}
        OR COALESCE(st.source, 'Scrap Collection') ILIKE $${paramIndex}
        OR COALESCE(sti.item_type, '') ILIKE $${paramIndex}
        OR COALESCE(sti.item_code, '') ILIKE $${paramIndex}
        OR COALESCE(sti.item_name, '') ILIKE $${paramIndex}
        OR COALESCE(sti.uom, '') ILIKE $${paramIndex}
        OR COALESCE(sti.currency::text, '') ILIKE $${paramIndex}
      )`;
      searchFilterOutgoing = ` AND (
        c.name ILIKE $${paramIndex}
        OR 'OUT' ILIKE $${paramIndex}
        OR COALESCE(og.customs_document_type::text, '') ILIKE $${paramIndex}
        OR COALESCE(og.ppkek_number, '') ILIKE $${paramIndex}
        OR COALESCE(og.outgoing_evidence_number, '') ILIKE $${paramIndex}
        OR COALESCE(og.recipient_name, '') ILIKE $${paramIndex}
        OR COALESCE(ogi.item_type, '') ILIKE $${paramIndex}
        OR COALESCE(ogi.item_code, '') ILIKE $${paramIndex}
        OR COALESCE(ogi.item_name, '') ILIKE $${paramIndex}
        OR COALESCE(ogi.uom, '') ILIKE $${paramIndex}
        OR COALESCE(ogi.currency::text, '') ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (startDate) {
      // These columns are PostgreSQL DATE columns. Bind the supplied calendar
      // date directly rather than parsing it as a JavaScript timestamp, which
      // can shift dates across time zones.
      dateFilterScrap += ` AND st.transaction_date >= $${paramIndex}::date`;
      dateFilterOutgoing += ` AND og.outgoing_date >= $${paramIndex}::date`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      dateFilterScrap += ` AND st.transaction_date <= $${paramIndex}::date`;
      dateFilterOutgoing += ` AND og.outgoing_date <= $${paramIndex}::date`;
      params.push(endDate);
      paramIndex++;
    }

    // Summary pagination is by document header; detail pagination is by active
    // item.  Keeping this decision in SQL prevents a page of headers from
    // being expanded into an incomplete, misleading list of child lines.
    const countSelect = view === 'summary'
      ? "COUNT(DISTINCT header_key)"
      : 'COUNT(*)';

    // Count total records from both scrap_transactions (IN) and outgoing_goods (OUT with SCRAP items)
    const countQuery = `
      SELECT ${countSelect} as total FROM (
        -- SCRAP IN from scrap_transactions
        SELECT 'IN:' || st.id AS header_key
        FROM scrap_transactions st
        JOIN scrap_transaction_items sti ON st.company_code = sti.scrap_transaction_company
          AND st.id = sti.scrap_transaction_id
          AND st.transaction_date = sti.scrap_transaction_date
        JOIN companies c ON st.company_code = c.code
        WHERE st.company_code = $1
          AND st.transaction_type = 'IN'
          AND st.deleted_at IS NULL
          AND sti.deleted_at IS NULL
          ${searchFilterScrap}
          ${dateFilterScrap}
        
        UNION ALL
        
        -- SCRAP OUT from outgoing_goods
        SELECT 'OUT:' || og.id AS header_key
        FROM outgoing_goods og
        JOIN outgoing_good_items ogi ON og.company_code = ogi.outgoing_good_company
          AND og.id = ogi.outgoing_good_id
          AND og.outgoing_date = ogi.outgoing_good_date
        JOIN companies c ON og.company_code = c.code
        WHERE og.company_code = $1
          AND ogi.item_type = 'SCRAP'
          AND og.deleted_at IS NULL
          AND ogi.deleted_at IS NULL
          ${searchFilterOutgoing}
          ${dateFilterOutgoing}
      ) combined
    `;

    const countResult = await prisma.$queryRawUnsafe<[{ total: bigint }]>(
      countQuery,
      ...params
    );
    const totalRecords = Number(countResult[0]?.total || 0);

    // Company type is constant for this authenticated company. Return it once
    // so the client can omit INSW UI for BZ companies without per-row lookups.
    const company = await prisma.companies.findUnique({
      where: { code: companyCode },
      select: { company_type: true },
    });

    const listProjection = buildScrapTransactionListProjection(view);

    // Fetch paginated data from both SCRAP IN and SCRAP OUT sources. Summary
    // uses one deterministic active line merely as an addressable header
    // reference; it never exposes that line as the document's item content.
    const dataQuery = `
      WITH tracking AS (
        SELECT transaction_type, transaction_id,
          COALESCE(bool_or(insw_status = 'SUCCESS'), false) AS has_success,
          (array_agg(insw_status ORDER BY created_at DESC, id DESC))[1] AS latest_status
        FROM insw_tracking_log
        WHERE company_code = $1
          AND transaction_type IN ('scrap_in', 'scrap_out')
        GROUP BY transaction_type, transaction_id
      ), scrap_item_counts AS (
        SELECT scrap_transaction_company AS company_code, scrap_transaction_id AS transaction_id,
          COUNT(*)::integer AS item_count
        FROM scrap_transaction_items
        WHERE scrap_transaction_company = $1 AND deleted_at IS NULL
        GROUP BY scrap_transaction_company, scrap_transaction_id
      ), outgoing_item_counts AS (
        SELECT outgoing_good_company AS company_code, outgoing_good_id,
          COUNT(*)::integer AS item_count
        FROM outgoing_good_items
        WHERE outgoing_good_company = $1 AND item_type = 'SCRAP' AND deleted_at IS NULL
        GROUP BY outgoing_good_company, outgoing_good_id
      ), combined AS (
        -- SCRAP IN from scrap_transactions
        SELECT
          'SCRAP_' || st.id || '_' || sti.id as record_id,
          st.id as source_id,
          st.id as insw_transaction_id,
          st.document_number as wms_id,
          st.company_code,
          c.name as company_name,
          'IN' as transaction_type,
          st.customs_document_type::text as doc_type,
          COALESCE(st.ppkek_number, '') as ppkek_number,
          COALESCE(st.customs_registration_date, st.transaction_date) as reg_date,
          st.document_number as doc_number,
          st.transaction_date as doc_date,
          st.transaction_date as transaction_date,
          -- Scrap IN has no recipient. source is provenance only and must
          -- never be presented as a recipient (it can contain manual remarks).
          NULL::text as recipient_name,
          sti.item_type,
          sti.item_code,
          sti.item_name,
          sti.uom as unit,
          sti.qty as quantity_in,
          0::numeric as quantity_out,
          sti.currency,
          sti.amount as value_amount,
          st.remarks,
          st.created_at,
          st.transaction_date as sort_date,
          st.customs_document_type::text as customs_doc_type,
          st.document_number as transaction_number,
          CAST(ARRAY[]::text[] AS text[]) as incoming_ppkek_numbers,
          ic.item_count,
          CASE
            WHEN ti.has_success THEN 'SUCCESS'
            WHEN ti.latest_status = 'FAILED' THEN 'FAILED'
            WHEN ti.latest_status IS NULL THEN 'NOT_SENT'
            ELSE 'PENDING'
          END as insw_status,
          (c.company_type = 'SEZ') as is_sez
        FROM scrap_transactions st
        JOIN scrap_transaction_items sti ON st.company_code = sti.scrap_transaction_company
          AND st.id = sti.scrap_transaction_id
          AND st.transaction_date = sti.scrap_transaction_date
        JOIN companies c ON st.company_code = c.code
        LEFT JOIN tracking ti ON ti.transaction_type = 'scrap_in' AND ti.transaction_id = st.id
        JOIN scrap_item_counts ic ON ic.company_code = st.company_code AND ic.transaction_id = st.id
        WHERE st.company_code = $1
          AND st.transaction_type = 'IN'
          AND st.deleted_at IS NULL
          AND sti.deleted_at IS NULL
          ${searchFilterScrap}
          ${dateFilterScrap}
        
        UNION ALL
        
        -- SCRAP OUT from outgoing_goods
        SELECT
          'OUTGOING_' || og.id || '_' || ogi.id as record_id,
          og.id as source_id,
          og.scrap_transaction_id as insw_transaction_id,
          og.wms_id,
          og.company_code,
          c.name as company_name,
          'OUT' as transaction_type,
          og.customs_document_type::text as doc_type,
          og.ppkek_number,
          og.customs_registration_date as reg_date,
          og.outgoing_evidence_number as doc_number,
          og.outgoing_date as doc_date,
          og.outgoing_date as transaction_date,
          og.recipient_name,
          ogi.item_type,
          ogi.item_code,
          ogi.item_name,
          ogi.uom as unit,
          0::numeric as quantity_in,
          ogi.qty as quantity_out,
          ogi.currency,
          ogi.amount as value_amount,
          '' as remarks,
          og.created_at,
          og.outgoing_date as sort_date,
          og.customs_document_type::text as customs_doc_type,
          og.outgoing_evidence_number as transaction_number,
          ogi.incoming_ppkek_numbers,
          oc.item_count,
          CASE
            WHEN ot.has_success THEN 'SUCCESS'
            WHEN ot.latest_status = 'FAILED' THEN 'FAILED'
            WHEN ot.latest_status IS NULL THEN 'NOT_SENT'
            ELSE 'PENDING'
          END as insw_status,
          (c.company_type = 'SEZ') as is_sez
        FROM outgoing_goods og
        JOIN outgoing_good_items ogi ON og.company_code = ogi.outgoing_good_company
          AND og.id = ogi.outgoing_good_id
          AND og.outgoing_date = ogi.outgoing_good_date
        JOIN companies c ON og.company_code = c.code
        LEFT JOIN tracking ot ON ot.transaction_type = 'scrap_out' AND ot.transaction_id = og.scrap_transaction_id
        JOIN outgoing_item_counts oc ON oc.company_code = og.company_code AND oc.outgoing_good_id = og.id
        WHERE og.company_code = $1
          AND ogi.item_type = 'SCRAP'
          AND og.deleted_at IS NULL
          AND ogi.deleted_at IS NULL
          ${searchFilterOutgoing}
          ${dateFilterOutgoing}
      )
      ${listProjection}
      ORDER BY sort_date DESC, record_id DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(pageSize, offset);

    const result = await prisma.$queryRawUnsafe<any[]>(dataQuery, ...params);

    // Transform to expected format
    const transformedData = result.map((row: any, index: number) => ({
      no: offset + index + 1,
      id: row.record_id,
      wmsId: row.wms_id,
      companyCode: row.company_code,
      companyName: row.company_name,
      transactionType: row.transaction_type,
      docType: row.doc_type || '',
      ppkekNumber: row.ppkek_number,
      regDate: row.reg_date,
      docNumber: row.doc_number,
      docDate: row.doc_date,
      transactionDate: row.transaction_date,
      recipientName: row.recipient_name,
      incomingPpkekNumbers: row.incoming_ppkek_numbers || [],
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
      customsDocumentType: row.customs_doc_type || '',
      transactionNumber: row.transaction_number || '',
      inswTransactionId: row.insw_transaction_id ? Number(row.insw_transaction_id) : null,
      itemCount: Number(row.item_count || 0),
      inswStatus: row.insw_status,
      isSez: Boolean(row.is_sez),
    }));

    return NextResponse.json(
      serializeBigInt({
        data: transformedData,
        companyType: company?.company_type ?? null,
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
