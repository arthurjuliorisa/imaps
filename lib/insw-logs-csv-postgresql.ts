import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inswCsvVisibilityPredicate } from './insw-log-visibility';
import { InswCsvError } from './insw-logs-csv';
import {
  createInswCsvCursorSource, inswCsvCursorPredicate, inswCsvCursorProjection,
  type InswCsvCursorRow,
} from './insw-logs-csv-cursor';

function refuse(): never { throw new InswCsvError('SOURCE'); }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return refuse();
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) refuse();
}

/** Deliberately accepts only buildLogWhere(filters, {})'s exact shape.
 * Only the canonical date OR is accepted; no arbitrary Boolean/relation filters or caller SQL.
 * Copy bound primitives now so later caller mutation cannot change traversal. */
export function bindInswCsvFilters(canonicalWhere: Prisma.insw_tracking_logWhereInput): {
  companyCode: number; predicate: Prisma.Sql;
} {
  const where = record(canonicalWhere);
  keys(where, ['company_code', 'transaction_type', 'insw_status', 'wms_id', 'sent_at', 'OR']);
  const companyCode = where.company_code;
  if (typeof companyCode !== 'number' || !Number.isInteger(companyCode) ||
      companyCode < -2147483648 || companyCode > 2147483647) return refuse();
  const terms = [Prisma.sql`log.company_code = ${companyCode}`];
  if ('transaction_type' in where) {
    if (typeof where.transaction_type !== 'string' || !where.transaction_type) refuse();
    terms.push(Prisma.sql`log.transaction_type = ${where.transaction_type}`);
  }
  if ('insw_status' in where) {
    if (typeof where.insw_status !== 'string' || !where.insw_status) refuse();
    terms.push(Prisma.sql`log.insw_status = ${where.insw_status}`);
  }
  if ('wms_id' in where) {
    const wms = record(where.wms_id);
    keys(wms, ['contains', 'mode']);
    if (typeof wms.contains !== 'string' || !wms.contains || wms.mode !== 'insensitive') refuse();
    // Prisma PostgreSQL contains wraps the supplied LIKE pattern in %. It does
    // NOT auto-escape %, _ or backslash. Preserve caller escapes (e.g. \\%).
    // Auto-escaping here would silently change the existing list/XLSX policy.
    // ILIKE stays in PostgreSQL, including its NULL and collation semantics.
    terms.push(Prisma.sql`log.wms_id ILIKE ${`%${wms.contains}%`} ESCAPE E'\\\\'`);
  }
  const dateTerms = (value: unknown, column: 'sent_at' | 'created_at') => {
    const date = record(value);
    keys(date, ['gte', 'lt']);
    if (!Object.keys(date).length) refuse();
    const bounds: Prisma.Sql[] = [];
    for (const bound of ['gte', 'lt'] as const) {
      if (!(bound in date)) continue;
      const value = date[bound];
      if (!(value instanceof Date) || !Number.isFinite(value.getTime())) refuse();
      const instant = (value as Date).toISOString();
      const field = column === 'sent_at' ? Prisma.sql`log.sent_at` : Prisma.sql`log.created_at`;
      bounds.push(bound === 'gte' ? Prisma.sql`${field} >= ${instant}::timestamptz`
        : Prisma.sql`${field} < ${instant}::timestamptz`);
    }
    return Prisma.join(bounds, ' AND ');
  };
  if ('sent_at' in where) terms.push(dateTerms(where.sent_at, 'sent_at'));
  if ('OR' in where) {
    if ('sent_at' in where || !Array.isArray(where.OR) || where.OR.length !== 2) refuse();
    const sent = record((where.OR as unknown[])[0]);
    const unsent = record((where.OR as unknown[])[1]);
    keys(sent, ['sent_at']);
    keys(unsent, ['sent_at', 'created_at']);
    if (unsent.sent_at !== null) refuse();
    if (Object.keys(record(sent.sent_at)).sort().join(',') !==
        Object.keys(record(unsent.created_at)).sort().join(',')) refuse();
    const sentDates = dateTerms(sent.sent_at, 'sent_at');
    const createdDates = dateTerms(unsent.created_at, 'created_at');
    // Both branches must carry identical canonical bounds, never a wider OR.
    if (JSON.stringify(sentDates.values) !== JSON.stringify(createdDates.values) ||
        sentDates.values.length !== createdDates.values.length) refuse();
    terms.push(Prisma.sql`((${sentDates}) OR (log.sent_at IS NULL AND ${createdDates}))`);
  }
  return { companyCode, predicate: Prisma.join(terms, ' AND ') };
}

/** Internal trusted-server boundary, not authorization. The service supplies
 * buildLogWhere with company derived from a validated server session. Never pass
 * an authoritative company from URL/body input. No HTTP/UI caller is installed.
 * No transaction or invented timeout; abort waits for Prisma query settlement. */
export function createInswCsvPostgresqlSource(
  canonicalWhere: Prisma.insw_tracking_logWhereInput,
  controls: { signal?: AbortSignal; checkDeadline?: () => void } = {},
) {
  const { companyCode, predicate } = bindInswCsvFilters(canonicalWhere);
  const visibility = inswCsvVisibilityPredicate(companyCode);
  return createInswCsvCursorSource({
    companyCode, signal: controls.signal, checkDeadline: controls.checkDeadline,
    readPage: page => prisma.$queryRaw<InswCsvCursorRow[]>(Prisma.sql`
      SELECT log.sent_at, log.transaction_type, log.wms_id,
        log.insw_activity_code, log.insw_status, log.retry_count,
        ${inswCsvCursorProjection}
      FROM insw_tracking_log log
      WHERE ${predicate} AND ${visibility} AND ${inswCsvCursorPredicate(page)}
      ORDER BY log.created_at DESC, log.id DESC
      LIMIT ${page.take}
    `),
  });
}
