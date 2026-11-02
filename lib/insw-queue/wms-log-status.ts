import { Prisma, type PrismaClient } from '@prisma/client';
import { resolveWorkerAllowedCompanies } from '../config/insw-worker-config';
import type { WmsInswStatusFilter } from '../wms-insw-status-options';
import { canonicalIdentity } from './contracts';

// WMS audit IDs are never source IDs. These are the exact ingress actions,
// including recovery audit entries; stock opname activation is not confirmation.
export const wmsSourceDomains = [
  ['INCOMING', 'WMS_PROCESS_INCOMING_GOODS', 'incoming_goods', 'incoming_date', 'incoming_good_items', 'incoming_good'],
  ['OUTGOING', 'WMS_PROCESS_OUTGOING_GOODS', 'outgoing_goods', 'outgoing_date', 'outgoing_good_items', 'outgoing_good'],
  ['MATERIAL_USAGE', 'WMS_PROCESS_MATERIAL_USAGE', 'material_usages', 'transaction_date', 'material_usage_items', 'material_usage'],
  ['PRODUCTION_OUTPUT', 'WMS_PROCESS_PRODUCTION_OUTPUT', 'production_outputs', 'transaction_date', 'production_output_items', 'production_output'],
  ['ADJUSTMENT', 'WMS_PROCESS_ADJUSTMENTS', 'adjustments', 'transaction_date', 'adjustment_items', 'adjustment'],
  ['STOCK_OPNAME', 'WMS_UPDATE_STOCK_OPNAME', 'wms_stock_opnames', 'document_date', 'wms_stock_opname_items', 'wms_stock_opname'],
] as const;

export type WmsInswStatus = {
  label: WmsInswStatusFilter;
  explanation: string;
  workerAuthorized: boolean;
  canRegenerate: boolean;
  regenerationDestination?: 'TEST' | 'REAL';
  canInspectRegeneration?: boolean;
  canViewInswLogs?: boolean;
  regenerationBlock: string;
};
export type WmsInswFacts = {
  log_id: bigint; company_code: number; operation: 'INCOMING' | 'OUTGOING' | 'MATERIAL_USAGE' | 'PRODUCTION_OUTPUT' | 'ADJUSTMENT' | 'STOCK_OPNAME';
  wms_id: string | null; transmission_status: string;
  source_id: bigint | null; source_matches: bigint; business_date: string | null;
  revision: string | null; source_valid: boolean | null;
  queues: { identity_key: string; business_date: string; source_revision: string; cycle: number;
    status: string; delivery_state: string; hold_reason: string | null }[];
  history_count: number; remote_success: boolean; history_mismatch: boolean;
};

const regenerationBlock = 'A reason and your confirmation of a check on the official INSW website are required for regeneration.';

export function projectWmsInswStatus(row: WmsInswFacts, workerAuthorized: boolean): WmsInswStatus {
  const result = (label: WmsInswStatusFilter, explanation: string): WmsInswStatus => ({
    label, explanation, workerAuthorized, canRegenerate: false, regenerationBlock,
  });
  const observed = 'Current persisted identity status, shared by matching audit entries; not the outcome of this individual WMS request. ';
  if (row.transmission_status !== 'SUCCESS') return result('Unknown / unlinked', 'This WMS audit entry does not prove successful local processing. No INSW submission is authorized.');
  if (!row.wms_id || row.source_matches !== BigInt(1) || !row.source_id || !row.business_date || !row.revision || !row.source_valid) {
    return result('Unknown / unlinked', 'A unique eligible persisted source with active details and exact business date could not be established. WMS SUCCESS means local acceptance, not remote success.');
  }
  let key: string;
  try {
    const common = { companyCode: row.company_code, businessDate: row.business_date, revision: row.revision };
    key = canonicalIdentity(row.operation === 'ADJUSTMENT' || row.operation === 'STOCK_OPNAME'
      ? { ...common, operation: row.operation, kind: 'SOURCE_HEADER', sourceId: Number(row.source_id) }
      : { ...common, operation: row.operation, kind: 'WMS_REFERENCE', reference: row.wms_id }).key;
  } catch { return result('Unknown / unlinked', 'Persisted source identity is outside the supported queue contract.'); }
  if (row.history_mismatch || row.queues.some(q => q.identity_key !== key || q.business_date !== row.business_date || q.source_revision !== row.revision)) {
    return result('Unknown / unlinked', 'Conflicting source, queue or tracking associations require reconciliation. Do not regenerate or repost.');
  }
  const queues = [...row.queues].sort((a, b) => b.cycle - a.cycle);
  const latest = queues[0];
  const success = row.remote_success || queues.some(q => q.delivery_state === 'KNOWN_SUCCESS' || q.status === 'SUCCEEDED' || q.status === 'REMOTE_SUCCEEDED');
  if (success) {
    if (latest && !['SUCCEEDED', 'REMOTE_SUCCEEDED'].includes(latest.status)) return result('Unknown / unlinked', observed + 'Known remote success conflicts with another queue state. Reconcile locally; never send again.');
    return result('Succeeded', observed + (latest?.status === 'REMOTE_SUCCEEDED' || !latest
      ? 'Known remote success; local finalization/reconciliation may be required. Never send again.' : 'Remote INSW success recorded.'));
  }
  if (latest) {
    if (latest.status === 'HELD' || latest.hold_reason === 'DELIVERY_UNKNOWN') return result('Held / Delivery unknown', observed + 'Held work requires investigation through the existing INSW workflow; regeneration is blocked.');
    if (latest.status === 'READY') return result('Queued', observed + (workerAuthorized ? 'Waiting for asynchronous processing, including any scheduled automatic retry.' : 'Queue exists; worker authorization is not established in this application process.'));
    if (latest.status === 'CLAIMED') return result('Processing', observed + 'Queue ownership exists; remote delivery is not yet confirmed.');
    if (latest.status === 'FAILED') return result('Failed', observed + 'An existing INSW cycle failed. Use guarded RESEND only when eligible in INSW Logs; never regenerate a missing queue.');
    return result('Unknown / unlinked', observed + 'Unrecognized lifecycle state requires reconciliation.');
  }
  if (row.history_count) return result('Unknown / unlinked', 'INSW tracking evidence exists without an exact queue association. Investigate legacy or ambiguous delivery; do not regenerate.');
  return { ...result('Not queued', 'WMS was accepted and a source with details is persisted, but no correlated queue or tracking evidence was found. This does not prove complete stock processing or permission to send. ' + regenerationBlock), canRegenerate: workerAuthorized };
}

/** One bounded SQL statement for the whole authorized page, across companies and
 * all six domains. No payloads, provider responses, or per-row DB awaits.
 * The scope is rechecked here rather than trusting caller-selected log IDs. */
export async function wmsLogInswStatuses(db: Pick<PrismaClient, '$queryRaw'>,
  principal: { role: string; companyCode?: unknown }, ids: readonly bigint[],
): Promise<Map<string, WmsInswStatus>> {
  if (!ids.length) return new Map();
  if (ids.length > 50 || ids.some(id => id < BigInt(1) || id > BigInt('9223372036854775807'))) throw new Error('Invalid WMS status page');
  const company = Number(principal.companyCode);
  if (principal.role !== 'SUPER_ADMIN' && (!Number.isInteger(company) || company <= 0)) throw new Error('Assigned company required');
  let allowed: readonly number[] = [];
  try { allowed = resolveWorkerAllowedCompanies(); } catch { /* Missing fence never grants authority. */ }
  const rows = await db.$queryRaw<WmsInswFacts[]>(wmsInswFactsSql(Prisma.sql`w.id IN (${Prisma.join(ids)})
    ${principal.role === 'SUPER_ADMIN' ? Prisma.empty : Prisma.sql`AND w.company_code = ${company}`}`));
  return new Map(rows.map(row => [String(row.log_id), projectWmsInswStatus(row, allowed.includes(row.company_code))]));
}

/** Shared source/queue/history facts for bounded page enrichment and pre-page filtering.
 * scopePredicate must be bound by the authorized list/export boundary. */
export function wmsInswFactsSql(scopePredicate: Prisma.Sql): Prisma.Sql {
  const sources = wmsSourceDomains.map(([operation, action, table, date, items, prefix]) => {
    const stock = operation === 'STOCK_OPNAME';
    const details = stock
      ? Prisma.sql`EXISTS (SELECT 1 FROM wms_stock_opname_items i WHERE i.wms_stock_opname_id = g.id AND i.company_code = g.company_code)`
      : Prisma.sql`EXISTS (SELECT 1 FROM ${Prisma.raw(items)} i
          WHERE i.${Prisma.raw(prefix + '_id')} = g.id AND i.${Prisma.raw(prefix + '_company')} = g.company_code
            AND i.${Prisma.raw(prefix + '_date')} = g.${Prisma.raw(date)} AND i.deleted_at IS NULL)`;
    return Prisma.sql`SELECT w.*, ${operation}::text AS operation, s.* FROM scope w
      LEFT JOIN LATERAL (
        SELECT g.id::bigint AS source_id, count(*) OVER () AS source_matches,
          to_char(g.${Prisma.raw(date)}, 'YYYY-MM-DD') AS business_date,
          ${stock ? Prisma.sql`concat('CONFIRMED:', to_char(g.confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))` : Prisma.sql`${operation === 'ADJUSTMENT' ? 'COMMITTED_SOURCE' : 'ACCEPTED_WMS_ID'}::text`} AS revision,
          (${details} AND g.id BETWEEN 1 AND 2147483647
            ${operation === 'OUTGOING' ? Prisma.sql`AND g.scrap_transaction_id IS NULL` : Prisma.empty}
            ${stock ? Prisma.sql`AND g.status = 'CONFIRMED' AND g.confirmed_at IS NOT NULL` : Prisma.empty}) AS source_valid
        FROM ${Prisma.raw(table)} g WHERE g.company_code = w.company_code AND g.wms_id = w.wms_id
          ${stock ? Prisma.empty : Prisma.sql`AND g.deleted_at IS NULL`}
        ORDER BY g.id DESC LIMIT 1
      ) s ON true WHERE (w.action IN (${action}, ${action + '_RETRY'}) ${stock ? Prisma.sql`OR w.action = 'WMS_CREATE_STOCK_OPNAME'` : Prisma.empty})`;
  });
  return Prisma.sql`
    WITH scope AS MATERIALIZED (
      SELECT w.id AS log_id, w.company_code, w.action, w.wms_id, w.transmission_status
      FROM wms_transmission_logs w JOIN companies c ON c.code = w.company_code AND c.company_type = 'SEZ'
      WHERE ${scopePredicate}
    ), sources AS (${Prisma.join(sources, ' UNION ALL ')})
    SELECT s.*, COALESCE(q.queues, '[]'::jsonb) AS queues,
      h.history_count, h.remote_success, h.history_mismatch
    FROM sources s
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('identity_key', q.identity_key, 'business_date', q.business_date,
        'source_revision', q.source_revision, 'cycle', q.cycle, 'status', q.status,
        'delivery_state', q.delivery_state, 'hold_reason', q.hold_reason)) AS queues
      FROM insw_queue_cycle q WHERE q.company_code = s.company_code AND q.operation::text = s.operation
        AND (q.wms_reference = s.wms_id OR q.wms_reference IS NULL
          OR starts_with(q.identity_key, concat('["insw-v1",', s.company_code, ',"', s.operation, '","',
            CASE WHEN s.operation IN ('ADJUSTMENT', 'STOCK_OPNAME') THEN 'SOURCE_HEADER' ELSE 'WMS_REFERENCE' END, '",',
            to_json(CASE WHEN s.operation IN ('ADJUSTMENT', 'STOCK_OPNAME') THEN s.source_id::text ELSE s.wms_id END)::text, ',')))
    ) q ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS history_count, COALESCE(bool_or(h.insw_status = 'SUCCESS'), false) AS remote_success,
        COALESCE(bool_or((h.wms_id IS NOT NULL AND h.wms_id IS DISTINCT FROM s.wms_id)
          OR (h.transaction_id IS NOT NULL AND h.transaction_id IS DISTINCT FROM s.source_id)), false) AS history_mismatch
      FROM insw_tracking_log h WHERE h.company_code = s.company_code AND h.transaction_type = lower(s.operation)
        AND (h.wms_id = s.wms_id OR h.transaction_id = s.source_id)
    ) h ON true`;
}

/** SQL equivalent of projectWmsInswStatus's ordered lifecycle decisions. The
 * facts query is shared; regression fixtures compare every SQL category with
 * the explanatory projector. No queue absence shortcut or per-audit DB calls. */
export function wmsInswClassifiedSql(scopePredicate: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`WITH facts AS MATERIALIZED (${wmsInswFactsSql(scopePredicate)}), identities AS MATERIALIZED (
    SELECT f.*, concat('["insw-v1",', company_code, ',', to_json(operation)::text, ',',
      to_json(CASE WHEN operation IN ('ADJUSTMENT', 'STOCK_OPNAME') THEN 'SOURCE_HEADER' ELSE 'WMS_REFERENCE' END)::text, ',',
      to_json(CASE WHEN operation IN ('ADJUSTMENT', 'STOCK_OPNAME') THEN source_id::text ELSE wms_id END)::text, ',',
      to_json(revision)::text, ',', to_json(business_date)::text, ']') AS canonical_key,
      (SELECT q FROM jsonb_array_elements(queues) q ORDER BY (q->>'cycle')::integer DESC LIMIT 1) AS latest
    FROM facts f
  ) SELECT log_id, CASE
    WHEN transmission_status <> 'SUCCESS' OR wms_id IS NULL OR wms_id = ''
      OR source_matches IS DISTINCT FROM 1::bigint OR source_id IS NULL
      OR business_date IS NULL OR revision IS NULL OR revision = '' OR source_valid IS DISTINCT FROM true
      OR company_code NOT BETWEEN 1 AND 2147483647
      OR business_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR length(revision) > 200 OR revision ~ '[\x01-\x1f]'
      OR (operation NOT IN ('ADJUSTMENT', 'STOCK_OPNAME') AND
        ((length(wms_id) + length(regexp_replace(wms_id, '[^𐀀-􏿿]', '', 'g'))) > 100 OR wms_id ~ '[\x01-\x1f]' OR
          btrim(wms_id, ${' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'}) <> wms_id))
      THEN 'Unknown / unlinked'
    WHEN history_mismatch OR EXISTS (SELECT 1 FROM jsonb_array_elements(queues) q
      WHERE q->>'identity_key' IS DISTINCT FROM canonical_key
        OR q->>'business_date' IS DISTINCT FROM business_date
        OR q->>'source_revision' IS DISTINCT FROM revision) THEN 'Unknown / unlinked'
    WHEN remote_success OR EXISTS (SELECT 1 FROM jsonb_array_elements(queues) q
      WHERE q->>'delivery_state' = 'KNOWN_SUCCESS' OR q->>'status' IN ('SUCCEEDED', 'REMOTE_SUCCEEDED'))
      THEN CASE WHEN latest IS NOT NULL AND latest->>'status' NOT IN ('SUCCEEDED', 'REMOTE_SUCCEEDED')
        THEN 'Unknown / unlinked' ELSE 'Succeeded' END
    WHEN latest->>'status' = 'HELD' OR latest->>'hold_reason' = 'DELIVERY_UNKNOWN' THEN 'Held / Delivery unknown'
    WHEN latest->>'status' = 'READY' THEN 'Queued'
    WHEN latest->>'status' = 'CLAIMED' THEN 'Processing'
    WHEN latest->>'status' = 'FAILED' THEN 'Failed'
    WHEN latest IS NOT NULL OR history_count > 0 THEN 'Unknown / unlinked'
    ELSE 'Not queued' END AS label FROM identities`;
}

export function wmsInswMatchingIds(authorizedPredicate: Prisma.Sql, label: WmsInswStatusFilter): Prisma.Sql {
  return Prisma.sql`WITH classified AS MATERIALIZED (${wmsInswClassifiedSql(Prisma.sql`w.id IN (
    SELECT log.id FROM wms_transmission_logs log WHERE ${authorizedPredicate})`)}) SELECT log_id FROM classified WHERE label = ${label}`;
}
