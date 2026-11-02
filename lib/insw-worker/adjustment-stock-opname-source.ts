import type { Prisma, PrismaClient } from '@prisma/client';
import { boundedText, canonicalIdentity } from '../insw-queue/contracts';

export type CountOperation = 'ADJUSTMENT' | 'STOCK_OPNAME';

/** Legacy tracking transaction_id is PostgreSQL Int, narrower than the STO header.
 * Check the exact identity BEFORE any Number conversion or lifecycle write. */
export function countSourceId(id: number | bigint | string): number {
  if (!['number', 'bigint', 'string'].includes(typeof id)
    || (typeof id === 'number' && !Number.isSafeInteger(id))
    || !/^[1-9]\d*$/.test(String(id))) throw new Error('INVALID_EXACT_SOURCE_ID');
  if (BigInt(id) > BigInt(2147483647)) throw new Error('SOURCE_ID_EXCEEDS_LEGACY_TRACKING_INT');
  return Number(id);
}

export async function readCountSource(db: PrismaClient | Prisma.TransactionClient, operation: CountOperation, company: number, id: number | bigint | string) {
  const sourceId = countSourceId(id);
  if (![1370, 1380].includes(company)) throw new Error('SEZ_COMPANY_REQUIRED');
  if (operation === 'ADJUSTMENT') {
    const row = await db.adjustments.findFirst({ where: { id: sourceId, company_code: company,
      deleted_at: null, company: { company_type: 'SEZ' } } });
    if (!row) throw new Error('AUTHORIZED_COMMITTED_SOURCE_REQUIRED');
    boundedText(row.wms_id, 'WMS reference', 100);
    return { id: sourceId, reference: row.wms_id, businessDate: row.transaction_date.toISOString().slice(0, 10), revision: 'COMMITTED_SOURCE' };
  }
  const row = await db.wms_stock_opnames.findFirst({ where: { id: BigInt(sourceId), company_code: company,
    status: 'Confirmed', confirmed_at: { not: null }, company: { company_type: 'SEZ' } } });
  if (!row?.confirmed_at) throw new Error('AUTHORIZED_CONFIRMED_SOURCE_REQUIRED');
  boundedText(row.wms_id, 'WMS reference', 100);
  return { id: sourceId, reference: row.wms_id, businessDate: row.document_date.toISOString().slice(0, 10),
    revision: `CONFIRMED:${row.confirmed_at.toISOString()}` };
}

export async function verifyCountSource(db: PrismaClient, job: {
  operation: string; company_code: number; identity_key: string; source_revision: string;
  business_date: string; wms_reference: string | null;
}) {
  if (job.operation !== 'ADJUSTMENT' && job.operation !== 'STOCK_OPNAME') throw new Error('INVALID_COUNT_OPERATION');
  let identity: unknown;
  try { identity = JSON.parse(job.identity_key); } catch { throw new Error('INVALID_SOURCE_HEADER_IDENTITY'); }
  if (!Array.isArray(identity) || identity[3] !== 'SOURCE_HEADER') throw new Error('INVALID_SOURCE_HEADER_IDENTITY');
  const source = await readCountSource(db, job.operation, job.company_code, identity[4]);
  if (job.identity_key !== canonicalIdentity({ kind: 'SOURCE_HEADER', operation: job.operation,
    companyCode: job.company_code, sourceId: source.id, revision: source.revision, businessDate: source.businessDate }).key
    || source.reference !== job.wms_reference || source.businessDate !== job.business_date
    || source.revision !== job.source_revision) throw new Error('COUNT_SOURCE_IDENTITY_UNCONFIRMED');
  return source;
}
