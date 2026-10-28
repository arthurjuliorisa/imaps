import { Prisma } from '@prisma/client';
import { CSV_TRIAL_BATCH_SIZE, InswCsvError, type InswCsvRow } from './insw-logs-csv';

/** Independent cursor machinery only. No approved company/filter/visibility SQL
 * binding exists yet. Do not wire this module to a route or an unscoped query. */
export interface InswCsvCursor {
  readonly createdAt: string;
  readonly id: bigint;
}

export interface InswCsvCursorRow extends InswCsvRow {
  readonly created_at_exact: string;
  readonly id: bigint;
}

export interface InswCsvPageRequest {
  readonly companyCode: number;
  readonly take: number;
  readonly fence?: InswCsvCursor;
  readonly after?: InswCsvCursor;
}

function cursor(row: InswCsvCursorRow): InswCsvCursor {
  // No Date parsing or numeric ID conversion. Unsupported timestamp eras and
  // infinities fail closed rather than falling back to millisecond precision.
  if (typeof row.created_at_exact !== 'string' ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/.test(row.created_at_exact) ||
      typeof row.id !== 'bigint' || row.id < BigInt('-9223372036854775808') ||
      row.id > BigInt('9223372036854775807')) {
    throw new InswCsvError('SOURCE');
  }
  return Object.freeze({ createdAt: row.created_at_exact, id: row.id });
}

/** Fixed alias `log`; text returned by PostgreSQL avoids Prisma Date decoding.
 * AT TIME ZONE normalizes to UTC before formatting six fractional digits.
 * This fragment is not a complete authorized SELECT. */
export const inswCsvCursorProjection = Prisma.sql`
  CASE WHEN log.created_at >= TIMESTAMPTZ '0001-01-01 00:00:00+00'
    AND log.created_at < TIMESTAMPTZ '10000-01-01 00:00:00+00'
    THEN to_char(log.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ELSE NULL END AS created_at_exact,
  log.id
`;

/** AND this fragment with ALL approved base predicates. Comparison remains a
 * PostgreSQL timestamptz/bigint tuple comparison, never text comparison. */
export function inswCsvCursorPredicate(page: InswCsvPageRequest): Prisma.Sql {
  return Prisma.sql`
    TRUE
    ${page.fence ? Prisma.sql`AND (log.created_at, log.id) <=
      (${page.fence.createdAt}::timestamptz, ${page.fence.id}::bigint)` : Prisma.empty}
    ${page.after ? Prisma.sql`AND (log.created_at, log.id) <
      (${page.after.createdAt}::timestamptz, ${page.after.id}::bigint)` : Prisma.empty}
  `;
}

/**
 * Usable with generateInswCsv's sequential callback contract, once an approved
 * readPage binding exists. readPage MUST apply company + canonical filters +
 * legacy visibility AND the cursor predicate, ORDER BY created_at DESC, id DESC,
 * LIMIT take, selecting six CSV fields plus the exact cursor projection only.
 * No default Prisma binding is provided: visibility parity is approval-blocked.
 *
 * First returned tuple is the upper fence from the first page's statement.
 * Empty first page ends the read. Short nonempty pages are not treated as EOF.
 * Live reads may encounter backdated inserts/eligibility edits below the cursor;
 * previously passed tuples are not revisited. This is not a historical snapshot.
 */
export function createInswCsvCursorSource(options: {
  // Already validated by the future caller's existing session/company checks.
  companyCode: number;
  readPage: (page: InswCsvPageRequest) => Promise<readonly InswCsvCursorRow[]>;
  signal?: AbortSignal;
  // Optional caller-owned check; no resource/deadline defaults are invented.
  checkDeadline?: () => void;
}): (take: number) => Promise<readonly InswCsvRow[]> {
  const { companyCode, readPage, signal, checkDeadline } = options;
  if (!Number.isInteger(companyCode) || companyCode < -2147483648 || companyCode > 2147483647) {
    throw new InswCsvError('SOURCE');
  }
  let fence: InswCsvCursor | undefined;
  let after: InswCsvCursor | undefined;
  let ended = false;
  let active = false;
  let failed = false;
  const check = () => {
    if (signal?.aborted) throw new InswCsvError('ABORTED');
    checkDeadline?.();
  };
  return async take => {
    if (active || failed || !Number.isInteger(take) || take < 1 || take > CSV_TRIAL_BATCH_SIZE) {
      throw new InswCsvError('SOURCE');
    }
    active = true;
    try {
      check();
      if (ended) return [];
      const rows = await readPage(Object.freeze({ companyCode, take, fence, after }));
      // Wait honestly for in-flight reads; signal does not cancel Prisma queries.
      check();
      if (!Array.isArray(rows) || rows.length > take) throw new InswCsvError('SOURCE');
      if (!rows.length) { ended = true; return []; }
      const cursors = rows.map(cursor);
      fence ??= cursors[0];
      after = cursors[cursors.length - 1];
      // Strip cursor metadata and any unexpected fields from the writer boundary.
      return rows.map(row => ({ sent_at: row.sent_at, transaction_type: row.transaction_type,
        wms_id: row.wms_id, insw_activity_code: row.insw_activity_code,
        insw_status: row.insw_status, retry_count: row.retry_count }));
    } catch (error) {
      failed = true;
      throw error instanceof InswCsvError ? error : new InswCsvError('SOURCE');
    } finally {
      active = false;
    }
  };
}
