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
 * No AND/OR, relation filters, caller SQL, dynamic columns or arbitrary operators.
 * Copy bound primitives now so later caller mutation cannot change traversal. */
export function bindInswCsvFilters(canonicalWhere: Prisma.insw_tracking_logWhereInput): {
  companyCode: number; predicate: Prisma.Sql;
} {
  const where = record(canonicalWhere);
  keys(where, ['company_code', 'transaction_type', 'insw_status', 'wms_id', 'sent_at']);
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
  if ('sent_at' in where) {
    const date = record(where.sent_at);
    keys(date, ['gte', 'lt']);
    if (!Object.keys(date).length) refuse();
    for (const bound of ['gte', 'lt'] as const) {
      if (!(bound in date)) continue;
      const value = date[bound];
      if (!(value instanceof Date) || !Number.isFinite(value.getTime())) refuse();
      // Parsing/calendar arithmetic already happened in buildLogWhere. An
      // explicit offset in transport avoids a database session-TZ assumption.
      const instant = (value as Date).toISOString();
      terms.push(bound === 'gte' ? Prisma.sql`log.sent_at >= ${instant}::timestamptz`
        : Prisma.sql`log.sent_at < ${instant}::timestamptz`);
    }
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
