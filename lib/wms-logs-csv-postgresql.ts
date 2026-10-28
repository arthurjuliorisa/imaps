import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { CSV_TRIAL_BATCH_SIZE, CsvError } from './logs-csv';
import type { WmsLogWhere } from './wms-log-filters';
import type { WmsCsvRow } from './wms-logs-csv';

type Cursor = { createdAt: string; id: bigint };
export interface WmsCsvCursorRow extends WmsCsvRow { created_at_exact: string; id: bigint }
function cursor(row: WmsCsvCursorRow): Cursor {
  if (typeof row.created_at_exact !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.created_at_exact) ||
      typeof row.id !== 'bigint' || row.id < BigInt('-9223372036854775808') || row.id > BigInt('9223372036854775807')) throw new CsvError('SOURCE');
  return { createdAt: row.created_at_exact, id: row.id };
}
/** Bind the shared list predicate once. No INSW exclusions or payload joins. */
export function bindWmsCsvFilters(where: WmsLogWhere): Prisma.Sql {
  const terms = [Prisma.sql`TRUE`];
  if (where.company_code !== undefined) terms.push(Prisma.sql`log.company_code = ${where.company_code}`);
  if (where.action !== undefined) terms.push(Prisma.sql`log.action = ${where.action}`);
  if (where.transmission_status !== undefined) terms.push(Prisma.sql`log.transmission_status = ${where.transmission_status}`);
  if (where.error_type !== undefined) terms.push(Prisma.sql`log.error_type = ${where.error_type}`);
  if (where.wms_id) terms.push(Prisma.sql`log.wms_id ILIKE ${`%${where.wms_id.contains}%`} ESCAPE E'\\\\'`);
  if (where.created_at?.gte) terms.push(Prisma.sql`log.created_at >= ${where.created_at.gte.toISOString()}::timestamptz`);
  if (where.created_at?.lte) terms.push(Prisma.sql`log.created_at <= ${where.created_at.lte.toISOString()}::timestamptz`);
  return Prisma.join(terms, ' AND ');
}

/** Trusted server boundary: where comes only from buildWmsLogWhere(session).
 * Live fenced read, not a historical snapshot. In-flight Prisma work settles
 * before returning on timeout/abort. Cursor never decodes through JS Date. */
export function createWmsCsvPostgresqlSource(where: WmsLogWhere,
  controls: { signal?: AbortSignal; checkDeadline?: () => void } = {}) {
  const predicate = bindWmsCsvFilters(where);
  let fence: Cursor | undefined, after: Cursor | undefined;
  let active = false, failed = false, ended = false;
  const check = () => { if (controls.signal?.aborted) throw new CsvError('ABORTED'); controls.checkDeadline?.(); };
  return async (take: number): Promise<readonly WmsCsvRow[]> => {
    if (active || failed || !Number.isInteger(take) || take < 1 || take > CSV_TRIAL_BATCH_SIZE) throw new CsvError('SOURCE');
    active = true;
    try {
      check(); if (ended) return [];
      const rows = await prisma.$queryRaw<WmsCsvCursorRow[]>(Prisma.sql`
        SELECT log.created_at, log.action, log.transmission_status, log.wms_id,
          log.company_code, log.error_type, log.item_count, log.expires_at,
          CASE WHEN log.created_at >= TIMESTAMPTZ '0001-01-01 00:00:00+00'
            AND log.created_at < TIMESTAMPTZ '10000-01-01 00:00:00+00'
            THEN to_char(log.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
            ELSE NULL END AS created_at_exact, log.id
        FROM wms_transmission_logs log WHERE ${predicate}
          ${fence ? Prisma.sql`AND (log.created_at, log.id) <= (${fence.createdAt}::timestamptz, ${fence.id}::bigint)` : Prisma.empty}
          ${after ? Prisma.sql`AND (log.created_at, log.id) < (${after.createdAt}::timestamptz, ${after.id}::bigint)` : Prisma.empty}
        ORDER BY log.created_at DESC, log.id DESC LIMIT ${take}
      `);
      check();
      if (!Array.isArray(rows) || rows.length > take) throw new CsvError('SOURCE');
      if (!rows.length) { ended = true; return []; }
      const keys = rows.map(cursor);
      fence ??= keys[0]; after = keys[keys.length - 1];
      return rows.map(row => ({ created_at: row.created_at, action: row.action, transmission_status: row.transmission_status,
        wms_id: row.wms_id, company_code: row.company_code, error_type: row.error_type, item_count: row.item_count, expires_at: row.expires_at }));
    } catch (error) { failed = true; throw error instanceof CsvError ? error : new CsvError('SOURCE'); }
    finally { active = false; }
  };
}
