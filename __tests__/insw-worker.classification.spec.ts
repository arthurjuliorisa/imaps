import { test, expect } from '@playwright/test';
import { freezePayload } from '../lib/insw-queue/contracts';
import { classifyLocalFailure, classifyResponse, classifyTransportFailure, singleFrozenDocument } from '../lib/insw-worker/classification';
import { classifiedRetryDisposition } from '../lib/insw-worker/retry';
import { executeFrozenRequest } from '../lib/insw-worker/transport';

const payload = { data: [{ kdKegiatan: '31', dokumenKegiatan: [{ nomorDokKegiatan: 'DOC/2026-01' }] }] };
const duplicate = { status: false, code: '02', message: 'Atas nomor dokumen kegiatan DOC/2026-01 sudah pernah dikirim' };

test('Duplicate Possibility requires HTTP, exact string code, false status, recognized wording and frozen document', () => {
  expect(classifyResponse(400, duplicate, payload)).toEqual({ kind: 'DUPLICATE_POSSIBILITY', reasonCode: 'DUPLICATE_POSSIBILITY', retryCandidate: false });
  for (const message of [
    '  ATAS  NOMOR\tDOKUMEN KEGIATAN DOC/2026-01 SUDAH PERNAH DIKIRIM.  ',
    '\nAtas nomor dokumen kegiatan\nDOC/2026-01\tsudah pernah dikirim\n',
  ]) expect(classifyResponse(400, { ...duplicate, message }, payload).kind).toBe('DUPLICATE_POSSIBILITY');
  for (const body of [
    { ...duplicate, message: 'Atas nomor dokumen kegiatan OTHER sudah pernah dikirim' },
    { ...duplicate, message: 'Atas nomor dokumen kegiatan doc/2026-01 sudah pernah dikirim' },
    { ...duplicate, message: 'Atas nomor dokumen kegiatan DOC/2026-01/EXTRA sudah pernah dikirim' },
    { ...duplicate, message: 'validation error' },
    { ...duplicate, message: `unrelated: ${duplicate.message}` },
    { ...duplicate, message: `${duplicate.message}; another error` },
    { ...duplicate, message: 'Atas nomor dokumen kegiatan DOC/2026-01 sudah pernah dikirim\u0000' },
    { ...duplicate, message: undefined }, { ...duplicate, message: null }, { ...duplicate, message: {} },
    { ...duplicate, code: 2 }, { ...duplicate, code: '2' }, { ...duplicate, code: '01' },
    { ...duplicate, status: true }, { ...duplicate, status: 'false' },
    '<html>error</html>', null,
  ]) expect(classifyResponse(400, body, payload).kind).not.toBe('DUPLICATE_POSSIBILITY');
  for (const status of [200, 401, 422, 500]) expect(classifyResponse(status, duplicate, payload).kind).not.toBe('DUPLICATE_POSSIBILITY');
});

test('document identity uses only one actual envelope document with conservative whitespace normalization', () => {
  expect(singleFrozenDocument(payload)).toBe('DOC/2026-01');
  const spaced = { data: [{ dokumenKegiatan: [{ nomorDokKegiatan: '  DOC\t ONE  ' }] }] };
  expect(classifyResponse(400, { ...duplicate, message: 'Atas nomor dokumen kegiatan DOC  ONE sudah pernah dikirim' }, spaced).kind).toBe('DUPLICATE_POSSIBILITY');
  for (const bad of [
    {}, { nomorDokKegiatan: 'DOC/2026-01' }, { documents: [{ nomorDokKegiatan: 'DOC/2026-01' }] },
    { data: { nomorDokKegiatan: 'DOC/2026-01' } }, { data: [] },
    { data: [{ dokumenKegiatan: [] }] },
    { data: [{ dokumenKegiatan: [{ nomorDokKegiatan: 123 }] }] },
    { data: [{ dokumenKegiatan: [{ nomorDokKegiatan: ' ' }] }] },
    { data: [{ dokumenKegiatan: [{ nomorDokKegiatan: '\u00a0DOC/2026-01' }] }] },
    { data: [{ dokumenKegiatan: [payload.data[0].dokumenKegiatan[0], payload.data[0].dokumenKegiatan[0]] }] },
    { data: [payload.data[0], payload.data[0]] },
  ]) {
    expect(singleFrozenDocument(bad)).toBeNull();
    expect(classifyResponse(400, duplicate, bad).kind).not.toBe('DUPLICATE_POSSIBILITY');
  }
});

test('response matrix distinguishes success, permanent failure, temporary availability, and unknown', () => {
  expect(classifyResponse(200, { status: true }, payload).kind).toBe('KNOWN_REMOTE_SUCCESS');
  for (const status of [400, 422, 200]) expect(classifyResponse(status, { status: false }, payload).kind).toBe('PERMANENT_FAILURE');
  for (const status of [401, 403]) expect(classifyResponse(status, undefined, payload).kind).toBe('PERMANENT_FAILURE');
  for (const status of [429, 500, 502, 503, 504]) {
    expect(classifyResponse(status, undefined, payload)).toMatchObject({ kind: 'TRANSIENT_FAILURE', retryCandidate: true });
    expect(classifyResponse(status, { status: true }, payload).kind).toBe('UNKNOWN');
  }
  for (const body of [null, [], {}, { status: 'true' }, 'non-JSON']) expect(classifyResponse(200, body, payload).kind).toBe('UNKNOWN');
});

test('transport/local matrix does not conflate DB preparation with an HTTP retry', () => {
  expect(classifyTransportFailure('TIMEOUT').retryCandidate).toBe(true);
  for (const code of ['EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_SOCKET']) {
    expect(classifyTransportFailure('NETWORK', code).retryCandidate).toBe(true);
  }
  for (const code of ['ENOTFOUND', 'UNRECOGNIZED', undefined]) expect(classifyTransportFailure('NETWORK', code).kind).toBe('UNKNOWN');
  expect(classifyTransportFailure('CANCELLED', 'ECONNRESET').retryCandidate).toBe(false);
  expect(classifyLocalFailure('DATABASE')).toMatchObject({ kind: 'LOCAL_PREPARATION_FAILURE', retryCandidate: false });
  for (const reason of ['DATA', 'MAPPING', 'SOURCE', 'CONFIG', 'AUTH'] as const) expect(classifyLocalFailure(reason).kind).toBe('PERMANENT_FAILURE');
});

test('injected transport classifies against the verified JSON even if original source object changes during HTTP', async () => {
  const source = structuredClone(payload);
  const sha256 = freezePayload(source).sha256;
  const outcome = await executeFrozenRequest({ payload: source, sha256, timeoutMs: 100, request: async body => {
    expect(JSON.parse(body)).toEqual(payload);
    source.data[0].dokumenKegiatan[0].nomorDokKegiatan = 'CHANGED';
    return new Response(JSON.stringify({ ...duplicate, secret: 'SECRET', message: duplicate.message }), { status: 400 });
  } });
  expect(outcome).toMatchObject({ delivery: 'POSSIBLY_STARTED', classification: { reasonCode: 'DUPLICATE_POSSIBILITY', retryCandidate: false }, autoRetry: false });
  expect(JSON.stringify(outcome)).not.toContain('SECRET');
  expect(JSON.stringify(outcome)).not.toContain(duplicate.message);
});

const safe = {
  classification: classifyTransportFailure('TIMEOUT'), delivery: 'POSSIBLY_STARTED' as const,
  retryIndex: 0, maxAutoRetrySnapshot: 10, clientApprovedAmbiguousRetry: true,
  exclusiveStreamProven: true, priorInvocationEnded: true, outcomeDurablyRecorded: true,
};
test('retry policy budgets 0 vs 10 mean 1 vs 11 total attempts, with same frozen payload', async () => {
  for (const maximum of [0, 10]) {
    let attempts = 0;
    const bodies: string[] = [];
    for (let retryIndex = 0; retryIndex <= maximum; retryIndex++) {
      await executeFrozenRequest({ payload, sha256: freezePayload(payload).sha256, timeoutMs: 100, request: async body => {
        bodies.push(body); return new Response('{"status":false}', { status: 503 });
      } });
      attempts++;
      if (classifiedRetryDisposition({ ...safe, retryIndex, maxAutoRetrySnapshot: maximum }) !== 'RETRY_TO_TAIL') break;
    }
    expect(attempts).toBe(maximum + 1);
    expect(new Set(bodies).size).toBe(1);
  }
});

test('accepted ambiguous remote delivery never waives internal serialization or durable evidence', () => {
  expect(classifiedRetryDisposition(safe)).toBe('RETRY_TO_TAIL');
  for (const flag of ['clientApprovedAmbiguousRetry', 'exclusiveStreamProven', 'priorInvocationEnded', 'outcomeDurablyRecorded'] as const) {
    expect(classifiedRetryDisposition({ ...safe, [flag]: false })).toBe('HOLD');
  }
  expect(classifiedRetryDisposition({ ...safe, delivery: 'NOT_STARTED' })).toBe('HOLD');
  expect(classifiedRetryDisposition({ ...safe, delivery: 'KNOWN_SUCCESS' })).toBe('STOP');
  expect(classifiedRetryDisposition({ ...safe, classification: classifyResponse(400, duplicate, payload) })).toBe('HOLD');
  expect(classifiedRetryDisposition({ ...safe, classification: classifyLocalFailure('DATA') })).toBe('STOP');
  expect(classifiedRetryDisposition({ ...safe, classification: classifyLocalFailure('DATABASE') })).toBe('HOLD');
  expect(classifiedRetryDisposition({ ...safe, classification: classifyTransportFailure('NETWORK') })).toBe('HOLD');
  expect(() => classifiedRetryDisposition({ ...safe, retryIndex: -1 })).toThrow();
});
