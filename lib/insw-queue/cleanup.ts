import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveInswCompanyConfig } from '@/lib/config/insw-company-config';

// Only the private deployment phase grants access. Public configuration can veto
// a mismatch, never authorize it. NODE_ENV describes the Next build, not the DB.
export function includesINSWQueueCleanup(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['development', 'staging'].includes(env.DATABASE_PHASE ?? '')
    && (!env.NEXT_PUBLIC_ENVIRONMENT_PHASE || env.NEXT_PUBLIC_ENVIRONMENT_PHASE === env.DATABASE_PHASE);
}

export function hasKnownINSWCleanupPhase(env: NodeJS.ProcessEnv = process.env): boolean {
  return includesINSWQueueCleanup(env) || (env.DATABASE_PHASE === 'production'
    && (!env.NEXT_PUBLIC_ENVIRONMENT_PHASE || env.NEXT_PUBLIC_ENVIRONMENT_PHASE === 'production'));
}

export type INSWResetConfirmation = {
  operator: string;
  companyCode: number;
  discardTestData: boolean;
  producersStopped: boolean;
};

export class INSWCleanupBusyError extends Error {
  readonly code = 'INSW_CLEANUP_QUEUE_BUSY';
  constructor(reason = 'A concurrent INSW writer holds a lock. Stop all workers/producers, wait for active transmissions and transactions to finish, then retry.') {
    super(reason);
  }
}

export class INSWCleanupResidualError extends Error {
  readonly code = 'INSW_CLEANUP_RESIDUAL_DATA';
  constructor() {
    super('Local INSW operational records remain in the selected company scope. Local cleanup was rolled back; full cleanup did not succeed.');
  }
}

function authorize(companyCode: number, confirmation: INSWResetConfirmation) {
  if (!includesINSWQueueCleanup()) throw new Error('INSW queue cleanup requires Development/Staging');
  if (!confirmation || !confirmation.operator || confirmation.operator.length > 100
    || confirmation.companyCode !== companyCode || confirmation.discardTestData !== true
    || confirmation.producersStopped !== true) throw new Error('Explicit company test-data discard and stopped-producer confirmation required');
  if (!resolveInswCompanyConfig(companyCode).useTestMode) throw new Error('Company INSW test mode required');
}

async function guard(tx: Prisma.TransactionClient, companyCode: number, confirmation: INSWResetConfirmation) {
  authorize(companyCode, confirmation);
  // Idle web connections do not conflict. Active writers, legacy claims,
  // preparation and ownership acquisition do; never wait behind them.
  await tx.$executeRaw`LOCK TABLE insw_dispatch_gate, insw_queue_cycle,
    insw_queue_attempt, insw_admin_resolution, insw_manual_supersession, insw_preparation_rollout,
    insw_preparation_member, insw_preparation_ledger, insw_tracking_log
    IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
  // Recheck current DB authorization under row locks, including after Sandbox.
  const actors = await tx.$queryRaw<{ id: string }[]>`SELECT u.id FROM users u
    JOIN companies c ON c.code = u.company_code
    WHERE u.id = ${confirmation.operator} AND u.role = 'ADMIN'
      AND u.deleted_at IS NULL AND u.is_active = true
      AND c.code = ${companyCode} AND c.status = 'ACTIVE' AND c.deleted_at IS NULL
    FOR SHARE OF u, c NOWAIT`;
  if (actors.length !== 1) throw new INSWCleanupBusyError('Current Admin/company authorization changed. Sign in to the selected active company again.');
  const gates = await tx.$queryRaw<{ owner_token: string | null; lease_until: Date | null;
    busy_attempt_id: string | null; process_identity: unknown; expired: boolean;
    last_started_at: Date | null; prior_interval_ms: number | null; recovery_barrier_at: Date | null }[]>`
    SELECT *, lease_until IS NOT NULL AND lease_until <= clock_timestamp() AS expired
    FROM insw_dispatch_gate WHERE id = 1 FOR UPDATE NOWAIT`;
  const gate = gates[0];
  if (gates.length !== 1) throw new INSWCleanupBusyError('Global INSW gate is missing. Restore gate configuration before retrying.');
  if (gate.busy_attempt_id !== null) throw new INSWCleanupBusyError('The global gate has a busy attempt. Stop the sender and resolve its in-flight transmission before cleanup.');
  if ((gate.last_started_at === null) !== (gate.prior_interval_ms === null)
    || gate.prior_interval_ms !== null && gate.prior_interval_ms < 3600
    || gate.last_started_at === null && gate.recovery_barrier_at !== null) {
    throw new INSWCleanupBusyError('Global start-spacing evidence is inconsistent. Review gate timing before cleanup.');
  }
  if (gate.owner_token !== null) {
    if (!gate.expired) throw new INSWCleanupBusyError('Global worker ownership lease is active or unknown. Stop all workers and wait for the lease to expire.');
    const identity = gate.process_identity as Record<string, unknown> | null;
    if (!identity || typeof identity !== 'object'
      || !['host', 'machine', 'boot', 'start', 'pidNamespace'].every(key => typeof identity[key] === 'string' && String(identity[key]).trim().length > 0)
      || !Number.isSafeInteger(identity.pid) || Number(identity.pid) <= 0
      || !Number.isSafeInteger(identity.uid) || Number(identity.uid) < 0) {
      throw new INSWCleanupBusyError('Stored worker identity is missing or invalid. Review the unknown owner using specialist recovery before retrying.');
    }
  } else if (gate.lease_until !== null || gate.process_identity !== null) {
    throw new INSWCleanupBusyError('Global ownership evidence is inconsistent. Review the unknown owner before retrying.');
  }
  // Status and unfinished history do not prove a live sender. The gate busy
  // pointer/active ownership and writer locks above fence dispatch. Preparation
  // can work outside that gate, so retain only its unexpired lease fence.
  const preparation = await tx.insw_preparation_ledger.count({
    where: { lease_until: { gt: new Date() } },
  });
  if (preparation) throw new INSWCleanupBusyError('An INSW preparation lease is active. Wait for active preparation to finish before cleanup.');
  // Detect contradictory tenant references before external destruction, too.
  const [references] = await tx.$queryRaw<{ conflict: boolean }[]>`SELECT
    EXISTS (SELECT 1 FROM insw_tracking_log l JOIN insw_queue_attempt a ON a.id = l.queue_attempt_id
      JOIN insw_queue_cycle q ON q.id = a.queue_id
      WHERE l.company_code IS DISTINCT FROM q.company_code AND (l.company_code = ${companyCode} OR q.company_code = ${companyCode}))
    OR EXISTS (SELECT 1 FROM insw_preparation_ledger l JOIN insw_queue_cycle q ON q.id = l.queue_id
      WHERE l.company_code <> q.company_code AND (l.company_code = ${companyCode} OR q.company_code = ${companyCode}))
    OR EXISTS (SELECT 1 FROM insw_manual_supersession r
      JOIN insw_queue_cycle p ON p.id = r.parent_queue_id
      JOIN insw_queue_cycle s ON s.id = r.successor_queue_id
      JOIN insw_tracking_log l ON l.id = r.source_log_id
      WHERE (p.company_code = ${companyCode} OR s.company_code = ${companyCode} OR l.company_code = ${companyCode})
        AND (p.company_code <> s.company_code OR p.company_code IS DISTINCT FROM l.company_code
          OR p.operation <> s.operation OR p.identity_key <> s.identity_key))
    OR EXISTS (SELECT 1 FROM insw_queue_cycle q JOIN insw_tracking_log l ON l.id = q.source_log_id
      WHERE q.company_code IS DISTINCT FROM l.company_code
        AND (q.company_code = ${companyCode} OR l.company_code = ${companyCode})) AS conflict`;
  if (!references || references.conflict) throw new INSWCleanupBusyError('Cross-company INSW child references conflict. Repair tenant associations before cleanup; no deletion was performed.');
  return gate;
}

async function coordinated<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await db.$transaction(work);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.meta?.code === '55P03') {
      throw new INSWCleanupBusyError();
    }
    throw error;
  }
}

export async function assertINSWCleanupIdle(companyCode: number, confirmation: INSWResetConfirmation, db: PrismaClient = prisma) {
  await coordinated(db, tx => guard(tx, companyCode, confirmation));
}

export async function deleteINSWOperationalData(companyCode: number, confirmation: INSWResetConfirmation, db: PrismaClient = prisma) {
  authorize(companyCode, confirmation);
  return coordinated(db, async tx => {
    const gate = await guard(tx, companyCode, confirmation);
    if (gate.owner_token !== null) {
      // This is an attested nonproduction discard, not automatic proof of remote
      // process death. Audit and release roll back with every deletion below.
      await tx.insw_worker_recovery.create({ data: {
        old_owner_token: gate.owner_token, operator: confirmation.operator,
        evidence: `Nonproduction test-data discard company=${companyCode}; Admin attests all producers stopped and no in-flight transmissions; expired gate lease, no busy sender or active preparation lease`,
        process_identity: gate.process_identity as Prisma.InputJsonValue,
      } });
      await tx.$executeRaw`UPDATE insw_dispatch_gate SET owner_token = NULL, lease_until = NULL,
        process_identity = NULL,
        recovery_barrier_at = CASE WHEN last_started_at IS NOT NULL
          THEN GREATEST(recovery_barrier_at, clock_timestamp()) ELSE recovery_barrier_at END
        WHERE id = 1`;
    }
    const scope = { company_code: companyCode };
    const queueScope = { queue: scope };
    // Transaction-local context is consumed only by the narrow DELETE trigger;
    // normal supersession updates and queue immutability remain unchanged.
    await tx.$queryRaw`SELECT set_config('imaps.cleanup_company', ${String(companyCode)}, true),
      set_config('imaps.cleanup_operator', ${confirmation.operator}, true)`;
    const supersessions = await tx.$executeRaw`DELETE FROM insw_manual_supersession r
      USING insw_queue_cycle p, insw_queue_cycle s, insw_tracking_log l
      WHERE p.id = r.parent_queue_id AND s.id = r.successor_queue_id AND l.id = r.source_log_id
        AND p.company_code = ${companyCode} AND s.company_code = ${companyCode} AND l.company_code = ${companyCode}
        AND p.operation = s.operation AND p.identity_key = s.identity_key`;
    const [remainingLinks] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count
      FROM insw_manual_supersession r
      JOIN insw_queue_cycle q ON q.id = r.parent_queue_id WHERE q.company_code = ${companyCode}`;
    if (!remainingLinks || Number(remainingLinks.count) !== 0) throw new INSWCleanupResidualError();
    const logs = await tx.insw_tracking_log.deleteMany({ where: scope });
    const resolutions = await tx.insw_admin_resolution.deleteMany({ where: queueScope });
    const ledger = await tx.insw_preparation_ledger.deleteMany({ where: scope });
    const members = await tx.insw_preparation_member.deleteMany({ where: scope });
    const attempts = await tx.insw_queue_attempt.deleteMany({ where: queueScope });
    // Rollout is durable routing configuration, retained with its mode unchanged.
    // Verify children before deleting parents used by the relation scope joins.
    const remainingChildren = await Promise.all([
      tx.insw_tracking_log.count({ where: scope }),
      tx.insw_admin_resolution.count({ where: queueScope }),
      tx.insw_preparation_ledger.count({ where: scope }),
      tx.insw_preparation_member.count({ where: scope }),
      tx.insw_queue_attempt.count({ where: queueScope }),
    ]);
    if (remainingChildren.some(count => count !== 0)) throw new INSWCleanupResidualError();
    const queues = await tx.insw_queue_cycle.deleteMany({ where: scope });
    if (await tx.insw_queue_cycle.count({ where: scope })) throw new INSWCleanupResidualError();
    return { supersessions: Number(supersessions), trackingLogs: logs.count, resolutions: resolutions.count, preparationLedgers: ledger.count,
      preparationMembers: members.count, attempts: attempts.count, queues: queues.count };
  });
}
