import { readFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { verifyReaped, type ProcessIdentity } from '../../lib/insw-worker/process-identity';
import { domains, requireSafe, hash, itemHash, type Source } from './core';
const mappings = [
  ['incoming_goods', 'incoming_good_items', 'incoming_good'], ['outgoing_goods', 'outgoing_good_items', 'outgoing_good'],
  ['material_usages', 'material_usage_items', 'material_usage'], ['production_outputs', 'production_output_items', 'production_output'],
  ['adjustments', 'adjustment_items', 'adjustment'],
] as const;
export type DatabaseIdentity = { database: string; role: string; address: string | null; port: number; recovery: boolean; observed_at?: Date };
export function loopbackAddress(address: string | null): string | null {
  if (address === '127.0.0.1' || address === '127.0.0.1/32') return '127.0.0.1';
  if (address === '::1' || address === '::1/128') return '::1';
  return null;
}
export function identityBlockers(identity: DatabaseIdentity, port: number, role = 'imapsuser'): string[] {
  return [
    identity.database !== 'imaps_db_vps' && 'OBSERVED_DATABASE_NAME_MISMATCH',
    !loopbackAddress(identity.address) && 'OBSERVED_DATABASE_ADDRESS_NOT_LOOPBACK',
    identity.port !== port && 'OBSERVED_DATABASE_PORT_MISMATCH',
    (!identity.role || /prod/i.test(identity.role) || identity.role !== role) && 'OBSERVED_DATABASE_ROLE_UNSAFE',
    identity.recovery !== false && 'OBSERVED_DATABASE_IN_RECOVERY',
  ].filter((v): v is string => typeof v === 'string');
}
export function gateReadiness(gate: { owner_token?: unknown; busy_attempt_id?: unknown; process_identity?: unknown;
  lease_until?: Date | null; last_started_at?: Date | null; prior_interval_ms?: number | null; recovery_barrier_at?: Date | null } | null,
  now = Date.now()) {
  const identity = gate?.process_identity as Partial<ProcessIdentity> | null;
  let processState = identity ? 'UNKNOWN' : 'ABSENT';
  if (identity) {
    try { verifyReaped(identity as ProcessIdentity); processState = 'REAPED_LOCAL'; }
    catch (e) {
      processState = 'UNKNOWN_HOST_OR_IDENTITY';
      if (e instanceof Error && e.message === 'OWNER_PROCESS_NOT_REAPED') {
        try {
          const stat = readFileSync(`/proc/${identity.pid}/stat`, 'utf8');
          processState = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] === identity.start ? 'VERIFIED_LOCAL_OWNER_LIVE' : 'REUSED_PID';
        } catch { processState = 'UNKNOWN_LOCAL_PID'; }
      }
    }
  }
  const pacingConsistent = !!gate && (gate.last_started_at === null) === (gate.prior_interval_ms === null)
    && (gate.prior_interval_ms === null || Number.isInteger(gate.prior_interval_ms) && gate.prior_interval_ms! >= 3600)
    && (gate.last_started_at !== null || gate.recovery_barrier_at == null);
  const safe = !!gate && gate.owner_token === null && gate.busy_attempt_id === null && gate.process_identity === null
    && gate.lease_until === null && pacingConsistent;
  return { safe, present: !!gate, owner: !!gate?.owner_token, busy: !!gate?.busy_attempt_id,
    lease: gate?.lease_until ? (gate.lease_until.getTime() <= now ? 'EXPIRED' : 'ACTIVE') : 'ABSENT',
    identity: { present: !!identity, pid: Number.isSafeInteger(identity?.pid) ? identity!.pid : null, state: processState },
    pacingConsistent, lastStartedAt: gate?.last_started_at ?? null, priorIntervalMs: gate?.prior_interval_ms ?? null,
    recoveryBarrierAt: gate?.recovery_barrier_at ?? null };
}
export async function inspect(db: PrismaClient, retryCap: number | undefined, runIds: string[] = [], port = 5432, role = 'imapsuser') {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [identity] = await tx.$queryRaw<DatabaseIdentity[]>`
      SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address,
        inet_server_port() AS port, pg_is_in_recovery() AS recovery, clock_timestamp() AS observed_at`;
    const blockers = identityBlockers(identity, port, role);
    const check = (condition: unknown, code: string) => { if (!condition) blockers.push(code); };
    if (blockers.length) return { identity: { ...identity, normalizedAddress: loopbackAddress(identity.address) }, blockers };
    const company = await tx.companies.findUnique({ where: { code: 1370 }, select: { company_type: true } });
    check(company?.company_type === 'SEZ', 'SEZ_COMPANY_REQUIRED');
    const gate = await tx.insw_dispatch_gate.findUnique({ where: { id: 1 } });
    const gateSummary = gateReadiness(gate, identity.observed_at?.getTime());
    check(gateSummary.safe, 'PRE_EXISTING_OR_UNRESOLVED_GATE_OWNER');
    const unfinishedAttempts = await tx.insw_queue_attempt.count({ where: { completed_at: null } });
    const queueOwners = await tx.insw_queue_cycle.count({ where: { OR: [{ owner_token: { not: null } }, { lease_until: { not: null } }] } });
    check(unfinishedAttempts === 0, 'UNFINISHED_PRIOR_ATTEMPT');
    check(queueOwners === 0, 'PRE_EXISTING_QUEUE_OWNER');
    const policy = await tx.insw_transmission_policy.findUnique({ where: { id: 1 }, select: { id: true, min_processing_interval_ms: true, max_auto_retry: true, version: true } });
    check(policy && policy.min_processing_interval_ms >= 3600 && policy.max_auto_retry >= 0 && policy.max_auto_retry <= 10, 'POLICY_UNSAFE_OR_UNSUPPORTED');
    if (policy && retryCap !== undefined) check(policy.max_auto_retry <= retryCap, 'POLICY_EXCEEDS_RUN_BUDGET');
    const pending = await tx.insw_queue_cycle.count({ where: { status: { in: ['READY', 'CLAIMED', 'REMOTE_SUCCEEDED'] },
      ...(runIds.length ? { NOT: { company_code: 1370, wms_reference: { in: runIds } }, } : {}) } });
    const activeClaims = await tx.insw_queue_cycle.count({ where: { status: { in: ['CLAIMED', 'REMOTE_SUCCEEDED'] } } });
    check(pending === 0 && activeClaims === 0, 'PRE_EXISTING_QUEUE_BACKLOG');
    const settings = await tx.insw_integration_settings.findMany({ where: { endpoint_key: { in: ['PEMASUKAN', 'PENGELUARAN', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT'] } }, select: { endpoint_key: true, is_enabled: true } });
    check(settings.length === 5 && settings.every(s => s.is_enabled), 'REQUIRED_ENDPOINT_SETTINGS_DISABLED_OR_MISSING');
    return { identity: { ...identity, normalizedAddress: loopbackAddress(identity.address) }, company, gate: gateSummary, policy, pending, counts: { unfinishedAttempts, queueOwners, activeClaims, pending }, settings, blockers };
  }, { timeout: 15000 });
}
export async function collisionIds(db: PrismaClient, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const sources = await Promise.all(Object.values(domains).map(d => tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT wms_id AS id FROM ${Prisma.raw(d.table)} WHERE company_code = 1370 AND wms_id IN (${Prisma.join(ids)})`)));
    const queue = await tx.insw_queue_cycle.findMany({ where: { company_code: 1370, wms_reference: { in: ids } }, select: { wms_reference: true } });
    const logs = await tx.wms_transmission_logs.findMany({ where: { company_code: 1370, wms_id: { in: ids } }, select: { wms_id: true } });
    const tracking = await tx.insw_tracking_log.findMany({ where: { company_code: 1370, wms_id: { in: ids } }, select: { wms_id: true } });
    return [...sources.flat().map(r => r.id), ...queue.map(r => r.wms_reference), ...logs.map(r => r.wms_id), ...tracking.map(r => r.wms_id)];
  });
  return new Set(rows.filter((s): s is string => s !== null));
}
export async function observe(db: PrismaClient, ids: string[]) {
  requireSafe(ids.length, 'OBSERVATION_IDS_REQUIRED');
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const sources = (await Promise.all(mappings.map(async ([table, items, prefix]) => {
      const raw = await tx.$queryRaw<{ table: string; id: number; wms_id: string; item_count: number; reversal: string | null; work_order: string | null; item_values: Source[] | null }[]>(Prisma.sql`
        SELECT ${table} AS "table", s.id, s.wms_id, to_jsonb(s)->>'reversal' AS reversal,
          to_jsonb(s)->>'work_order_number' AS work_order,
          (SELECT jsonb_agg(jsonb_build_object('item_code',i.item_code,'uom',i.uom,'qty',i.qty,
            'work_order_number',to_jsonb(i)->>'work_order_number',
            'planned_production_qty',to_jsonb(i)->>'planned_production_qty')) FROM ${Prisma.raw(items)} i
            WHERE i.${Prisma.raw(prefix + '_id')} = s.id AND i.${Prisma.raw(prefix + '_company')} = s.company_code) AS item_values,
          (SELECT count(*)::int FROM ${Prisma.raw(items)} i WHERE i.${Prisma.raw(prefix + '_id')} = s.id
            AND i.${Prisma.raw(prefix + '_company')} = s.company_code) AS item_count
        FROM ${Prisma.raw(table)} s WHERE s.company_code = 1370 AND s.wms_id IN (${Prisma.join(ids)}) AND s.deleted_at IS NULL`);
      return raw.map(({ item_values, work_order, ...row }) => ({ ...row,
        work_order_hash: work_order === null ? null : hash(work_order), item_hash: itemHash(item_values ?? []) }));
    }))).flat();
    const queue = await tx.insw_queue_cycle.findMany({ where: { company_code: 1370, wms_reference: { in: ids } }, select: {
      id: true, operation: true, wms_reference: true, source_log_id: true, payload_sha256: true, status: true,
      delivery_state: true, hold_reason: true, retry_index: true, max_auto_retry_snapshot: true,
    } });
    const attempts = await tx.insw_queue_attempt.findMany({ where: { queue_id: { in: queue.map(q => q.id) } }, select: {
      id: true, queue_id: true, retry_index: true, started_at: true, completed_at: true, delivery_state: true,
    } });
    const logs = await tx.insw_tracking_log.findMany({ where: { company_code: 1370, wms_id: { in: ids } }, select: {
      id: true, queue_attempt_id: true, transaction_id: true, transaction_type: true, wms_id: true, insw_status: true, metadata: true,
    } });
    const wmsLogs = await tx.wms_transmission_logs.findMany({ where: { company_code: 1370, wms_id: { in: ids } }, select: {
      id: true, wms_id: true, transmission_status: true,
    } });
    // Explicit whitelist: never serialize response bodies, provider messages or arbitrary metadata.
    const safeLogs = logs.map(({ metadata, ...log }) => {
      const m = metadata as Record<string, unknown> | null;
      const code = (v: unknown) => typeof v === 'string' && /^[A-Z0-9_]{1,100}$/.test(v) ? v : null;
      return { ...log, http_code: typeof m?.httpCode === 'number' ? m.httpCode : null,
        provider_status: typeof m?.providerStatus === 'boolean' ? m.providerStatus : null, classification: code(m?.classification),
        reason_code: code(m?.reasonCode), payload_sha256: typeof m?.payload_sha256 === 'string' && /^[a-f0-9]{64}$/.test(m.payload_sha256) ? m.payload_sha256 : null };
    });
    const gate = await tx.insw_dispatch_gate.findUnique({ where: { id: 1 }, select: { last_started_at: true, busy_attempt_id: true } });
    return { sources, queue, attempts, logs: safeLogs, wmsLogs, gate };
  });
}
export type Observation = Awaited<ReturnType<typeof observe>>;
export async function preservation(db: PrismaClient, ids: string[]) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const result: Record<string, unknown> = {};
    for (const [table, items, prefix] of mappings) {
      // Read-only bounded aggregate fingerprints; includes soft-deleted headers.
      const [headers] = await tx.$queryRaw<unknown[]>(Prisma.sql`SELECT count(*)::text AS count,
        coalesce(sum(hashtextextended(to_jsonb(s)::text,0)::numeric),0)::text AS fingerprint
        FROM ${Prisma.raw(table)} s WHERE NOT (s.company_code = 1370 AND s.wms_id IN (${Prisma.join(ids)}))`);
      const [details] = await tx.$queryRaw<unknown[]>(Prisma.sql`SELECT count(*)::text AS count,
        coalesce(sum(hashtextextended(to_jsonb(i)::text,0)::numeric),0)::text AS fingerprint
        FROM ${Prisma.raw(items)} i WHERE NOT EXISTS (SELECT 1 FROM ${Prisma.raw(table)} s
          WHERE s.id = i.${Prisma.raw(prefix + '_id')} AND s.company_code = i.${Prisma.raw(prefix + '_company')}
            AND s.company_code = 1370 AND s.wms_id IN (${Prisma.join(ids)}))`);
      result[table] = headers; result[items] = details;
    }
    return result;
  }, { timeout: 60000 });
}
