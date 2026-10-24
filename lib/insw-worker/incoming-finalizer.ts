import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { canonicalIdentity } from '../insw-queue/contracts';
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
  const endpoint = new URL(config.endpointUrl);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || !['http:', 'https:'].includes(endpoint.protocol)) throw new Error('INVALID_ENDPOINT_EVIDENCE');
  const endpointUrl = endpoint.toString();
  if (process.env.NODE_ENV === 'production') throw new Error('ISOLATED_TEST_ONLY');
  const [runtime] = await db.$queryRaw<{ name: string; host: string | null }[]>`
    SELECT current_database() AS name, host(inet_server_addr()) AS host`;
  if (!/^[a-z0-9_]+_phase_c2b_test$/.test(runtime.name) || !['127.0.0.1', '::1'].includes(runtime.host ?? '')) {
    throw new Error('ISOLATED_TEST_ONLY');
  }
  const body = verifiedPayload(admitted.frozen_payload, admitted.payload_sha256);
  const requestBytes = Buffer.byteLength(body);
  if (requestBytes > MAX_RESPONSE_BYTES) throw new Error('INCOMING_REQUEST_TOO_LARGE');
  const payload = JSON.parse(body);
  const reference = admitted.wms_reference;
  if (admitted.operation !== 'INCOMING' || !reference || singleFrozenDocument(payload) !== reference
    || payload.data[0].kdKegiatan !== '30' || !payload.data[0].dokumenKegiatan[0].barangTransaksi?.length
    || admitted.source_revision !== 'ACCEPTED_WMS_ID' || admitted.intent !== 'SOURCE_COMMIT'
    || admitted.source_log_id !== null || admitted.identity_key !== canonicalIdentity({ kind: 'WMS_REFERENCE',
      operation: 'INCOMING', companyCode: admitted.company_code, reference, revision: 'ACCEPTED_WMS_ID',
      businessDate: admitted.business_date }).key) throw new Error('UNSUPPORTED_INCOMING_IDENTITY_OR_BATCH');
  const sources = await db.$queryRaw<{ id: number; incoming_date: Date }[]>`
    SELECT g.id, g.incoming_date FROM incoming_goods g
    JOIN companies c ON c.code = g.company_code AND c.company_type = 'SEZ'
    WHERE g.company_code = ${admitted.company_code} AND g.wms_id = ${reference}
      AND g.deleted_at IS NULL LIMIT 2`;
  if (sources.length !== 1 || sources[0].incoming_date.toISOString().slice(0, 10) !== admitted.business_date) {
    throw new Error('INCOMING_SOURCE_IDENTITY_UNCONFIRMED');
  }
  const sourceId = sources[0].id;
  // Snapshot scalar identity; never consult mutable source views after send.
  const job = { ...admitted, frozen_payload: payload };
  let retained: { fingerprint: string; outcome: Outcome; response: Prisma.InputJsonValue | null; endedAt: number } | undefined;
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
      if (evidence.state === 'COMPLETE') {
        if (evidence.raw === null || evidence.bytes !== Buffer.byteLength(evidence.raw)) throw new Error('INVALID_RESPONSE_EVIDENCE');
        let parsed: unknown;
        try { parsed = JSON.parse(evidence.raw); } catch { parsed = undefined; }
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
      retained = { fingerprint, outcome, response, endedAt: locallyEndedAt };
    }
    const { outcome, response, endedAt } = retained;
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
      const cycle = await tx.insw_queue_cycle.findUniqueOrThrow({ where: { id: job.id } });
      if (attempt.owner_token !== token || attempt.queue_id !== job.id || attempt.retry_index !== job.retry_index
        || cycle.payload_sha256 !== job.payload_sha256 || cycle.identity_key !== job.identity_key) throw new Error('ATTEMPT_OWNER_LOST');
      const logs = await tx.insw_tracking_log.findMany({ where: { queue_attempt_id: job.attemptId }, take: 2,
        select: { transaction_id: true, transaction_type: true, company_code: true, metadata: true } });
      if (attempt.completed_at) {
        if (logs.length !== 1 || logs[0].transaction_type !== 'incoming' || logs[0].transaction_id !== sourceId
          || logs[0].company_code !== job.company_code
          || (logs[0].metadata as { outcome_sha256?: string } | null)?.outcome_sha256 !== fingerprint) {
          throw new Error('INCONSISTENT_COMPLETED_OUTCOME');
        }
        return;
      }
      if (gate.busy_attempt_id !== job.attemptId || logs.length || !(cycle.status === 'CLAIMED' && cycle.owner_token === token
        || success && cycle.status === 'HELD' && cycle.delivery_state === 'KNOWN_SUCCESS'
          && cycle.hold_reason === 'LOCAL_FINALIZATION_REQUIRED')) throw new Error('JOB_OWNER_LOST');
      const disposition = classifiedRetryDisposition({ classification: outcome.classification, delivery: outcome.delivery,
        retryIndex: job.retry_index, maxAutoRetrySnapshot: Math.min(10, job.max_auto_retry_snapshot),
        clientApprovedAmbiguousRetry: true, exclusiveStreamProven: true, priorInvocationEnded: true, outcomeDurablyRecorded: true });
      const retry = !success && disposition === 'RETRY_TO_TAIL';
      const failure = !success && disposition === 'STOP';
      // One newly inserted Incoming log. Scrap's preclaims are deliberately unsupported.
      await tx.insw_tracking_log.create({ data: {
        queue_attempt_id: job.attemptId, transaction_type: 'incoming', transaction_id: sourceId,
        company_code: job.company_code, wms_id: reference, insw_activity_code: '30',
        insw_status: success ? 'SUCCESS' : 'FAILED', retry_count: job.retry_index,
        sent_at: outcome.requestInvokedAt === null ? null : new Date(outcome.requestInvokedAt),
        insw_request_payload: payload, insw_response: response === null ? Prisma.DbNull : response,
        insw_error: success ? null : remoteMessage || outcome.classification.reasonCode,
        metadata: { adapter: 'C2B_ISOLATED_INCOMING', outcome_sha256: fingerprint, payload_sha256: job.payload_sha256,
          endpoint_url: endpointUrl, classification: outcome.classification.kind,
          reasonCode: outcome.classification.reasonCode, delivery: outcome.delivery, phase: outcome.phase,
          httpCode: outcome.httpCode, businessCode: outcome.businessCode, responseEvidence: evidence.state,
          responseBytes: evidence.bytes, requestBytes, policyVersion: job.admissionPolicyVersion,
          invokedAt: outcome.requestInvokedAt, boundedOutcomeEndedAt: outcome.endedAt, locallyDrainedAt: endedAt },
      } });
      await tx.insw_queue_attempt.update({ where: { id: attempt.id }, data: {
        delivery_state: outcome.delivery, completed_at: new Date(endedAt),
      } });
      await tx.insw_queue_cycle.update({ where: { id: cycle.id }, data: {
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
