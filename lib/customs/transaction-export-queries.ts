import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/bigint-serializer';

export type TransactionExportKind =
  | 'incoming'
  | 'outgoing'
  | 'internal-incoming'
  | 'internal-outgoing';

export interface TransactionExportFilters {
  companyCode: number;
  startDate: Date;
  endDate: Date;
  search?: string | null;
  itemType?: string | null;
}

function cleanFilter(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function numericString(value: unknown): string {
  return value === null || value === undefined ? '0' : String(value);
}

function appendRegularFilters(
  query: string,
  params: unknown[],
  filters: TransactionExportFilters,
  partyColumn: 'shipper_name' | 'recipient_name'
): { query: string; params: unknown[] } {
  let paramIndex = params.length + 1;
  const search = cleanFilter(filters.search);
  const itemType = cleanFilter(filters.itemType);

  query += ` AND (
    (doc_date::date >= $${paramIndex}::date AND doc_date::date <= $${paramIndex + 1}::date)
    OR
    (reg_date::date >= $${paramIndex}::date AND reg_date::date <= $${paramIndex + 1}::date)
  )`;
  params.push(filters.startDate, filters.endDate);
  paramIndex += 2;

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
      OR COALESCE(${partyColumn}, '') ILIKE $${paramIndex}
      OR COALESCE(type_code, '') ILIKE $${paramIndex}
      OR COALESCE(item_code, '') ILIKE $${paramIndex}
      OR COALESCE(item_name, '') ILIKE $${paramIndex}
      OR COALESCE(unit, '') ILIKE $${paramIndex}
      OR COALESCE(currency::text, '') ILIKE $${paramIndex}
    )`;
    params.push(`%${search}%`);
  }

  return { query, params };
}

function appendInternalFilters(
  query: string,
  params: unknown[],
  filters: TransactionExportFilters,
  prefix = ''
): { query: string; params: unknown[] } {
  let paramIndex = params.length + 1;
  const search = cleanFilter(filters.search);
  const itemType = cleanFilter(filters.itemType);

  query += ` AND ${prefix}transaction_date::date >= $${paramIndex}::date AND ${prefix}transaction_date::date <= $${paramIndex + 1}::date`;
  params.push(filters.startDate, filters.endDate);
  paramIndex += 2;

  if (itemType) {
    query += ` AND ${prefix}type_code = $${paramIndex}`;
    params.push(itemType);
    paramIndex++;
  }

  if (search) {
    query += ` AND (
      ${prefix}company_name ILIKE $${paramIndex}
      OR COALESCE(${prefix}internal_evidence_number, '') ILIKE $${paramIndex}
      OR COALESCE(${prefix}type_code, '') ILIKE $${paramIndex}
      OR COALESCE(${prefix}item_code, '') ILIKE $${paramIndex}
      OR COALESCE(${prefix}item_name, '') ILIKE $${paramIndex}
      OR COALESCE(${prefix}unit, '') ILIKE $${paramIndex}
    )`;
    params.push(`%${search}%`);
  }

  return { query, params };
}

export async function countIncomingRows(filters: TransactionExportFilters): Promise<number> {
  let query = `
    SELECT COUNT(*) as count
    FROM vw_laporan_pemasukan
    WHERE company_code = $1
      AND deleted_at IS NULL
  `;
  const result = appendRegularFilters(query, [filters.companyCode], filters, 'shipper_name');
  const countResult = await prisma.$queryRawUnsafe<[{ count: string }]>(
    result.query,
    ...result.params
  );
  return Number(countResult[0]?.count ?? 0);
}

export async function fetchIncomingRows(filters: TransactionExportFilters): Promise<Record<string, unknown>[]> {
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
  const result = appendRegularFilters(query, [filters.companyCode], filters, 'shipper_name');
  query = `${result.query} ORDER BY doc_date DESC, id DESC`;

  const rows = await prisma.$queryRawUnsafe<any[]>(query, ...result.params);
  return serializeBigInt(rows).map((row: any, index: number) => ({
    no: index + 1,
    companyName: row.company_name,
    documentType: row.customs_document_type,
    registrationNumber: row.ppkek_number,
    registrationDate: row.registration_date,
    evidenceNumber: row.company_type === 'SEZ' ? String(row.wms_id || row.id) : row.doc_number,
    internalDocument: row.company_type === 'SEZ' ? row.doc_number : '',
    wmsId: row.wms_id || row.id,
    transactionDate: row.doc_date,
    partyName: row.shipper_name,
    itemType: row.type_code,
    itemTypeName: row.item_code_bahasa || '',
    itemCode: row.item_code,
    itemName: row.item_name,
    uom: row.unit,
    quantity: numericString(row.quantity),
    currency: row.currency,
    amount: numericString(row.value_amount),
  }));
}

export async function countOutgoingRows(filters: TransactionExportFilters): Promise<number> {
  let query = `
    SELECT COUNT(*) as count
    FROM vw_laporan_pengeluaran
    WHERE company_code = $1
      AND deleted_at IS NULL
  `;
  const result = appendRegularFilters(query, [filters.companyCode], filters, 'recipient_name');
  const countResult = await prisma.$queryRawUnsafe<[{ count: string }]>(
    result.query,
    ...result.params
  );
  return Number(countResult[0]?.count ?? 0);
}

export async function fetchOutgoingRows(filters: TransactionExportFilters): Promise<Record<string, unknown>[]> {
  let query = `
    SELECT
      id,
      wms_id,
      company_code,
      company_name,
      company_type,
      customs_document_type,
      cust_doc_registration_no as ppkek_number,
      reg_date as registration_date,
      doc_number,
      doc_date,
      recipient_name,
      type_code,
      item_code,
      item_name,
      unit,
      quantity,
      currency,
      value_amount,
      item_code_bahasa,
      created_at
    FROM vw_laporan_pengeluaran
    WHERE company_code = $1
      AND deleted_at IS NULL
  `;
  const result = appendRegularFilters(query, [filters.companyCode], filters, 'recipient_name');
  query = `${result.query} ORDER BY doc_date DESC, id DESC`;

  const rows = await prisma.$queryRawUnsafe<any[]>(query, ...result.params);
  return serializeBigInt(rows).map((row: any, index: number) => ({
    no: index + 1,
    companyName: row.company_name,
    documentType: row.customs_document_type,
    registrationNumber: row.ppkek_number,
    registrationDate: row.registration_date,
    evidenceNumber: row.doc_number,
    wmsId: row.wms_id,
    transactionDate: row.doc_date,
    partyName: row.recipient_name,
    itemType: row.type_code,
    itemTypeName: row.item_code_bahasa || '',
    itemCode: row.item_code,
    itemName: row.item_name,
    uom: row.unit,
    quantity: numericString(row.quantity),
    currency: row.currency,
    amount: numericString(row.value_amount),
  }));
}

function internalBaseQuery(viewName: 'vw_internal_incoming' | 'vw_internal_outgoing'): string {
  const sourceTypeCase = viewName === 'vw_internal_incoming'
    ? `
      CASE
        WHEN id IN (SELECT id FROM production_outputs WHERE company_code = $1 AND deleted_at IS NULL AND reversal IS NULL) THEN 'PO'
        WHEN id IN (SELECT id FROM scrap_transactions WHERE company_code = $1 AND deleted_at IS NULL AND transaction_type = 'IN') THEN 'ST'
        WHEN id IN (SELECT id FROM material_usages WHERE company_code = $1 AND deleted_at IS NULL AND reversal = 'Y') THEN 'MU'
        ELSE 'UNKNOWN'
      END as source_type
    `
    : `
      CASE
        WHEN id IN (SELECT id FROM material_usages WHERE company_code = $1 AND deleted_at IS NULL AND reversal IS NULL) THEN 'MU'
        WHEN id IN (SELECT id FROM production_outputs WHERE company_code = $1 AND deleted_at IS NULL AND reversal = 'Y') THEN 'POR'
        WHEN id IN (SELECT id FROM scrap_transactions WHERE company_code = $1 AND deleted_at IS NULL AND transaction_type = 'OUT') THEN 'ST'
        ELSE 'UNKNOWN'
      END as source_type
    `;

  return `
    SELECT
      id,
      wms_id,
      company_code,
      company_name,
      company_type,
      internal_evidence_number,
      transaction_date,
      section,
      type_code,
      item_code_bahasa,
      item_code,
      item_name,
      unit,
      quantity,
      value_amount,
      ${sourceTypeCase}
    FROM ${viewName}
    WHERE company_code = $1
  `;
}

export async function countInternalRows(
  kind: Extract<TransactionExportKind, 'internal-incoming' | 'internal-outgoing'>,
  filters: TransactionExportFilters
): Promise<number> {
  const viewName = kind === 'internal-incoming' ? 'vw_internal_incoming' : 'vw_internal_outgoing';
  let query = `SELECT COUNT(*) as count FROM ${viewName} WHERE company_code = $1`;
  const result = appendInternalFilters(query, [filters.companyCode], filters);
  const countResult = await prisma.$queryRawUnsafe<[{ count: string }]>(
    result.query,
    ...result.params
  );
  return Number(countResult[0]?.count ?? 0);
}

export async function fetchInternalRows(
  kind: Extract<TransactionExportKind, 'internal-incoming' | 'internal-outgoing'>,
  filters: TransactionExportFilters
): Promise<Record<string, unknown>[]> {
  const viewName = kind === 'internal-incoming' ? 'vw_internal_incoming' : 'vw_internal_outgoing';
  let query = internalBaseQuery(viewName);
  const result = appendInternalFilters(query, [filters.companyCode], filters);
  query = `${result.query} ORDER BY transaction_date DESC, id`;

  const rows = await prisma.$queryRawUnsafe<any[]>(query, ...result.params);
  return serializeBigInt(rows).map((row: any, index: number) => ({
    no: index + 1,
    companyName: row.company_name,
    sourceType: row.source_type,
    wmsId: row.wms_id,
    internalEvidenceNumber: row.internal_evidence_number,
    transactionDate: row.transaction_date,
    section: row.section || '-',
    itemType: row.type_code,
    itemTypeName: row.item_code_bahasa || '',
    itemCode: row.item_code,
    itemName: row.item_name,
    uom: row.unit,
    quantity: numericString(row.quantity),
    amount: numericString(row.value_amount),
  }));
}
