import { randomUUID } from 'node:crypto';
import type { Prisma, InswQueueStatus } from '@prisma/client';
import type { INSWTransaksiPayload } from '../types/insw-api.types';
import { boundedText, canonicalIdentity, freezePayload } from './contracts';
import type { EnqueueInput } from './queue.repository';
import { readPolicy } from './policy.repository';

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
const preparations = new WeakMap<PreparedIncomingHandoff, Omit<EnqueueInput, 'payload'> & { json: string; sha256: string }>();

// Resource ceiling for the converted envelope, NOT a WMS/INSW business limit.
// A minimal required source item (even with invalid empty strings) uses 88 JSON
// bytes. Conversion copies its item fields once, but can repeat a 255-character
// header document number per item (at most 1530 escaped bytes). 2048 extra bytes
// per possible item covers that document, mapped UOM (varchar(10)), keys and
// numeric formatting. Thus every supported <=20 MiB source fits this ceiling,
// including header amplification; it is deliberately distinct from responses.
// Outgoing emits the same item/document shape and has the same required item
// fields; optional allocations only enlarge its source. Reuse this ceiling.
// PO emits one shallow item per source item, with empty documents and
// additional required WO/planned fields. It fits the goods ceiling.
export const MAX_INCOMING_ENVELOPE_BYTES = 20 * 1024 * 1024
  + Math.floor(20 * 1024 * 1024 / 88) * 2048;

// MU expands each traceability entry into a persisted/emitted detail, repeating
// the parent item code/name. A required {ppkek_number,qty} entry exceeds 20 JSON
// bytes, even for null/N; 2048 extra bytes cover the escaped 50/200-character
// item code/name, mapped UOM and numeric/structural overhead per emitted row.
// Do not apply the goods minimum-item-size assumption to MU traceability.
export const MAX_MATERIAL_USAGE_ENVELOPE_BYTES = 20 * 1024 * 1024
  + Math.floor(20 * 1024 * 1024 / 20) * 2048;

export function assertIncomingEnvelopeBudget(payload: unknown, maximumBytes = MAX_INCOMING_ENVELOPE_BYTES): void {
  let bytes = 0;
  const ancestors = new Set<object>();
  const pending: { value: unknown; exit?: true }[] = [{ value: payload }];
  while (pending.length) {
    const { value, exit } = pending.pop()!;
    if (exit) { ancestors.delete(value as object); continue; }
    if (value && typeof value === 'object') {
      if (ancestors.has(value)) throw new Error('Payload must be acyclic JSON');
      ancestors.add(value);
      bytes += 2;
      pending.push({ value, exit: true });
      const keys = Object.keys(value);
      // Sparse arrays are not converter output; count their serialized nulls
      // too, before canonicalization can allocate a dense array.
      if (Array.isArray(value)) bytes += Math.max(0, value.length - keys.length) * 5;
      for (const key of keys) {
        bytes += 1;
        if (!Array.isArray(value)) bytes += Buffer.byteLength(JSON.stringify(key)) + 1;
        pending.push({ value: (value as Record<string, unknown>)[key] });
      }
    } else {
      if (typeof value === 'string' && Buffer.byteLength(value) > maximumBytes) {
        throw new Error('Incoming envelope exceeds resource limit');
      }
      bytes += Buffer.byteLength(JSON.stringify(value) ?? 'null');
    }
    if (bytes > maximumBytes) throw new Error('Incoming envelope exceeds resource limit');
  }
}

/** Pure, detached preparation. No converter, source reads, HTTP or DB singleton.
 * Retained low-level utility: this does not establish source provenance or
 * converter parity. Incoming completion supplies that context through coordinated
 * post-commit capture. Never attach it to a source beforeCommit hook.
 */
export function prepareIncomingHandoff(input: IncomingPreparation): PreparedIncomingHandoff {
  return prepareGoodsHandoff(input, 'INCOMING');
}

/** Same detached queue primitive; no new Outgoing producer. */
export function prepareOutgoingHandoff(input: IncomingPreparation): PreparedIncomingHandoff {
  return prepareGoodsHandoff(input, 'OUTGOING');
}

export function prepareMaterialUsageHandoff(input: IncomingPreparation, reversal: string | null): PreparedIncomingHandoff {
  return prepareGoodsHandoff(input, 'MATERIAL_USAGE', reversal);
}

export function prepareProductionOutputHandoff(input: IncomingPreparation, reversal: string | null): PreparedIncomingHandoff {
  return prepareGoodsHandoff(input, 'PRODUCTION_OUTPUT', reversal);
}

/** Detached single committed header; never a WMS acceptance hook. */
export function prepareCountHandoff(input: IncomingPreparation & {
  operation: 'ADJUSTMENT' | 'STOCK_OPNAME'; sourceId: number;
}): PreparedIncomingHandoff {
  if (![1370, 1380].includes(input.companyCode)) throw new Error('SEZ_COMPANY_REQUIRED');
  if (input.authoritativeInputs !== 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT') throw new Error('Complete authoritative snapshot required');
  boundedText(input.wmsReference, 'WMS reference', 100);
  boundedText(input.requestedBy, 'request actor', 100);
  if (!Number.isInteger(input.sourceId) || input.sourceId < 1 || input.sourceId > 2147483647) throw new Error('SOURCE_ID_EXCEEDS_LEGACY_TRACKING_INT');
  const identity = { kind: 'SOURCE_HEADER' as const, operation: input.operation, companyCode: input.companyCode,
    sourceId: input.sourceId, revision: input.revision, businessDate: input.businessDate };
  canonicalIdentity(identity);
  // These converters emit one shallow item per persisted detail; the existing
  // goods amplification ceiling also covers their remarks and scalar fields.
  assertIncomingEnvelopeBudget(input.payload);
  const frozen = freezePayload(input.payload);
  const payload = frozen.payload as unknown as INSWTransaksiPayload;
  const activity = payload.data?.[0]; const document = activity?.dokumenKegiatan?.[0];
  if (payload.data?.length !== 1 || activity?.kdKegiatan !== (input.operation === 'ADJUSTMENT' ? '33' : '32')
    || activity.dokumenKegiatan.length !== 1 || document?.nomorDokKegiatan !== input.wmsReference
    || document?.tanggalKegiatan !== input.businessDate.split('-').reverse().join('-') || document?.namaEntitas !== String(input.companyCode)
    || !document.barangTransaksi?.length) throw new Error('Expected one complete source header transmission');
  const token = Object.freeze({}) as PreparedIncomingHandoff;
  preparations.set(token, { identity, json: JSON.stringify(frozen.payload), sha256: frozen.sha256,
    intent: 'SOURCE_COMMIT', requestedBy: input.requestedBy, wmsReference: input.wmsReference });
  return token;
}

function prepareGoodsHandoff(input: IncomingPreparation, operation: 'INCOMING' | 'OUTGOING' | 'MATERIAL_USAGE' | 'PRODUCTION_OUTPUT', reversal: string | null = null): PreparedIncomingHandoff {
  if (![1370, 1380].includes(input.companyCode)) throw new Error('SEZ_COMPANY_REQUIRED');
  if (input.authoritativeInputs !== 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT') {
    throw new Error('Complete authoritative source and mapping snapshot required');
  }
  boundedText(input.wmsReference, 'WMS reference', 100);
  boundedText(input.requestedBy, 'request actor', 100);
  const identity = {
    kind: 'WMS_REFERENCE' as const, operation,
    companyCode: input.companyCode, reference: input.wmsReference,
    revision: input.revision, businessDate: input.businessDate,
  };
  canonicalIdentity(identity);
  assertIncomingEnvelopeBudget(input.payload, operation === 'MATERIAL_USAGE' ? MAX_MATERIAL_USAGE_ENVELOPE_BYTES : MAX_INCOMING_ENVELOPE_BYTES);
  const frozen = freezePayload(input.payload);
  const payload = frozen.payload as unknown as INSWTransaksiPayload;
  const activity = payload.data?.[0];
  const document = activity?.dokumenKegiatan?.[0];
  const normalIncoming = operation === 'INCOMING' || operation === 'PRODUCTION_OUTPUT';
  const expectedActivity = (normalIncoming !== (reversal === 'Y')) ? '30' : '31';
  // One source transmission per intent. Domain conversion/validation stays with
  // the future authoritative capture; these are boundary consistency checks only.
  if (payload.data?.length !== 1 || activity?.kdKegiatan !== expectedActivity ||
      activity.dokumenKegiatan.length !== 1 || document?.nomorDokKegiatan !== input.wmsReference ||
      !document.barangTransaksi?.length) throw new Error(`Expected one complete ${{ INCOMING: 'Incoming', OUTGOING: 'Outgoing', MATERIAL_USAGE: 'Material Usage', PRODUCTION_OUTPUT: 'Production Output' }[operation]} transmission`);
  const token = Object.freeze({}) as PreparedIncomingHandoff;
  preparations.set(token, {
    identity, json: JSON.stringify(frozen.payload), sha256: frozen.sha256, intent: 'SOURCE_COMMIT',
    requestedBy: input.requestedBy, wmsReference: input.wmsReference,
  });
  return token;
}

/** Use a separate queue transaction AFTER source
 * commit. Never enroll this function in the WMS source transaction: downstream
 * failures must not roll back a valid source. Only Incoming routing is connected.
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
    if (existing.intent !== 'SOURCE_COMMIT' || existing.payload_sha256 !== input.sha256 ||
        existing.wms_reference !== input.wmsReference || existing.source_log_id !== null) {
      throw new Error('Incoming transmission identity conflicts with prior handoff');
    }
    return { id: existing.id, cycle: existing.cycle, status: existing.status,
      tail_key: existing.tail_key, max_auto_retry_snapshot: existing.max_auto_retry_snapshot, created: false };
  }
  if (identity.operation === 'INCOMING') {
    const legacy = await tx.insw_tracking_log.findFirst({ where: { company_code: identity.companyCode,
      transaction_type: 'incoming', wms_id: input.wmsReference,
      insw_status: { in: ['SUCCESS', 'PENDING', 'RETRYING', 'PENDING_RESOLVED', 'FAILED', 'SENT'] } }, select: { id: true } });
    if (legacy) throw new Error('LEGACY_DELIVERY_REQUIRES_INVESTIGATION_OR_LOCAL_REPAIR');
  }
  // The opaque token owns the detached canonical payload/hash. Do not repeat
  // full-envelope canonicalization under the DB lock (large valid sources can
  // otherwise exhaust Prisma's short interactive transaction deadline).
  // The identity lock + any-cycle lookup above establish cycle 1 exclusively.
  const policy = await readPolicy(tx);
  // Bind one JSON string rather than making Prisma traverse every item again
  // while the identity lock is held. Defaults/triggers remain authoritative.
  const [row] = await tx.$queryRaw<{ id: string; cycle: number; status: InswQueueStatus;
    tail_key: bigint; max_auto_retry_snapshot: number }[]>`
    INSERT INTO insw_queue_cycle (id, company_code, operation, identity_key, source_revision,
      business_date, wms_reference, cycle, intent, requested_by, frozen_payload, payload_sha256, max_auto_retry_snapshot)
    VALUES (${randomUUID()}::uuid, ${identity.companyCode}, ${identity.operation}::"InswQueueOperation", ${identity.key},
      ${identity.revision}, ${identity.businessDate}, ${input.wmsReference}, 1, ${input.intent}, ${input.requestedBy},
      ${input.json}::jsonb, ${input.sha256}, ${identity.operation === 'INCOMING' ? Math.min(10, policy.max_auto_retry) : policy.max_auto_retry})
    RETURNING id, cycle, status, tail_key, max_auto_retry_snapshot`;
  return { ...row, created: true };
}
