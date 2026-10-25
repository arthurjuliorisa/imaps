import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { boundedText, integer } from '../insw-queue/contracts';
import { readPolicy } from '../insw-queue/policy.repository';
import { reserveTail } from '../insw-queue/queue.repository';
import { Outcome } from './transport';
import { classifiedRetryDisposition } from './retry';
import { ProcessIdentity, processIdentity, verifyReaped } from './process-identity';

type Tx = Prisma.TransactionClient;
export async function owned(tx: Tx, token: string) {
  const rows = await tx.$queryRaw<{ last_started_at: Date | null; prior_interval_ms: number | null; busy_attempt_id: string | null }[]>`
    SELECT last_started_at, prior_interval_ms, busy_attempt_id FROM insw_dispatch_gate
    WHERE id = 1 AND owner_token = ${token}::uuid FOR UPDATE`;
  if (rows.length !== 1) throw new Error('STREAM_OWNER_LOST');
  if ((rows[0].last_started_at === null) !== (rows[0].prior_interval_ms === null)) throw new Error('CORRUPT_ADMISSION_EVIDENCE');
  return rows[0];
}
export async function acquireOperationalOwnership(db: PrismaClient): Promise<string> {
  const token = randomUUID();
  const identity = JSON.stringify(processIdentity());
  return db.$transaction(async tx => {
    await readPolicy(tx);
    const rows = await tx.$queryRaw<{ owner_token: string }[]>`
      UPDATE insw_dispatch_gate SET owner_token = ${token}::uuid, lease_until = clock_timestamp(),
        process_identity = ${identity}::jsonb
      WHERE id = 1 AND owner_token IS NULL AND lease_until IS NULL AND busy_attempt_id IS NULL AND process_identity IS NULL
        AND ((last_started_at IS NULL AND prior_interval_ms IS NULL AND recovery_barrier_at IS NULL) OR
             (last_started_at IS NOT NULL AND prior_interval_ms IS NOT NULL))
      RETURNING owner_token`;
    if (rows.length !== 1) throw new Error('INSW_STREAM_BLOCKED_MAINTENANCE_REQUIRED');
    return token;
  });
}

// Only a local privileged CLI invokes this. Acknowledgement covers supervisor
// shutdown/no children/no overlapping deployments; /proc independently verifies death.
export async function recoverOperationalOwnership(db: PrismaClient, input: {
  expectedToken: string; operator: string; evidence: string; shutdownAcknowledged: boolean;
}) {
  boundedText(input.operator, 'operator', 100); boundedText(input.evidence, 'shutdown evidence', 500);
  if (!input.shutdownAcknowledged) throw new Error('SHUTDOWN_ACKNOWLEDGEMENT_REQUIRED');
  return db.$transaction(async tx => {
    const gate = await owned(tx, input.expectedToken);
    const [row] = await tx.$queryRaw<{ process_identity: ProcessIdentity | null }[]>`
      SELECT process_identity FROM insw_dispatch_gate WHERE id = 1`;
    if (!row.process_identity) throw new Error('LEGACY_OWNER_REQUIRES_EXTERNAL_FENCING_REVIEW');
    verifyReaped(row.process_identity);
    // Resolve exactly the gate's single attempt by primary key; never scan a
    // backlog for stale owners or infer ownership from expired job leases.
    const attempt = gate.busy_attempt_id ? await tx.insw_queue_attempt.findUnique({
      where: { id: gate.busy_attempt_id }, include: { queue: true },
    }) : null;
    if (gate.busy_attempt_id && (!attempt || attempt.owner_token !== input.expectedToken
      || !(attempt.queue.owner_token === input.expectedToken && ['CLAIMED', 'REMOTE_SUCCEEDED'].includes(attempt.queue.status)
        || attempt.queue.status === 'HELD' && attempt.queue.owner_token === null
          && attempt.queue.delivery_state === 'KNOWN_SUCCESS' && attempt.queue.hold_reason === 'LOCAL_FINALIZATION_REQUIRED')))
      throw new Error('INCONSISTENT_BUSY_ATTEMPT');
    const claim = attempt?.queue;
    if (claim) {
      await tx.insw_queue_cycle.update({ where: { id: claim.id }, data: { status: 'HELD', owner_token: null,
        lease_until: null, hold_reason: claim.delivery_state === 'KNOWN_SUCCESS' ? 'LOCAL_FINALIZATION_REQUIRED'
          : claim.delivery_state === 'NOT_STARTED' ? 'PRE_SEND_LEASE_EXPIRED' : 'DELIVERY_UNKNOWN' } });
      await tx.insw_queue_attempt.updateMany({ where: { id: gate.busy_attempt_id!, completed_at: null }, data: { completed_at: new Date() } });
    }
    await tx.insw_worker_recovery.create({ data: { old_owner_token: input.expectedToken, operator: input.operator,
      evidence: input.evidence, process_identity: row.process_identity as unknown as Prisma.InputJsonValue } });
    // An interrupted start may have occurred after its first admission timestamp.
    // Add a conservative barrier without erasing prior start/interval evidence.
    await tx.$executeRaw`UPDATE insw_dispatch_gate SET owner_token = NULL, lease_until = NULL,
      busy_attempt_id = NULL, process_identity = NULL,
      recovery_barrier_at = CASE WHEN ${gate.busy_attempt_id !== null} THEN clock_timestamp() ELSE recovery_barrier_at END
      WHERE id = 1 AND owner_token = ${input.expectedToken}::uuid`;
    return { held: claim ? 1 : 0 };
  });
}

export async function admitNext(db: PrismaClient, token: string, minimumIntervalMs = 1) {
  integer(minimumIntervalMs, 'minimum interval', 1);
  return db.$transaction(async tx => {
    const gate = await owned(tx, token);
    if (gate.busy_attempt_id) throw new Error('STREAM_BUSY');
    // Serialize policy changes with this short admission transaction.
    await tx.$queryRaw`SELECT id FROM insw_transmission_policy WHERE id = 1 FOR SHARE`;
    const policy = await readPolicy(tx);
    const interval = Math.max(minimumIntervalMs, policy.min_processing_interval_ms);
    const [clock] = await tx.$queryRaw<{ wait_ms: number }[]>`SELECT
      CASE WHEN last_started_at IS NULL THEN 0 ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM
        (GREATEST(last_started_at, recovery_barrier_at) + GREATEST(prior_interval_ms, ${interval}) * interval '1 millisecond'
          - clock_timestamp())) * 1000))::float8 END AS wait_ms
      FROM insw_dispatch_gate WHERE id = 1`;
    if (clock.wait_ms > 0) return { waitMs: Math.min(clock.wait_ms, 1000), job: null };
    // Filter in the bounded selector, before any job/attempt/gate mutation.
    // Invalid rows stay untouched and cannot hide valid work later in the tail.
    // All six isolated domains verify committed source association in SQL.
    const candidates = await tx.$queryRaw<{ id: string }[]>`SELECT q.id FROM insw_queue_cycle q
      WHERE q.status = 'READY' AND q.next_eligible_at <= clock_timestamp()
        AND q.company_code IN (1370, 1380)
        AND q.operation IN ('INCOMING', 'OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT', 'STOCK_OPNAME')
        AND EXISTS (SELECT 1 FROM companies eligible_company
          WHERE eligible_company.code = q.company_code AND eligible_company.company_type = 'SEZ')
        AND (
            q.intent = 'SOURCE_COMMIT' AND q.source_log_id IS NULL
            OR q.intent = 'MANUAL_RESUBMIT' AND EXISTS (
              SELECT 1 FROM insw_tracking_log l JOIN insw_queue_attempt a ON a.id = l.queue_attempt_id
              JOIN insw_queue_cycle p ON p.id = a.queue_id
              WHERE l.id = q.source_log_id AND l.transaction_type = lower(q.operation::text) AND l.insw_status = 'FAILED'
                AND l.company_code = q.company_code AND p.identity_key = q.identity_key AND p.cycle = q.cycle - 1
                AND p.status = 'FAILED' AND p.delivery_state = 'KNOWN_FAILURE'
                AND p.retry_index >= p.max_auto_retry_snapshot AND p.owner_token IS NULL AND p.lease_until IS NULL
                AND p.payload_sha256 = q.payload_sha256 AND p.frozen_payload = q.frozen_payload
                AND l.metadata#>>'{manual_resend,queue_id}' = q.id::text
            )
          )
        AND (q.operation <> 'INCOMING' OR (
          q.source_revision = 'ACCEPTED_WMS_ID'
          AND q.identity_key = concat('["insw-v1",', q.company_code, ',"INCOMING","WMS_REFERENCE",',
            to_json(q.wms_reference)::text, ',"ACCEPTED_WMS_ID",', to_json(q.business_date)::text, ']')
          AND (SELECT count(*) = 1 AND bool_and(to_char(s.incoming_date, 'YYYY-MM-DD') = q.business_date)
            FROM (SELECT g.incoming_date FROM incoming_goods g JOIN companies c ON c.code = g.company_code
              WHERE g.company_code = q.company_code AND c.company_type = 'SEZ'
                AND g.wms_id = q.wms_reference AND g.deleted_at IS NULL LIMIT 2) s)
        ))
        AND (q.operation <> 'OUTGOING' OR (
          q.source_revision = 'ACCEPTED_WMS_ID'
          AND q.identity_key = concat('["insw-v1",', q.company_code, ',"OUTGOING","WMS_REFERENCE",',
            to_json(q.wms_reference)::text, ',"ACCEPTED_WMS_ID",', to_json(q.business_date)::text, ']')
          AND (SELECT count(*) = 1 AND bool_and(to_char(s.outgoing_date, 'YYYY-MM-DD') = q.business_date AND s.scrap_transaction_id IS NULL)
            FROM (SELECT g.outgoing_date, g.scrap_transaction_id FROM outgoing_goods g JOIN companies c ON c.code = g.company_code
              WHERE g.company_code = q.company_code AND c.company_type = 'SEZ'
                AND g.wms_id = q.wms_reference AND g.deleted_at IS NULL LIMIT 2) s)
        ))
        AND (q.operation <> 'MATERIAL_USAGE' OR (
          q.wms_reference = btrim(q.wms_reference) AND length(q.wms_reference) BETWEEN 1 AND 100
          AND q.wms_reference !~ '[[:cntrl:]]' AND
          q.source_revision = 'ACCEPTED_WMS_ID'
          AND q.identity_key = concat('["insw-v1",', q.company_code, ',"MATERIAL_USAGE","WMS_REFERENCE",',
            to_json(q.wms_reference)::text, ',"ACCEPTED_WMS_ID",', to_json(q.business_date)::text, ']')
          AND jsonb_typeof(q.frozen_payload->'data') = 'array'
          AND CASE WHEN jsonb_typeof(q.frozen_payload->'data') = 'array'
            THEN jsonb_array_length(q.frozen_payload->'data') = 1 ELSE false END
          AND CASE WHEN jsonb_typeof(q.frozen_payload#>'{data,0,dokumenKegiatan}') = 'array'
            THEN jsonb_array_length(q.frozen_payload#>'{data,0,dokumenKegiatan}') = 1 ELSE false END
          AND q.frozen_payload#>>'{data,0,dokumenKegiatan,0,nomorDokKegiatan}' = q.wms_reference
          AND CASE WHEN jsonb_typeof(q.frozen_payload#>'{data,0,dokumenKegiatan,0,barangTransaksi}') = 'array'
            THEN jsonb_array_length(q.frozen_payload#>'{data,0,dokumenKegiatan,0,barangTransaksi}') > 0 ELSE false END
          AND (SELECT count(*) = 1 AND bool_and(to_char(s.transaction_date, 'YYYY-MM-DD') = q.business_date
              AND q.frozen_payload#>>'{data,0,kdKegiatan}' = CASE WHEN s.reversal = 'Y' THEN '30' ELSE '31' END)
            FROM (SELECT g.transaction_date, g.reversal FROM material_usages g JOIN companies c ON c.code = g.company_code
              WHERE g.company_code = q.company_code AND c.company_type = 'SEZ'
                AND g.wms_id = q.wms_reference AND g.deleted_at IS NULL LIMIT 2) s)
        ))
        AND (q.operation <> 'PRODUCTION_OUTPUT' OR (
          q.wms_reference = btrim(q.wms_reference) AND length(q.wms_reference) BETWEEN 1 AND 100
          AND q.wms_reference !~ '[[:cntrl:]]' AND
          q.source_revision = 'ACCEPTED_WMS_ID'
          AND q.identity_key = concat('["insw-v1",', q.company_code, ',"PRODUCTION_OUTPUT","WMS_REFERENCE",',
            to_json(q.wms_reference)::text, ',"ACCEPTED_WMS_ID",', to_json(q.business_date)::text, ']')
          AND jsonb_typeof(q.frozen_payload->'data') = 'array'
          AND CASE WHEN jsonb_typeof(q.frozen_payload->'data') = 'array'
            THEN jsonb_array_length(q.frozen_payload->'data') = 1 ELSE false END
          AND CASE WHEN jsonb_typeof(q.frozen_payload#>'{data,0,dokumenKegiatan}') = 'array'
            THEN jsonb_array_length(q.frozen_payload#>'{data,0,dokumenKegiatan}') = 1 ELSE false END
          AND q.frozen_payload#>>'{data,0,dokumenKegiatan,0,nomorDokKegiatan}' = q.wms_reference
          AND CASE WHEN jsonb_typeof(q.frozen_payload#>'{data,0,dokumenKegiatan,0,barangTransaksi}') = 'array'
            THEN jsonb_array_length(q.frozen_payload#>'{data,0,dokumenKegiatan,0,barangTransaksi}') > 0 ELSE false END
          AND (SELECT count(*) = 1 AND bool_and(to_char(s.transaction_date, 'YYYY-MM-DD') = q.business_date
              AND q.frozen_payload#>>'{data,0,kdKegiatan}' = CASE WHEN s.reversal = 'Y' THEN '31' ELSE '30' END)
            FROM (SELECT g.transaction_date, g.reversal FROM production_outputs g JOIN companies c ON c.code = g.company_code
              WHERE g.company_code = q.company_code AND c.company_type = 'SEZ'
                AND g.wms_id = q.wms_reference AND g.deleted_at IS NULL LIMIT 2) s)
        ))
        AND (q.operation <> 'ADJUSTMENT' OR (
          q.wms_reference = btrim(q.wms_reference) AND length(q.wms_reference) BETWEEN 1 AND 100
          AND q.wms_reference !~ '[[:cntrl:]]'
          AND CASE WHEN jsonb_typeof(q.frozen_payload->'data') = 'array'
            THEN jsonb_array_length(q.frozen_payload->'data') = 1 ELSE false END
          AND CASE WHEN jsonb_typeof(q.frozen_payload#>'{data,0,dokumenKegiatan}') = 'array'
            THEN jsonb_array_length(q.frozen_payload#>'{data,0,dokumenKegiatan}') = 1 ELSE false END
          AND CASE WHEN jsonb_typeof(q.frozen_payload#>'{data,0,dokumenKegiatan,0,barangTransaksi}') = 'array'
            THEN jsonb_array_length(q.frozen_payload#>'{data,0,dokumenKegiatan,0,barangTransaksi}') > 0 ELSE false END
          AND q.frozen_payload#>>'{data,0,kdKegiatan}' = '33'
          AND q.frozen_payload#>>'{data,0,dokumenKegiatan,0,nomorDokKegiatan}' = q.wms_reference
          AND q.frozen_payload#>>'{data,0,dokumenKegiatan,0,tanggalKegiatan}' = concat(substring(q.business_date, 9, 2), '-', substring(q.business_date, 6, 2), '-', substring(q.business_date, 1, 4))
          AND q.frozen_payload#>>'{data,0,dokumenKegiatan,0,namaEntitas}' = q.company_code::text
          AND EXISTS (SELECT 1 FROM adjustments g JOIN companies c ON c.code = g.company_code
            WHERE g.company_code = q.company_code AND c.company_type = 'SEZ' AND g.wms_id = q.wms_reference
              AND g.id BETWEEN 1 AND 2147483647 AND g.deleted_at IS NULL
              AND to_char(g.transaction_date, 'YYYY-MM-DD') = q.business_date
              AND q.source_revision = 'COMMITTED_SOURCE'
              AND q.identity_key = concat('["insw-v1",', q.company_code, ',"ADJUSTMENT","SOURCE_HEADER",',
                to_json(g.id::text)::text, ',', to_json(q.source_revision)::text, ',', to_json(q.business_date)::text, ']'))
        ))
        AND (q.operation <> 'STOCK_OPNAME' OR (
          q.wms_reference = btrim(q.wms_reference) AND length(q.wms_reference) BETWEEN 1 AND 100
          AND q.wms_reference !~ '[[:cntrl:]]'
          AND CASE WHEN jsonb_typeof(q.frozen_payload->'data') = 'array'
            THEN jsonb_array_length(q.frozen_payload->'data') = 1 ELSE false END
          AND CASE WHEN jsonb_typeof(q.frozen_payload#>'{data,0,dokumenKegiatan}') = 'array'
            THEN jsonb_array_length(q.frozen_payload#>'{data,0,dokumenKegiatan}') = 1 ELSE false END
          AND CASE WHEN jsonb_typeof(q.frozen_payload#>'{data,0,dokumenKegiatan,0,barangTransaksi}') = 'array'
            THEN jsonb_array_length(q.frozen_payload#>'{data,0,dokumenKegiatan,0,barangTransaksi}') > 0 ELSE false END
          AND q.frozen_payload#>>'{data,0,kdKegiatan}' = '32'
          AND q.frozen_payload#>>'{data,0,dokumenKegiatan,0,nomorDokKegiatan}' = q.wms_reference
          AND q.frozen_payload#>>'{data,0,dokumenKegiatan,0,tanggalKegiatan}' = concat(substring(q.business_date, 9, 2), '-', substring(q.business_date, 6, 2), '-', substring(q.business_date, 1, 4))
          AND q.frozen_payload#>>'{data,0,dokumenKegiatan,0,namaEntitas}' = q.company_code::text
          AND EXISTS (SELECT 1 FROM wms_stock_opnames g JOIN companies c ON c.code = g.company_code
            WHERE g.company_code = q.company_code AND c.company_type = 'SEZ' AND g.wms_id = q.wms_reference
              AND g.id BETWEEN 1 AND 2147483647 AND g.status = 'CONFIRMED' AND g.confirmed_at IS NOT NULL
              AND to_char(g.document_date, 'YYYY-MM-DD') = q.business_date
              AND q.source_revision = concat('CONFIRMED:', to_char(g.confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
              AND q.identity_key = concat('["insw-v1",', q.company_code, ',"STOCK_OPNAME","SOURCE_HEADER",',
                to_json(g.id::text)::text, ',', to_json(q.source_revision)::text, ',', to_json(q.business_date)::text, ']'))
        ))
      ORDER BY q.tail_key, q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1`;
    if (!candidates.length) return { waitMs: 0, job: null };
    const job = await tx.insw_queue_cycle.update({ where: { id: candidates[0].id }, data: {
      status: 'CLAIMED', owner_token: token, lease_until: new Date('9999-01-01'), claimed_at: new Date(),
      last_attempt_at: new Date(), delivery_state: 'POSSIBLY_STARTED',
    } });
    const attempt = await tx.insw_queue_attempt.create({ data: { queue_id: job.id, owner_token: token,
      retry_index: job.retry_index, delivery_state: 'POSSIBLY_STARTED' } });
    await tx.$executeRaw`UPDATE insw_dispatch_gate SET busy_attempt_id = ${attempt.id}::uuid,
      last_started_at = clock_timestamp(), recovery_barrier_at = NULL, prior_interval_ms = ${interval}
      WHERE id = 1 AND owner_token = ${token}::uuid`;
    return { waitMs: 0, job: { ...job, attemptId: attempt.id, admissionPolicyVersion: policy.version } };
  });
}
export type AdmittedJob = NonNullable<Awaited<ReturnType<typeof admitNext>>['job']>;

// Called immediately after starting the primitive. The DB timestamp is an upper
// bound on actual invocation, so the next start cannot be too early. If it fails,
// the worker drains the invocation and exits retaining busy ownership.
export async function recordActualStart(db: PrismaClient, token: string, job: AdmittedJob) {
  await db.$transaction(async tx => {
    const gate = await owned(tx, token);
    if (gate.busy_attempt_id !== job.attemptId) throw new Error('ATTEMPT_MISMATCH');
    await tx.$executeRaw`UPDATE insw_dispatch_gate SET last_started_at = clock_timestamp() WHERE id = 1`;
    await tx.$executeRaw`UPDATE insw_queue_attempt SET started_at = clock_timestamp()
      WHERE id = ${job.attemptId}::uuid AND owner_token = ${token}::uuid`;
  });
}
export async function persistOutcome(db: PrismaClient, token: string, job: AdmittedJob, outcome: Outcome, locallyEndedAt = Date.now()) {
  return db.$transaction(async tx => {
    const gate = await owned(tx, token);
    if (gate.busy_attempt_id !== job.attemptId) throw new Error('ATTEMPT_MISMATCH');
    const disposition = classifiedRetryDisposition({ classification: outcome.classification, delivery: outcome.delivery,
      retryIndex: job.retry_index, maxAutoRetrySnapshot: Math.min(10, job.max_auto_retry_snapshot),
      clientApprovedAmbiguousRetry: true, exclusiveStreamProven: true, priorInvocationEnded: true, outcomeDurablyRecorded: true });
    // The decision and evidence commit together. No raw body/headers/errors stored.
    const success = outcome.delivery === 'KNOWN_SUCCESS';
    const retry = disposition === 'RETRY_TO_TAIL';
    const failure = !success && disposition === 'STOP';
    const changed = await tx.insw_queue_cycle.updateMany({ where: { id: job.id, owner_token: token, status: 'CLAIMED' }, data: {
      status: retry ? 'READY' : failure ? 'FAILED' : 'HELD',
      delivery_state: retry ? 'NOT_STARTED' : success ? 'KNOWN_SUCCESS' : failure ? 'KNOWN_FAILURE' : 'POSSIBLY_STARTED',
      owner_token: null, lease_until: null, completed_at: failure ? new Date() : null,
      hold_reason: success ? 'LOCAL_FINALIZATION_REQUIRED' : retry || failure ? null : 'DELIVERY_UNKNOWN',
      error_category: outcome.classification.kind, error_code: outcome.classification.reasonCode,
      error_message: outcome.classification.reasonCode,
      ...(retry ? { retry_index: job.retry_index + 1, tail_key: await reserveTail(tx), next_eligible_at: new Date() } : {}),
    } });
    if (changed.count !== 1) throw new Error('JOB_OWNER_LOST');
    const attempt = await tx.insw_queue_attempt.updateMany({ where: { id: job.attemptId, owner_token: token, completed_at: null },
      data: { delivery_state: success ? 'KNOWN_SUCCESS' : outcome.delivery, completed_at: new Date(locallyEndedAt) } });
    if (attempt.count !== 1) throw new Error('ATTEMPT_OWNER_LOST');
    await tx.insw_tracking_log.create({ data: { queue_attempt_id: job.attemptId, transaction_type: 'synthetic',
      company_code: job.company_code, retry_count: job.retry_index,
      insw_status: success ? 'SUCCESS' : failure ? 'FAILED' : 'PENDING',
      sent_at: outcome.requestInvokedAt === null ? null : new Date(outcome.requestInvokedAt),
      metadata: { payload_sha256: job.payload_sha256, policyVersion: job.admissionPolicyVersion, phase: outcome.phase, delivery: outcome.delivery,
        httpCode: outcome.httpCode, businessCode: outcome.businessCode, reasonCode: outcome.classification.reasonCode,
        invokedAt: outcome.requestInvokedAt, boundedOutcomeEndedAt: outcome.endedAt, locallyDrainedAt: locallyEndedAt },
    } });
    await tx.$executeRaw`UPDATE insw_dispatch_gate SET busy_attempt_id = NULL WHERE id = 1 AND owner_token = ${token}::uuid`;
  });
}

// Synthetic local repair only. A known success never returns to READY.
export async function finalizeSyntheticSuccess(db: PrismaClient, token: string, id: string) {
  await db.$transaction(async tx => {
    await owned(tx, token);
    const result = await tx.insw_queue_cycle.updateMany({ where: { id, status: 'HELD', delivery_state: 'KNOWN_SUCCESS',
      hold_reason: 'LOCAL_FINALIZATION_REQUIRED' }, data: { status: 'SUCCEEDED', hold_reason: null, completed_at: new Date() } });
    if (result.count !== 1) throw new Error('NOT_LOCAL_FINALIZATION_HOLD');
  });
}
