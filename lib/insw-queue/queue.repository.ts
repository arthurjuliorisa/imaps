import { randomUUID } from 'node:crypto';
import { InswDeliveryState, InswHoldReason, Prisma, PrismaClient } from '@prisma/client';
import { boundedText, canonicalIdentity, freezePayload, integer, TransmissionIdentity } from './contracts';
import { readPolicy } from './policy.repository';

export type EnqueueInput = {
  identity: TransmissionIdentity;
  payload: unknown;
  intent: 'SOURCE_COMMIT' | 'EXPLICIT_POST' | 'MANUAL_RESUBMIT' | 'RECOVERY';
  requestedBy: string;
  wmsReference?: string;
  sourceLogId?: bigint;
};
const active = ['READY', 'CLAIMED', 'REMOTE_SUCCEEDED', 'HELD'] as const;
const summary = { id: true, cycle: true, status: true, tail_key: true, max_auto_retry_snapshot: true } as const;

// REQUIRED transaction client: source persistence and this function share one commit.
// Explicit actions against an existing source can use enqueueExisting below.
export async function enqueueInTransaction(tx: Prisma.TransactionClient, input: EnqueueInput) {
  const identity = canonicalIdentity(input.identity);
  const frozen = freezePayload(input.payload);
  boundedText(input.requestedBy, 'request actor', 100);
  if (!['SOURCE_COMMIT', 'EXPLICIT_POST', 'MANUAL_RESUBMIT', 'RECOVERY'].includes(input.intent)) throw new Error('Invalid intent');
  const wms = input.wmsReference ?? (input.identity.kind === 'WMS_REFERENCE' ? input.identity.reference : undefined);
  if (wms !== undefined) boundedText(wms, 'WMS reference', 100);
  if (input.identity.kind === 'WMS_REFERENCE' && wms !== input.identity.reference) throw new Error('Conflicting WMS reference');
  if (input.sourceLogId !== undefined && (typeof input.sourceLogId !== 'bigint' || input.sourceLogId <= BigInt(0) || input.sourceLogId > BigInt('9223372036854775807'))) throw new Error('Invalid source log ID');
  // Hash collisions only serialize unrelated identities; uniqueness uses the full key.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.key}, 0))::text`;
  const existing = await tx.insw_queue_cycle.findFirst({
    where: { identity_key: identity.key, status: { in: [...active] } },
    select: { ...summary, payload_sha256: true, intent: true, wms_reference: true, source_log_id: true },
  });
  if (existing) {
    if (existing.payload_sha256 !== frozen.sha256 || existing.intent !== input.intent || existing.wms_reference !== (wms ?? null) || existing.source_log_id !== (input.sourceLogId ?? null)) {
      throw new Error('Active INSW cycle conflicts with frozen payload or intent');
    }
    const { payload_sha256: _hash, intent: _intent, wms_reference: _wms, source_log_id: _source, ...result } = existing;
    return { ...result, created: false };
  }
  const policy = await readPolicy(tx);
  const prior = await tx.insw_queue_cycle.findFirst({ where: { identity_key: identity.key }, orderBy: { cycle: 'desc' }, select: { cycle: true } });
  const row = await tx.insw_queue_cycle.create({ data: {
    company_code: identity.companyCode, operation: identity.operation, identity_key: identity.key,
    source_revision: identity.revision, business_date: identity.businessDate, wms_reference: wms,
    cycle: (prior?.cycle ?? 0) + 1, intent: input.intent, requested_by: input.requestedBy,
    source_log_id: input.sourceLogId, frozen_payload: frozen.payload, payload_sha256: frozen.sha256,
    max_auto_retry_snapshot: policy.max_auto_retry,
  }, select: summary });
  return { ...row, created: true };
}
export function enqueueExisting(db: PrismaClient, input: EnqueueInput) {
  return db.$transaction(tx => enqueueInTransaction(tx, input));
}

export type Claim = { id: string; owner_token: string; retry_index: number; tail_key: bigint; attemptId: string };
// Local queue ownership only. No global HTTP gate, payload polling, timer or send.
export async function claimJob(db: PrismaClient, leaseMs: number): Promise<Claim | null> {
  integer(leaseMs, 'lease duration', 1);
  const token = randomUUID();
  return db.$transaction(async tx => {
    await readPolicy(tx); // fail closed, NOT an authoritative dispatch admission check
    const rows = await tx.$queryRaw<Omit<Claim, 'attemptId'>[]>`
      WITH candidate AS (
        SELECT id FROM insw_queue_cycle
        WHERE status = 'READY' AND next_eligible_at <= clock_timestamp()
        ORDER BY tail_key, id FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE insw_queue_cycle q SET status = 'CLAIMED', owner_token = ${token}::uuid,
        lease_until = clock_timestamp() + ${leaseMs} * interval '1 millisecond',
        claimed_at = clock_timestamp(), last_attempt_at = clock_timestamp()
      FROM candidate WHERE q.id = candidate.id
      RETURNING q.id, q.owner_token, q.retry_index, q.tail_key`;
    if (!rows.length) return null;
    const row = rows[0];
    const attempt = await tx.insw_queue_attempt.create({ data: {
      queue_id: row.id, owner_token: token, retry_index: row.retry_index,
    }, select: { id: true } });
    return { ...row, attemptId: attempt.id };
  });
}

type Transition = 'MARK_POSSIBLE_START' | 'RECORD_REMOTE_SUCCESS' | 'FINALIZE_SUCCESS' | 'FINALIZE_FAILURE' | 'HOLD_UNKNOWN' | 'HOLD_DISABLED';
const transitions: Record<Transition, { from: string; delivery: InswDeliveryState; status: string; nextDelivery: InswDeliveryState; hold?: InswHoldReason; terminal?: boolean }> = {
  MARK_POSSIBLE_START: { from: 'CLAIMED', delivery: 'NOT_STARTED', status: 'CLAIMED', nextDelivery: 'POSSIBLY_STARTED' },
  RECORD_REMOTE_SUCCESS: { from: 'CLAIMED', delivery: 'POSSIBLY_STARTED', status: 'REMOTE_SUCCEEDED', nextDelivery: 'KNOWN_SUCCESS' },
  FINALIZE_SUCCESS: { from: 'REMOTE_SUCCEEDED', delivery: 'KNOWN_SUCCESS', status: 'SUCCEEDED', nextDelivery: 'KNOWN_SUCCESS', terminal: true },
  FINALIZE_FAILURE: { from: 'CLAIMED', delivery: 'POSSIBLY_STARTED', status: 'FAILED', nextDelivery: 'KNOWN_FAILURE', terminal: true },
  HOLD_UNKNOWN: { from: 'CLAIMED', delivery: 'POSSIBLY_STARTED', status: 'HELD', nextDelivery: 'POSSIBLY_STARTED', hold: 'DELIVERY_UNKNOWN' },
  HOLD_DISABLED: { from: 'CLAIMED', delivery: 'NOT_STARTED', status: 'HELD', nextDelivery: 'NOT_STARTED', hold: 'ENDPOINT_DISABLED' },
};
export type ShortError = { category: string; code: string; message: string };
// No HTTP, no source-finalization callbacks. Future source updates can share this tx.
export async function transitionInTransaction(tx: Prisma.TransactionClient, claim: Pick<Claim, 'id' | 'owner_token'>, action: Transition, error?: ShortError) {
  const step = transitions[action];
  if (!step) throw new Error('Invalid transition');
  if (error) {
    boundedText(error.category, 'error category', 50);
    boundedText(error.code, 'error code', 100);
    boundedText(error.message, 'error message', 500);
  }
  const release = !!step.terminal || !!step.hold;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE insw_queue_cycle SET status = ${step.status}::"InswQueueStatus",
      delivery_state = ${step.nextDelivery}::"InswDeliveryState",
      hold_reason = ${step.hold ?? null}::"InswHoldReason",
      completed_at = CASE WHEN ${!!step.terminal} THEN clock_timestamp() ELSE NULL END,
      owner_token = CASE WHEN ${release} THEN NULL ELSE owner_token END,
      lease_until = CASE WHEN ${release} THEN NULL ELSE lease_until END,
      error_category = ${error?.category ?? null}, error_code = ${error?.code ?? null}, error_message = ${error?.message ?? null}
    WHERE id = ${claim.id}::uuid AND owner_token = ${claim.owner_token}::uuid
      AND lease_until > clock_timestamp() AND status = ${step.from}::"InswQueueStatus"
      AND delivery_state = ${step.delivery}::"InswDeliveryState"
    RETURNING id`;
  if (!rows.length) throw new Error('Stale owner, expired lease or invalid transition');
  const attempts = await tx.insw_queue_attempt.updateMany({
    where: { queue_id: claim.id, owner_token: claim.owner_token, delivery_state: step.delivery },
    data: { delivery_state: step.nextDelivery,
      ...(action === 'MARK_POSSIBLE_START' ? { started_at: new Date() } : {}),
      ...(release ? { completed_at: new Date() } : {}) },
  });
  if (attempts.count !== 1) throw new Error('Attempt ownership mismatch');
}
export function transition(db: PrismaClient, claim: Pick<Claim, 'id' | 'owner_token'>, action: Transition, error?: ShortError) {
  return db.$transaction(tx => transitionInTransaction(tx, claim, action, error));
}

// Explicit bounded recovery primitive, never called by a timer. Nothing becomes READY.
export async function holdExpiredClaims(db: PrismaClient, limit = 100) {
  integer(limit, 'recovery batch size', 1, 1000);
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string; delivery_state: InswDeliveryState }[]>`
      WITH expired AS (
        SELECT id FROM insw_queue_cycle WHERE status IN ('CLAIMED', 'REMOTE_SUCCEEDED')
          AND lease_until <= clock_timestamp()
        ORDER BY lease_until, id FOR UPDATE SKIP LOCKED LIMIT ${limit}
      )
      UPDATE insw_queue_cycle q SET status = 'HELD',
        hold_reason = CASE q.delivery_state
          WHEN 'NOT_STARTED' THEN 'PRE_SEND_LEASE_EXPIRED'::"InswHoldReason"
          WHEN 'KNOWN_SUCCESS' THEN 'LOCAL_FINALIZATION_REQUIRED'::"InswHoldReason"
          ELSE 'DELIVERY_UNKNOWN'::"InswHoldReason" END,
        owner_token = NULL, lease_until = NULL
      FROM expired WHERE q.id = expired.id
      RETURNING q.id, q.delivery_state`;
    if (rows.length) await tx.insw_queue_attempt.updateMany({
      where: { queue_id: { in: rows.map(row => row.id) }, completed_at: null }, data: { completed_at: new Date() },
    });
    return rows.map(row => ({ id: row.id, deliveryState: row.delivery_state }));
  });
}

// Reserved tail allocation only. No retry/requeue transition is implemented in Phase B.
export async function reserveTail(tx: Prisma.TransactionClient): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ tail: bigint }[]>`SELECT nextval(pg_get_serial_sequence('insw_queue_cycle', 'tail_key')) AS tail`;
  return row.tail;
}
