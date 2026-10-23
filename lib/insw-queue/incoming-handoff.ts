import type { Prisma } from '@prisma/client';
import type { INSWTransaksiPayload } from '../types/insw-api.types';
import { boundedText, canonicalIdentity, freezePayload } from './contracts';
import { enqueueInTransaction, type EnqueueInput } from './queue.repository';

export type IncomingPreparation = {
  companyCode: number;
  wmsReference: string;
  // Retained Phase B identity slot for synthetic/queue-side compatibility only.
  // No new upstream revision contract is required or authorized by C2A.
  // A live adapter must use the accepted source identity after rollout review.
  revision: string;
  businessDate: string;
  requestedBy: string;
  payload: INSWTransaksiPayload;
  // Caller obligation, NOT evidence that the current producer has a shared tx.
  authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT';
};

declare const prepared: unique symbol;
export type PreparedIncomingHandoff = { readonly [prepared]: true };
const preparations = new WeakMap<PreparedIncomingHandoff, EnqueueInput>();

/** Pure, detached preparation. No converter, source reads, HTTP or DB singleton.
 * Retained low-level utility: this does not establish source provenance or
 * converter parity. Live post-commit capture stays disabled pending parity and
 * exclusive producer rollout. Never attach it to a source beforeCommit hook.
 */
export function prepareIncomingHandoff(input: IncomingPreparation): PreparedIncomingHandoff {
  if (input.authoritativeInputs !== 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT') {
    throw new Error('Complete authoritative source and mapping snapshot required');
  }
  boundedText(input.wmsReference, 'WMS reference', 100);
  boundedText(input.requestedBy, 'request actor', 100);
  const identity = {
    kind: 'WMS_REFERENCE' as const, operation: 'INCOMING' as const,
    companyCode: input.companyCode, reference: input.wmsReference,
    revision: input.revision, businessDate: input.businessDate,
  };
  canonicalIdentity(identity);
  // Bounded work before canonicalization; reject non-JSON via freezePayload.
  let nodes = 0;
  let bytes = 0;
  function bound(value: unknown, depth = 0): void {
    if (++nodes > 100000 || depth > 100) throw new Error('Incoming payload exceeds preparation limit');
    if (typeof value === 'string') bytes += Buffer.byteLength(value);
    if (bytes > 1024 * 1024) throw new Error('Incoming payload exceeds preparation limit');
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        bytes += Buffer.byteLength(key);
        bound((value as Record<string, unknown>)[key], depth + 1);
      }
    }
  }
  bound(input.payload);
  const frozen = freezePayload(input.payload);
  if (Buffer.byteLength(JSON.stringify(frozen.payload)) > 1024 * 1024) {
    throw new Error('Incoming payload exceeds preparation limit');
  }
  const payload = frozen.payload as unknown as INSWTransaksiPayload;
  const activity = payload.data?.[0];
  const document = activity?.dokumenKegiatan?.[0];
  // One source transmission per intent. Domain conversion/validation stays with
  // the future authoritative capture; these are boundary consistency checks only.
  if (payload.data?.length !== 1 || activity?.kdKegiatan !== '30' ||
      activity.dokumenKegiatan.length !== 1 || document?.nomorDokKegiatan !== input.wmsReference ||
      !document.barangTransaksi?.length) throw new Error('Expected one complete Incoming transmission');
  const token = Object.freeze({}) as PreparedIncomingHandoff;
  preparations.set(token, {
    identity, payload: frozen.payload, intent: 'SOURCE_COMMIT',
    requestedBy: input.requestedBy, wmsReference: input.wmsReference,
  });
  return token;
}

/** Dormant queue-side API only. Use a separate queue transaction AFTER source
 * commit. Never enroll this function in the WMS source transaction: downstream
 * failures must not roll back a valid source. No production caller is authorized.
 */
export async function handoffIncomingInTransaction(tx: Prisma.TransactionClient, token: PreparedIncomingHandoff) {
  const input = preparations.get(token);
  if (!input) throw new Error('Unrecognized Incoming preparation');
  if ('$transaction' in tx) throw new Error('Caller transaction client required');
  const identity = canonicalIdentity(input.identity);
  // Same lock/key as Phase B. Source retries remain idempotent even after a
  // terminal cycle. Explicit manual resubmission continues to belong elsewhere.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.key}, 0))::text`;
  const existing = await tx.insw_queue_cycle.findFirst({
    where: { identity_key: identity.key }, orderBy: { cycle: 'asc' },
    select: { id: true, cycle: true, status: true, tail_key: true, max_auto_retry_snapshot: true,
      intent: true, payload_sha256: true, wms_reference: true, source_log_id: true },
  });
  if (existing) {
    if (existing.intent !== 'SOURCE_COMMIT' || existing.payload_sha256 !== freezePayload(input.payload).sha256 ||
        existing.wms_reference !== input.wmsReference || existing.source_log_id !== null) {
      throw new Error('Incoming transmission identity conflicts with prior handoff');
    }
    return { id: existing.id, cycle: existing.cycle, status: existing.status,
      tail_key: existing.tail_key, max_auto_retry_snapshot: existing.max_auto_retry_snapshot, created: false };
  }
  return enqueueInTransaction(tx, input);
}
