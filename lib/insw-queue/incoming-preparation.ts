import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type insw_preparation_ledger as Ledger } from '@prisma/client';
import { integer } from './contracts';
import { prepareIncomingHandoff, handoffIncomingInTransaction } from './incoming-handoff';
import type { INSWTransaksiPayload } from '../types/insw-api.types';
import type { RecoveryPrincipal } from './incoming-recovery';

type Capture = (source: Readonly<{ companyCode: number; sourceId: number; wmsReference: string; businessDate: string }>) => Promise<INSWTransaksiPayload>;
export type PreparationConfig = { maxAttempts: number; leaseMs: number; baseDelayMs: number };
const defaultConfig: PreparationConfig = { maxAttempts: 5, leaseMs: 30000, baseDelayMs: 1000 };
/** Production discovery is deliberately unavailable: timestamps, missing queue
 * rows and WMS logs cannot establish exclusive queue-era membership. */
export function discoverProductionIncoming(): never {
  throw new Error('C2C_EXCLUSIVITY_AND_SOURCE_MEMBERSHIP_UNPROVEN');
}

/** Test/manual contract only. Inject a dedicated local disposable DB client,
 * authenticated server principal and synthetic provider; never a source tx.
 * This module has no application singleton, transport, scheduler or producer. */
export function isolatedIncomingPreparation(db: PrismaClient, capture: Capture, now = () => new Date(), config: PreparationConfig = defaultConfig) {
  if (!('$transaction' in db)) throw new Error('Dedicated database client required');
  const budget = integer(config.maxAttempts, 'preparation budget', 1, 5);
  const leaseMs = integer(config.leaseMs, 'preparation lease', 1, 300000);
  const baseDelayMs = integer(config.baseDelayMs, 'preparation delay', 1, 60000);
  async function authorize(principal: RecoveryPrincipal, company: number, rollout: string) {
    integer(company, 'company', 1);
    if (principal.role !== 'SUPER_ADMIN' &&
        (!['ADMIN', 'USER'].includes(principal.role) || principal.companyCode !== company)) throw new Error('Company access denied');
    if (process.env.NODE_ENV === 'production') throw new Error('ISOLATED_TEST_ONLY');
    const [runtime] = await db.$queryRaw<{ name: string; host: string | null }[]>`
      SELECT current_database() AS name, host(inet_server_addr()) AS host`;
    if (!/^[a-z0-9_]+_phase_c2a_test$/.test(runtime.name) ||
        !['127.0.0.1', '::1'].includes(runtime.host ?? '')) throw new Error('ISOLATED_TEST_ONLY');
    const boundary = await db.insw_preparation_rollout.findFirst({ where: {
      id: rollout, company_code: company, source_kind: 'INCOMING', mode: 'PREPARED',
    } });
    const evidence = boundary?.evidence as Record<string, unknown> | undefined;
    if (evidence?.exclusiveProducer !== 'SYNTHETIC_NO_DIRECT_PRODUCER' ||
        evidence?.membership !== 'EXPLICIT_SYNTHETIC_MANIFEST' || evidence?.review !== 'ISOLATED_TEST') {
      throw new Error('ROLLOUT_PROOF_REQUIRED');
    }
  }
  // Bounded manifest discovery: never scans arbitrary Incoming rows or logs.
  async function discover(principal: RecoveryPrincipal, company: number, rollout: string, after = '', limit = 100) {
    await authorize(principal, company, rollout);
    integer(limit, 'batch', 1, 100);
    const members = await db.insw_preparation_member.findMany({ where: {
      rollout_id: rollout, company_code: company, proof: 'SYNTHETIC_ACCEPTED_QUEUE_ERA',
      ...(after ? { id: { gt: after } } : {}),
    }, orderBy: { id: 'asc' }, take: limit });
    if (!members.length) return { observed: 0, cursor: null };
    await db.insw_preparation_ledger.createMany({ data: members.map(m => ({
      member_id: m.id, rollout_id: rollout, company_code: company, source_kind: 'INCOMING',
      source_id: m.source_id, business_date: m.business_date, wms_reference: m.wms_reference,
      state: 'PENDING', reason: 'SYNTHETIC_MEMBERSHIP_VERIFIED', next_eligible_at: now(),
    })), skipDuplicates: true });
    return { observed: members.length, cursor: members.at(-1)!.id };
  }
  async function check(tx: Prisma.TransactionClient, row: Ledger) {
    // Serialize changes to the synthetic proof while this short queue transaction
    // checks it. No source-row lock or source transaction enrollment.
    await tx.$queryRaw`SELECT m.id FROM insw_preparation_member m
      JOIN insw_preparation_rollout r ON r.id = m.rollout_id
      WHERE m.id = ${row.member_id}::uuid FOR SHARE OF m, r`;
    const [facts] = await tx.$queryRaw<{ source_ok: boolean; history: string | null; queued: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM insw_preparation_member m
        JOIN insw_preparation_rollout r ON r.id = m.rollout_id
        WHERE m.id = ${row.member_id}::uuid AND m.rollout_id = ${row.rollout_id}::uuid
          AND m.proof = 'SYNTHETIC_ACCEPTED_QUEUE_ERA' AND r.mode = 'PREPARED'
          AND r.evidence = ${JSON.stringify({ exclusiveProducer: 'SYNTHETIC_NO_DIRECT_PRODUCER', membership: 'EXPLICIT_SYNTHETIC_MANIFEST', review: 'ISOLATED_TEST' })}::jsonb)
        AND (SELECT count(*) = 1 AND bool_and(s.id = ${row.source_id}
        AND s.incoming_date = ${row.business_date}::date) FROM (
          SELECT g.id, g.incoming_date FROM incoming_goods g
          JOIN companies c ON c.code = g.company_code AND c.company_type = 'SEZ'
          WHERE g.company_code = ${row.company_code} AND g.wms_id = ${row.wms_reference}
            AND g.deleted_at IS NULL LIMIT 2) s) AS source_ok,
        CASE WHEN EXISTS (SELECT 1 FROM insw_tracking_log h
          WHERE h.company_code = ${row.company_code} AND h.transaction_type = 'incoming'
          AND (h.wms_id = ${row.wms_reference} OR h.transaction_id = ${row.source_id}) AND h.insw_status = 'SUCCESS')
          THEN 'REMOTE_SUCCESS_NO_REPOST'
          WHEN EXISTS (SELECT 1 FROM insw_tracking_log h
          WHERE h.company_code = ${row.company_code} AND h.transaction_type = 'incoming'
          AND (h.wms_id = ${row.wms_reference} OR h.transaction_id = ${row.source_id}))
          THEN 'DIRECT_HISTORY_REQUIRES_REVIEW' ELSE NULL END AS history,
        EXISTS (SELECT 1 FROM insw_queue_cycle q WHERE q.company_code = ${row.company_code}
          AND q.operation = 'INCOMING'
          AND (q.wms_reference = ${row.wms_reference} OR q.wms_reference IS NULL)) AS queued`;
    return !facts.source_ok ? 'SOURCE_IDENTITY_UNCONFIRMED' : facts.history ??
      (facts.queued ? 'EXISTING_QUEUE_REQUIRES_REVIEW' : null);
  }
  async function retryQueue(principal: RecoveryPrincipal, company: number, rollout: string, member: string) {
    await authorize(principal, company, rollout);
    const token = randomUUID();
    const time = now();
    const row = await db.$transaction(async tx => {
      await tx.insw_preparation_ledger.updateMany({ where: {
        member_id: member, company_code: company, rollout_id: rollout,
        state: 'CLAIMED', lease_until: { lte: time }, attempt_count: { gte: budget },
      }, data: { state: 'REVIEW_HOLD', reason: 'BUDGET_EXHAUSTED', owner_token: null, lease_until: null, updated_at: time } });
      const rows = await tx.$queryRaw<Ledger[]>`
        UPDATE insw_preparation_ledger SET state = 'CLAIMED', reason = 'PREPARING',
          owner_token = ${token}::uuid, lease_until = ${new Date(time.getTime() + leaseMs)},
          attempt_count = attempt_count + 1, fence = fence + 1, updated_at = ${time}
        WHERE id IN (SELECT id FROM insw_preparation_ledger
          WHERE member_id = ${member}::uuid AND company_code = ${company} AND rollout_id = ${rollout}::uuid
          AND attempt_count < ${budget} AND next_eligible_at <= ${time}
          AND (state IN ('PENDING','RETRYABLE') OR (state = 'CLAIMED' AND lease_until <= ${time}))
          FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
      if (!rows.length) return null;
      const candidate = rows[0];
      const reason = await check(tx, candidate);
      if (reason) {
        await tx.insw_preparation_ledger.update({ where: { id: candidate.id }, data: {
          state: 'REVIEW_HOLD', reason, owner_token: null, lease_until: null, updated_at: time,
        } });
        return null;
      }
      return candidate;
    });
    if (!row) return { claimed: false };
    const ownership = { id: row.id, owner_token: token, fence: row.fence, state: 'CLAIMED', lease_until: { gt: now() } };
    try {
      // Heavy conversion happens outside any DB transaction. Constant revision
      // only adapts Phase B's required slot; accepted WMS ID is never versioned.
      const payload = await capture(Object.freeze({ companyCode: company, sourceId: row.source_id,
        wmsReference: row.wms_reference, businessDate: row.business_date.toISOString().slice(0, 10) }));
      const prepared = prepareIncomingHandoff({ companyCode: company, wmsReference: row.wms_reference,
        businessDate: row.business_date.toISOString().slice(0, 10), revision: 'ACCEPTED_WMS_ID',
        requestedBy: 'isolated-preparation', authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT', payload });
      await authorize(principal, company, rollout);
      await db.$transaction(async tx => {
        // Lock/fence before queue insertion. Expired owners cannot finalize.
        const locked = await tx.insw_preparation_ledger.updateMany({ where: { ...ownership, lease_until: { gt: now() } }, data: { updated_at: now() } });
        if (locked.count !== 1) throw new Error('STALE_PREPARATION_OWNER');
        const reason = await check(tx, row);
        if (reason) {
          await tx.insw_preparation_ledger.update({ where: { id: row.id }, data: {
            state: 'REVIEW_HOLD', reason, owner_token: null, lease_until: null,
          } });
          return;
        }
        const queue = await handoffIncomingInTransaction(tx, prepared);
        await tx.insw_preparation_ledger.update({ where: { id: row.id }, data: {
          state: 'QUEUE_CREATED', reason: 'QUEUE_CREATED', queue_id: queue.id,
          owner_token: null, lease_until: null, updated_at: now(),
        } });
      });
      return { claimed: true };
    } catch (error) {
      // Only explicit Prisma concurrency/connection failures are retried. Mapping,
      // validation, unknown errors and ambiguous outcomes stop for review.
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : '';
      const transient = ['P2034', 'P1001', 'P1002', 'P1017', 'P2024'].includes(code);
      const exhausted = row.attempt_count >= budget;
      await db.insw_preparation_ledger.updateMany({ where: { ...ownership, lease_until: { gt: now() } }, data: {
        state: transient && !exhausted ? 'RETRYABLE' : 'REVIEW_HOLD',
        reason: exhausted ? 'BUDGET_EXHAUSTED' : transient ? 'TRANSIENT_DATABASE' : 'PERMANENT_PREPARATION',
        next_eligible_at: new Date(now().getTime() + Math.min(60000, baseDelayMs * 2 ** (row.attempt_count - 1))),
        owner_token: null, lease_until: null, updated_at: now(),
      } });
      throw error;
    }
  }
  return { discover, retryQueue };
}
