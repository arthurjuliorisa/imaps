import { verifyCountSource } from './adjustment-stock-opname-source';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { canonicalIdentity } from '../insw-queue/contracts';
import { assertIncomingEnvelopeBudget, MAX_INCOMING_ENVELOPE_BYTES, MAX_MATERIAL_USAGE_ENVELOPE_BYTES } from '../insw-queue/incoming-handoff';
import { reserveTail } from '../insw-queue/queue.repository';
import { classifyResponse, singleFrozenDocument } from './classification';
import { owned, type AdmittedJob } from './operational.repository';
import { classifiedRetryDisposition } from './retry';
import { verifiedPayload } from './safety';
import { MAX_RESPONSE_BYTES, type Outcome } from './transport';

/** Inactive real-schema Incoming pilot. No singleton, converter, coordinator,
 * sender, discovery or production caller. Bind source identity BEFORE HTTP.
 * The isolated loop alone establishes prior-invocation drain before finalizing.
 */
export async function prepareIsolatedIncomingFinalizer(db: PrismaClient, token: string, admitted: AdmittedJob,
  config: { endpointUrl: string }) {
  return prepareIsolatedGoodsFinalizer(db, token, admitted, config, 'INCOMING');
}

export async function prepareIsolatedOutgoingFinalizer(db: PrismaClient, token: string, admitted: AdmittedJob,
  config: { endpointUrl: string }) {
  return prepareIsolatedGoodsFinalizer(db, token, admitted, config, 'OUTGOING');
}

export async function prepareIsolatedMaterialUsageFinalizer(db: PrismaClient, token: string, admitted: AdmittedJob,
  config: { endpointUrl: string }) {
  return prepareIsolatedGoodsFinalizer(db, token, admitted, config, 'MATERIAL_USAGE');
}

export async function prepareIsolatedProductionOutputFinalizer(db: PrismaClient, token: string, admitted: AdmittedJob,
  config: { endpointUrl: string }) {
  return prepareIsolatedGoodsFinalizer(db, token, admitted, config, 'PRODUCTION_OUTPUT');
}

export async function prepareIsolatedCountFinalizer(db: PrismaClient, token: string, admitted: AdmittedJob,
  config: { endpointUrl: string }) {
  if (admitted.operation !== 'ADJUSTMENT' && admitted.operation !== 'STOCK_OPNAME') throw new Error('INVALID_COUNT_OPERATION');
  return prepareIsolatedGoodsFinalizer(db, token, admitted, config, admitted.operation);
}

async function prepareIsolatedGoodsFinalizer(db: PrismaClient, token: string, admitted: AdmittedJob,
  config: { endpointUrl: string }, operation: 'INCOMING' | 'OUTGOING' | 'MATERIAL_USAGE' | 'PRODUCTION_OUTPUT' | 'ADJUSTMENT' | 'STOCK_OPNAME') {
  const transactionType = { INCOMING: 'incoming', OUTGOING: 'outgoing',
    MATERIAL_USAGE: 'material_usage', PRODUCTION_OUTPUT: 'production_output', ADJUSTMENT: 'adjustment', STOCK_OPNAME: 'stock_opname' }[operation];
  const endpoint = new URL(config.endpointUrl);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port) throw new Error('LOOPBACK_HTTP_REQUIRED');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || !['http:', 'https:'].includes(endpoint.protocol)) throw new Error('INVALID_ENDPOINT_EVIDENCE');
  const endpointUrl = endpoint.toString();
  if (process.env.NODE_ENV === 'production') throw new Error('ISOLATED_TEST_ONLY');
  const [runtime] = await db.$queryRaw<{ name: string; host: string | null }[]>`
    SELECT current_database() AS name, host(inet_server_addr()) AS host`;
  if (!/^[a-z0-9_]+_phase_c2b_test$/.test(runtime.name) || !['127.0.0.1', '::1'].includes(runtime.host ?? '')) {
    throw new Error('ISOLATED_TEST_ONLY');
  }
  if (![1370, 1380].includes(admitted.company_code)) throw new Error('SEZ_COMPANY_REQUIRED');
  assertIncomingEnvelopeBudget(admitted.frozen_payload, operation === 'MATERIAL_USAGE' ? MAX_MATERIAL_USAGE_ENVELOPE_BYTES : MAX_INCOMING_ENVELOPE_BYTES);
  const body = verifiedPayload(admitted.frozen_payload, admitted.payload_sha256);
  const requestBytes = Buffer.byteLength(body);
  const payload = JSON.parse(body);
  const reference = admitted.wms_reference;
  const activityCode = payload.data?.[0]?.kdKegiatan;
  const countDomain = operation === 'ADJUSTMENT' || operation === 'STOCK_OPNAME';
  const validActivity = countDomain ? activityCode === (operation === 'ADJUSTMENT' ? '33' : '32') : operation === 'INCOMING' ? activityCode === '30'
    : operation === 'OUTGOING' ? activityCode === '31' : ['30', '31'].includes(activityCode);
  if (![1370, 1380].includes(admitted.company_code)) throw new Error('SEZ_COMPANY_REQUIRED');
  if (countDomain && (admitted.intent !== 'SOURCE_COMMIT' || admitted.source_log_id !== null)) throw new Error('UNSUPPORTED_SOURCE_INTENT');
  if (countDomain && (payload.data?.[0]?.dokumenKegiatan?.[0]?.tanggalKegiatan !== admitted.business_date.split('-').reverse().join('-')
    || payload.data?.[0]?.dokumenKegiatan?.[0]?.namaEntitas !== String(admitted.company_code))) throw new Error('COUNT_SOURCE_DOCUMENT_UNCONFIRMED');
  if (admitted.operation !== operation || !reference || singleFrozenDocument(payload) !== reference
    || !validActivity || !payload.data[0].dokumenKegiatan[0].barangTransaksi?.length
    || (!countDomain && (admitted.source_revision !== 'ACCEPTED_WMS_ID' || admitted.intent !== 'SOURCE_COMMIT'
    || admitted.source_log_id !== null || admitted.identity_key !== canonicalIdentity({ kind: 'WMS_REFERENCE',
      operation, companyCode: admitted.company_code, reference, revision: 'ACCEPTED_WMS_ID',
      businessDate: admitted.business_date }).key))) throw new Error(`UNSUPPORTED_${operation}_IDENTITY_OR_BATCH`);
  const sources: { id: number; business_date: Date; reversal?: string | null }[] = countDomain
    ? await verifyCountSource(db, admitted).then(source => [{ id: source.id, business_date: new Date(source.businessDate) }])
    : operation === 'INCOMING'
    ? await db.$queryRaw<{ id: number; business_date: Date }[]>`
      SELECT g.id, g.incoming_date AS business_date FROM incoming_goods g
      JOIN companies c ON c.code = g.company_code AND c.company_type = 'SEZ'
      WHERE g.company_code = ${admitted.company_code} AND g.wms_id = ${reference}
        AND g.deleted_at IS NULL LIMIT 2`
    : operation === 'OUTGOING' ? await db.$queryRaw<{ id: number; business_date: Date }[]>`
      SELECT g.id, g.outgoing_date AS business_date FROM outgoing_goods g
      JOIN companies c ON c.code = g.company_code AND c.company_type = 'SEZ'
      WHERE g.company_code = ${admitted.company_code} AND g.wms_id = ${reference}
        AND g.deleted_at IS NULL LIMIT 2`
    : operation === 'MATERIAL_USAGE' ? await db.$queryRaw<{ id: number; business_date: Date; reversal: string | null }[]>`
      SELECT g.id, g.transaction_date AS business_date, g.reversal FROM material_usages g
      JOIN companies c ON c.code = g.company_code AND c.company_type = 'SEZ'
      WHERE g.company_code = ${admitted.company_code} AND g.wms_id = ${reference}
        AND g.deleted_at IS NULL LIMIT 2`
    : await db.$queryRaw<{ id: number; business_date: Date; reversal: string | null }[]>`
      SELECT g.id, g.transaction_date AS business_date, g.reversal FROM production_outputs g
      JOIN companies c ON c.code = g.company_code AND c.company_type = 'SEZ'
      WHERE g.company_code = ${admitted.company_code} AND g.wms_id = ${reference}
        AND g.deleted_at IS NULL LIMIT 2`;
  if (sources.length !== 1 || sources[0].business_date.toISOString().slice(0, 10) !== admitted.business_date) {
    throw new Error(`${operation}_SOURCE_IDENTITY_UNCONFIRMED`);
  }
  if (operation === 'MATERIAL_USAGE' || operation === 'PRODUCTION_OUTPUT') {
    const reversed = sources[0].reversal === 'Y';
    const expected = ((operation === 'PRODUCTION_OUTPUT') !== reversed) ? '30' : '31';
    if (activityCode !== expected) throw new Error(`${operation}_SOURCE_ACTIVITY_UNCONFIRMED`);
  }
  const sourceId = sources[0].id;
  // Snapshot scalar identity; never consult mutable source views after send.
  const job = { ...admitted, frozen_payload: payload };
  let retained: { fingerprint: string; outcome: Outcome; response: Prisma.InputJsonValue | null; explicitRejection: boolean; endedAt: number } | undefined;
  return async (received: Outcome, locallyEndedAt: number): Promise<void> => {
    // One bounded outcome is retained for all local retries, even if the caller
    // mutates/replaces its object. A contradictory repair cannot replace evidence.
    const evidence = received.responseEvidence;
    if (!evidence || (evidence.raw !== null && Buffer.byteLength(evidence.raw) > MAX_RESPONSE_BYTES)) {
      throw new Error('BOUNDED_RESPONSE_EVIDENCE_REQUIRED');
    }
    const serialized = JSON.stringify(received);
    const fingerprint = createHash('sha256').update(serialized).digest('hex');
    if (retained && retained.fingerprint !== fingerprint) throw new Error('OUTCOME_REPAIR_CONFLICT');
    if (!retained) {
      const outcome: Outcome = JSON.parse(serialized);
      let response: Prisma.InputJsonValue | null = null;
      let explicitRejection = false;
      if (evidence.state === 'COMPLETE') {
        if (evidence.raw === null || evidence.bytes !== Buffer.byteLength(evidence.raw)) throw new Error('INVALID_RESPONSE_EVIDENCE');
        let parsed: unknown;
        try { parsed = JSON.parse(evidence.raw); } catch { parsed = undefined; }
        explicitRejection = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          && (parsed as { status?: unknown }).status === false;
        const classification = classifyResponse(outcome.httpCode!, parsed, payload);
        if (classification.kind !== outcome.classification.kind || classification.reasonCode !== outcome.classification.reasonCode
          || (outcome.delivery === 'KNOWN_SUCCESS') !== (classification.kind === 'KNOWN_REMOTE_SUCCESS')) {
          throw new Error('CONTRADICTORY_OUTCOME_EVIDENCE');
        }
        const ok = outcome.httpCode !== null && outcome.httpCode >= 200 && outcome.httpCode < 300;
        if (parsed !== undefined && (ok || evidence.contentType?.toLowerCase().includes('json'))) {
          response = ok ? parsed as Prisma.InputJsonValue : {
            ...(parsed && typeof parsed === 'object' ? parsed : { data: parsed }),
            status: (parsed as { status?: unknown } | null)?.status === true,
            message: (parsed as { message?: string } | null)?.message || evidence.statusText || 'INSW request failed',
            httpStatus: outcome.httpCode, httpStatusText: evidence.statusText ?? '', contentType: evidence.contentType ?? '',
          } as Prisma.InputJsonValue;
        } else {
          // Actual text only; never manufacture a remote response for a timeout.
          response = ok ? { rawResponse: evidence.raw, httpStatus: outcome.httpCode }
            : { code: String(outcome.httpCode), status: false, message: evidence.statusText || 'INSW request failed',
              data: null, httpStatus: outcome.httpCode, httpStatusText: evidence.statusText ?? '',
              contentType: evidence.contentType ?? '', rawResponse: evidence.raw };
        }
      } else if (outcome.delivery === 'KNOWN_SUCCESS' || outcome.classification.kind === 'KNOWN_REMOTE_SUCCESS'
        || evidence.raw !== null) throw new Error('SUCCESS_REQUIRES_COMPLETE_RESPONSE');
      retained = { fingerprint, outcome, response, explicitRejection, endedAt: locallyEndedAt };
    }
    const { outcome, response, explicitRejection, endedAt } = retained;
    const success = outcome.delivery === 'KNOWN_SUCCESS';
    const responseRecord = response as Record<string, unknown> | null;
    const remoteMessage = typeof responseRecord?.message === 'string' ? responseRecord.message : null;
    // Checkpoint certainty separately. If finalization later fails, no selector
    // can repost. If this checkpoint fails too, the sticky busy claim remains.
    if (success) await db.$transaction(async tx => {
      const gate = await owned(tx, token);
      if (gate.busy_attempt_id !== job.attemptId) return; // Completed replay is verified below.
      const attempt = await tx.insw_queue_attempt.findUniqueOrThrow({ where: { id: job.attemptId } });
      if (attempt.owner_token !== token || attempt.queue_id !== job.id) throw new Error('ATTEMPT_OWNER_LOST');
      await tx.insw_queue_cycle.updateMany({ where: { id: job.id, owner_token: token, status: 'CLAIMED' }, data: {
        status: 'HELD', delivery_state: 'KNOWN_SUCCESS', hold_reason: 'LOCAL_FINALIZATION_REQUIRED', owner_token: null, lease_until: null,
      } });
      await tx.insw_queue_attempt.update({ where: { id: attempt.id }, data: { delivery_state: 'KNOWN_SUCCESS' } });
    });
    await db.$transaction(async tx => {
      const gate = await owned(tx, token);
      const attempt = await tx.insw_queue_attempt.findUniqueOrThrow({ where: { id: job.attemptId } });
      const cycle = await tx.insw_queue_cycle.findUniqueOrThrow({ where: { id: job.id }, select: {
        id: true, payload_sha256: true, identity_key: true, status: true, owner_token: true,
        delivery_state: true, hold_reason: true,
      } });
      if (attempt.owner_token !== token || attempt.queue_id !== job.id || attempt.retry_index !== job.retry_index
        || cycle.payload_sha256 !== job.payload_sha256 || cycle.identity_key !== job.identity_key) throw new Error('ATTEMPT_OWNER_LOST');
      const logs = await tx.insw_tracking_log.findMany({ where: { queue_attempt_id: job.attemptId }, take: 2,
        select: { transaction_id: true, transaction_type: true, company_code: true, metadata: true } });
      if (attempt.completed_at) {
        if (logs.length !== 1 || logs[0].transaction_type !== transactionType || logs[0].transaction_id !== sourceId
          || logs[0].company_code !== job.company_code
          || (logs[0].metadata as { outcome_sha256?: string } | null)?.outcome_sha256 !== fingerprint) {
          throw new Error('INCONSISTENT_COMPLETED_OUTCOME');
        }
        return;
      }
      if (gate.busy_attempt_id !== job.attemptId || logs.length || !(cycle.status === 'CLAIMED' && cycle.owner_token === token
        || success && cycle.status === 'HELD' && cycle.delivery_state === 'KNOWN_SUCCESS'
          && cycle.hold_reason === 'LOCAL_FINALIZATION_REQUIRED')) throw new Error('JOB_OWNER_LOST');
      const disposition = classifiedRetryDisposition({ classification: outcome.classification,
        // Only a complete explicit remote rejection is safe to retry. Timeouts,
        // reset sockets and incomplete responses retain delivery uncertainty.
        delivery: evidence.state === 'COMPLETE' && explicitRejection
          && outcome.classification.kind === 'TRANSIENT_FAILURE' ? 'KNOWN_FAILURE' : outcome.delivery,
        retryIndex: job.retry_index, maxAutoRetrySnapshot: Math.min(10, job.max_auto_retry_snapshot),
        clientApprovedAmbiguousRetry: false, exclusiveStreamProven: true, priorInvocationEnded: true, outcomeDurablyRecorded: true });
      const retry = !success && disposition === 'RETRY_TO_TAIL';
      const failure = !success && disposition === 'STOP';
      const metadata = { adapter: { INCOMING: 'C2B_ISOLATED_INCOMING', OUTGOING: 'PHASE2A_ISOLATED_OUTGOING',
          MATERIAL_USAGE: 'PHASE2B_ISOLATED_MATERIAL_USAGE', PRODUCTION_OUTPUT: 'PHASE2B_ISOLATED_PRODUCTION_OUTPUT',
          ADJUSTMENT: 'PHASE2C_ISOLATED_ADJUSTMENT', STOCK_OPNAME: 'PHASE2C_ISOLATED_STOCK_OPNAME' }[operation], outcome_sha256: fingerprint, payload_sha256: job.payload_sha256,
          endpoint_url: endpointUrl, classification: outcome.classification.kind,
          reasonCode: outcome.classification.reasonCode, delivery: outcome.delivery, phase: outcome.phase,
          httpCode: outcome.httpCode, businessCode: outcome.businessCode, responseEvidence: evidence.state,
          responseBytes: evidence.bytes, requestBytes, policyVersion: job.admissionPolicyVersion,
          invokedAt: outcome.requestInvokedAt, boundedOutcomeEndedAt: outcome.endedAt, locallyDrainedAt: endedAt };
      // Keep the exact legacy JSON fields and one insert, binding the already
      // verified body instead of traversing all detail items under the gate lock.
      await tx.$executeRaw`INSERT INTO insw_tracking_log
        (queue_attempt_id, transaction_type, transaction_id, company_code, wms_id, insw_activity_code,
          insw_status, retry_count, sent_at, insw_request_payload, insw_response, insw_error, metadata, updated_at)
        VALUES (${job.attemptId}::uuid, ${transactionType}, ${sourceId}, ${job.company_code}, ${reference}, ${activityCode},
          ${success ? 'SUCCESS' : 'FAILED'}, ${job.retry_index},
          ${outcome.requestInvokedAt === null ? null : new Date(outcome.requestInvokedAt)}::timestamptz,
          ${body}::jsonb, ${response === null ? null : JSON.stringify(response)}::jsonb,
          ${success ? null : remoteMessage || outcome.classification.reasonCode}, ${JSON.stringify(metadata)}::jsonb,
          clock_timestamp())`;
      await tx.insw_queue_attempt.update({ where: { id: attempt.id }, data: {
        delivery_state: outcome.delivery, completed_at: new Date(endedAt),
      } });
      await tx.insw_queue_cycle.update({ where: { id: cycle.id }, select: { id: true }, data: {
        status: success ? 'SUCCEEDED' : retry ? 'READY' : failure ? 'FAILED' : 'HELD',
        delivery_state: success ? 'KNOWN_SUCCESS' : retry ? 'NOT_STARTED' : failure ? 'KNOWN_FAILURE' : outcome.delivery,
        completed_at: success || failure ? new Date() : null, owner_token: null, lease_until: null,
        hold_reason: success || retry || failure ? null : 'DELIVERY_UNKNOWN',
        error_category: outcome.classification.kind, error_code: outcome.classification.reasonCode,
        error_message: success ? null : outcome.classification.reasonCode,
        ...(retry ? { retry_index: job.retry_index + 1, tail_key: await reserveTail(tx), next_eligible_at: new Date() } : {}),
      } });
      await tx.$executeRaw`UPDATE insw_dispatch_gate SET busy_attempt_id = NULL WHERE id = 1 AND owner_token = ${token}::uuid`;
    });
  };
}
