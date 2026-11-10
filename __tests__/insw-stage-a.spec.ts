import { test, expect } from '@playwright/test';
import net from 'node:net';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { NextResponse } from 'next/server';
import * as coordination from '../lib/insw-queue/wms-coordination';
import { logResendEligibility } from '../lib/insw-log-actions';
import { currentQueueStates, operationalLogPage } from '../lib/insw-queue/operational-logs';
import { projectWmsInswStatus, wmsLogInswStatuses } from '../lib/insw-queue/wms-log-status';
import { recordedResult, transmissionStatus, transmissionResult, transmissionError } from '../lib/insw-log-presentation';
import { classifyResponse, classifyTransportFailure } from '../lib/insw-worker/classification';
import { prepareWmsFinalizer } from '../lib/insw-worker/incoming-finalizer';
import { executeFrozenRequest } from '../lib/insw-worker/transport';
import { canonicalIdentity, freezePayload } from '../lib/insw-queue/contracts';

const connect = net.Socket.prototype.connect;
const fetch = globalThis.fetch;
test.beforeAll(() => {
  net.Socket.prototype.connect = (() => { throw new Error('STAGE_A_NO_NETWORK'); }) as typeof connect;
  globalThis.fetch = async () => { throw new Error('STAGE_A_NO_NETWORK'); };
});
test.afterAll(() => { net.Socket.prototype.connect = connect; globalThis.fetch = fetch; });
const evidence = { classification: 'TRANSIENT_FAILURE', reasonCode: 'RATE_LIMIT_REJECTION',
  responseEvidence: 'COMPLETE', providerStatus: false, providerMessage: 'API rate limit exceeded', httpCode: 429 };
const cycle = { status: 'FAILED', delivery_state: 'KNOWN_FAILURE', retry_index: 10,
  max_auto_retry_snapshot: 10, owner_token: null, lease_until: null } as const;
const payload = { data: [{ kdKegiatan: '30', dokumenKegiatan: [{ nomorDokKegiatan: 'DOC', barangTransaksi: [{ kdBarang: 'ITEM' }] }] }] };
const rate = { status: false, message: 'API rate limit exceeded' };

for (const budget of [0, 10]) test(`A05/A20: budget ${budget}, last cause and raw evidence control ordinary resend`, () => {
  const parent = { ...cycle, retry_index: budget, max_auto_retry_snapshot: budget };
  expect(coordination.wmsResendEligible(parent, evidence)).toBe(true);
  for (const change of [{ status: 'HELD' }, { status: 'READY' }, { delivery_state: 'POSSIBLY_STARTED' },
    { owner_token: 'busy' }, { lease_until: new Date() }, { retry_index: budget + 1 }, { max_auto_retry_snapshot: 11 }]) {
    expect(coordination.wmsResendEligible({ ...parent, ...change } as any, evidence)).toBe(false);
  }
  if (budget) expect(coordination.wmsResendEligible({ ...parent, retry_index: budget - 1 }, evidence)).toBe(false);
  for (const reasonCode of ['BUSINESS_VALIDATION_FAILURE', 'MISSING_ITEM_VALIDATION', 'DUPLICATE_POSSIBILITY',
    'AUTHORIZATION_FAILURE', 'UNRECOGNIZED_CODE_02', 'TEMPORARY_NETWORK_FAILURE', 'REQUEST_CANCELLED', 'LOCAL_DATA_FAILURE', 'TEMPORARY_UNAVAILABILITY']) {
    expect(coordination.wmsResendEligible(parent, { ...evidence, reasonCode })).toBe(false);
  }
  for (const change of [{ providerStatus: undefined }, { providerStatus: true }, { httpCode: 502 },
    { classification: 'UNKNOWN' }, { responseEvidence: 'UNAVAILABLE' }]) {
    expect(coordination.wmsResendEligible(parent, { ...evidence, ...change })).toBe(false);
  }
});

test('A14–A19/A24: bounded signatures; unknown and normalized responses never authorize a retry', () => {
  expect(classifyResponse(429, rate, payload).reasonCode).toBe('RATE_LIMIT_REJECTION');
  expect(classifyResponse(400, { status: false, code: '02', message: 'data barang 0471A11000PR tidak ada' }, payload).reasonCode).toBe('MISSING_ITEM_VALIDATION');
  expect(transmissionError('data barang 0471A11000PR tidak ada')).toBe('data barang 0471A11000PR tidak ada');
  const duplicate = { status: false, code: '02', message: 'Atas nomor dokumen kegiatan DOC sudah pernah dikirim' };
  expect(classifyResponse(400, duplicate, payload).kind).toBe('DUPLICATE_POSSIBILITY');
  for (const body of [{ ...duplicate, message: 'data belum diproses' }, { ...duplicate, message: 'Atas nomor dokumen kegiatan OTHER sudah pernah dikirim' },
    { ...duplicate, code: 2 }, { ...duplicate, status: true }, { status: false },
    { status: false, message: 'new unreviewed error' }]) expect(classifyResponse(400, body, payload).kind).toBe('UNKNOWN');
  for (const status of [429, 502, 503, 504]) {
    expect(classifyResponse(status, undefined, payload).retryCandidate).toBe(false);
    expect(classifyResponse(status, { status: false, message: 'Bad Gateway' }, payload).retryCandidate).toBe(false);
  }
  expect(classifyResponse(429, { ...rate, status: true }, payload).kind).toBe('UNKNOWN');
  expect(classifyResponse(200, { status: true, code: '02', message: 'unknown' }, payload).kind).toBe('UNKNOWN');
  for (const status of [401, 403]) expect(classifyResponse(status, undefined, payload).reasonCode).toBe('AUTHORIZATION_FAILURE');
  expect(classifyTransportFailure('CANCELLED', 'ECONNRESET').retryCandidate).toBe(false);
});

test('A01/A04/A21/A26–A28: operational status and selected historical result remain independent', () => {
  const q = { ...cycle, id: 'q', retry_index: 0, attempt: null, attempts_started: 0 } as any;
  const initial = { insw_status: 'NO_ATTEMPT_LOG', current_queue: { ...q, status: 'READY' } };
  expect(transmissionStatus(initial).label).toBe('Waiting');
  expect(recordedResult({ ...initial, current_queue: { ...q, status: 'CLAIMED', delivery_state: 'POSSIBLY_STARTED' } }).label).toBe('—');
  expect(recordedResult(initial).label).toBe('—');
  expect(transmissionStatus({ ...initial, current_queue: { ...q, status: 'READY', retry_index: 1 } }).label).toBe('Retry');
  for (const status of ['HELD', 'CLAIMED', 'REMOTE_SUCCEEDED']) {
    const log = { ...initial, current_queue: { ...q, status, delivery_state: 'KNOWN_SUCCESS' } };
    expect(recordedResult(log).label).toBe('Not Recorded');
    expect(transmissionStatus(log).label).toBe(status === 'CLAIMED' ? 'Sending' : 'On Hold');
  }
  expect(recordedResult({ insw_status: 'FAILED', current_queue: { ...q, status: 'SUCCEEDED' } }).label).toBe('Failed');
  expect(transmissionResult(null, 'KNOWN_SUCCESS').label).toBe('Not Recorded');
  expect(transmissionResult('FAILED', 'KNOWN_SUCCESS').label).toBe('Failed');
  expect(transmissionResult('PENDING_RESOLVED').label).toBe('Not Recorded');
  expect(transmissionResult('FAILED', 'KNOWN_SUCCESS', 'SIMULATED_REMOTE_REJECTION')).toMatchObject({ label: 'Failed', color: 'info' });
  const simulated = transmissionStatus({ insw_status: 'SUCCESS', current_queue: { ...q, status: 'SUCCEEDED', provenance: 'SIMULATED_REMOTE_REJECTION' } });
  expect(simulated.label).toBe('Success'); expect(simulated.explanation).toContain('does not confirm receipt');
});

const facts = { log_id: BigInt(1), company_code: 1370, operation: 'INCOMING', wms_id: 'DOC', transmission_status: 'SUCCESS',
  source_id: BigInt(1), source_matches: BigInt(1), business_date: '2026-11-10', revision: 'ACCEPTED_WMS_ID', source_valid: true,
  queues: [], history_count: 0, remote_success: false, history_mismatch: false } as any;
const identity = canonicalIdentity({ kind: 'WMS_REFERENCE', operation: 'INCOMING', companyCode: 1370, reference: 'DOC',
  businessDate: facts.business_date, revision: facts.revision }).key;
test('A25/A26/A28: WMS regeneration only without first queue/history; loaded retry facts determine display', () => {
  expect(projectWmsInswStatus(facts, true)).toMatchObject({ operationalLabel: 'Not Queued', canRegenerate: true });
  for (const status of ['READY', 'CLAIMED', 'FAILED', 'HELD', 'SUCCEEDED', 'REMOTE_SUCCEEDED']) {
    const row = { ...facts, queues: [{ identity_key: identity, business_date: facts.business_date,
      source_revision: facts.revision, cycle: 1, status, retry_index: 1 }] };
    expect(projectWmsInswStatus(row, true)).toMatchObject({ canRegenerate: false, operationalLabel:
      ({ READY: 'Retry', CLAIMED: 'Sending', FAILED: 'Failed', HELD: 'On Hold', SUCCEEDED: 'Success', REMOTE_SUCCEEDED: 'On Hold' } as any)[status] });
  }
  for (const patch of [{ history_count: 1 }, { history_mismatch: true }, { source_matches: BigInt(2) }]) {
    expect(projectWmsInswStatus({ ...facts, ...patch }, true)).toMatchObject({ operationalLabel: 'On Hold', canRegenerate: false });
  }
});

for (const size of [10, 50]) test(`list/detail: ${size} rows share one category decision and bounded lookups`, async () => {
  const rows = Array.from({ length: size }, (_, i) => ({ id: BigInt(i + 1), ...cycle, metadata: i % 2 ? evidence : { ...evidence, reasonCode: 'AUTHORIZATION_FAILURE' } }));
  let calls = 0;
  const queries: any[] = [];
  const db = { $queryRaw: async (query: any) => { calls++; queries.push(query); return rows; } } as any;
  const logs = rows.map(row => ({ id: row.id, transaction_type: 'incoming' }));
  const list = await logResendEligibility(db, 1370, logs);
  expect(calls).toBe(1); expect(list.size).toBe(size / 2);
  for (const row of rows) expect(list.has(String(row.id))).toBe(coordination.wmsResendEligible(row, row.metadata));
  const sql = queries[0].sql;
  expect(sql).toContain('newer_attempt'); expect(sql).toContain('sibling'); expect(sql).toContain('conflict.identity_key <> p.identity_key');
  expect(sql).toContain('conflict.transaction_id IS DISTINCT FROM l.transaction_id');
  expect(queries[0].values).toContain(1370);
  calls = 0;
  const statesDb = { $queryRaw: async () => { calls++; return []; } } as any;
  await currentQueueStates(statesDb, 1370, Array(size).fill('00000000-0000-4000-8000-000000000001'));
  expect(calls).toBe(1);
  calls = 0;
  await wmsLogInswStatuses({ $queryRaw: async () => { calls++; return Array(size).fill(facts); } } as any,
    { role: 'USER', companyCode: 1370 }, rows.map(r => r.id));
  expect(calls).toBe(1);
  calls = 0;
  await operationalLogPage({ $queryRaw: async () => {
    calls++; return calls === 1 ? [{ total: size, logs: rows.map(row => ({ id: String(row.id), queue_id: '00000000-0000-4000-8000-000000000001' })) }] : [];
  } } as any, { company_code: 1370, limit: size, offset: 0 });
  expect(calls).toBe(2);
});

function resendDb(metadata: any = evidence) {
  const events: string[] = [];
  const queries: any[] = [];
  let latest = 'parent';
  const parent = { ...cycle, id: 'parent', operation: 'INCOMING', wms_reference: 'DOC', identity_key: identity, cycle: 1, payload_sha256: 'frozen' };
  const tx = {
    insw_tracking_log: { findFirst: async () => ({ metadata, queue_attempt: { queue: parent } }),
      update: async () => { events.push('audit'); } },
    insw_queue_cycle: { findFirst: async () => null },
    insw_transmission_policy: { findUnique: async () => ({ min_processing_interval_ms: 3600, max_auto_retry: 10, version: 1 }) },
    $queryRaw: async (query: any, ...values: any[]) => {
      const sql = Array.isArray(query) ? query.join('?') : query.sql;
      queries.push(query);
      if (sql.includes('pg_advisory')) { events.push(String(values[0])); return []; }
      if (sql.includes('FOR UPDATE')) return [{ id: latest }];
      if (sql.includes('INSERT INTO')) { events.push('insert'); latest = 'successor'; return [{ id: latest }]; }
      return [{ id: BigInt(1), ...cycle, metadata }];
    },
  };
  const db = { ...tx, $transaction: async (fn: any) => fn(tx) } as any;
  return { db, events, queries, parent };
}
test('admission: stable reference before identity/row lock; frozen copy; repeated click cannot create a second successor', async () => {
  const mock = resendDb();
  expect(await coordination.resendWmsLog(mock.db, 1370, BigInt(1), 'operator', 'reviewed')).toMatchObject({ status: 'accepted' });
  expect(mock.events[0]).toContain('insw-source-reference'); expect(mock.events[1]).toBe(identity);
  expect(mock.events.filter(e => e === 'insert')).toHaveLength(1);
  const insert = mock.queries.find(q => Array.isArray(q) && q.join('').includes('INSERT INTO'));
  expect(insert.join('')).toContain('frozen_payload, payload_sha256');
  await expect(coordination.resendWmsLog(mock.db, 1370, BigInt(1), 'operator', 'again')).rejects.toThrow('not definitively failed');
  expect(mock.events.filter(e => e === 'insert')).toHaveLength(1);
});
test('worker parent: category, frozen hash, history/identity and authorized successor are rechecked', async () => {
  for (const invalid of [false, true]) {
    const mock = resendDb({ ...evidence, ...(invalid ? { reasonCode: 'AUTHORIZATION_FAILURE' } : {}), manual_resend: { queue_id: 'successor' } });
    const successor = { id: 'successor', operation: 'INCOMING', source_log_id: BigInt(1), identity_key: identity, cycle: 2,
      payload_sha256: 'frozen', company_code: 1370 } as any;
    if (invalid) await expect(coordination.verifyWmsManualCycle(mock.db, successor)).rejects.toThrow('INVALID_WMS_MANUAL_SUCCESSOR');
    else {
      await coordination.verifyWmsManualCycle(mock.db, successor);
      await expect(coordination.verifyWmsManualCycle(mock.db, { ...successor, payload_sha256: 'changed' })).rejects.toThrow('INVALID_WMS_MANUAL_SUCCESSOR');
      mock.db.$queryRaw = async () => [];
      await expect(coordination.verifyWmsManualCycle(mock.db, successor)).rejects.toThrow('INVALID_WMS_MANUAL_SUCCESSOR');
    }
  }
});

function route(db: any, authenticated = true) {
  const exports: any = {};
  const imports: any = { '@/lib/insw-queue/wms-coordination': coordination, 'next/server': { NextResponse },
    '@/lib/prisma': { prisma: db }, '@/lib/insw-auth': { checkInswAuth: async (action: string) => {
      expect(action).toBe('edit'); return authenticated ? { authenticated: true, session: { user: { id: 'op' } } }
        : { authenticated: false, response: NextResponse.json({}, { status: 403 }) };
    } }, '@/lib/company-validation': { validateCompanyCode: () => ({ success: true, companyCode: 1370 }) } };
  vm.runInNewContext(ts.transpileModule(readFileSync('app/api/insw/logs/[id]/resend/route.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: (name: string) => {
      if (!(name in imports)) throw new Error(`Unmocked import ${name}`); return imports[name];
    }, BigInt, console });
  return () => exports.POST(new Request('http://local/resend', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: '1' }) });
}
test('direct POST: unauthorized denied before lookup; unsafe/legacy categories return 409 with zero admission/POST', async () => {
  let reads = 0;
  const blocked = { insw_tracking_log: { findFirst: async () => { reads++; throw new Error('must not read'); } } };
  expect((await route(blocked, false)()).status).toBe(403); expect(reads).toBe(0);
  for (const reasonCode of ['MISSING_ITEM_VALIDATION', 'BUSINESS_VALIDATION_FAILURE', 'DUPLICATE_POSSIBILITY',
    'AUTHORIZATION_FAILURE', 'UNRECOGNIZED_CODE_02', 'REQUEST_CANCELLED', 'TEMPORARY_NETWORK_FAILURE']) {
    const mock = resendDb({ ...evidence, reasonCode });
    const db = { ...mock.db, insw_tracking_log: { findFirst: async ({ where }: any) => {
      expect(where.company_code).toBe(1370); return { transaction_type: 'incoming' };
    } } };
    expect((await route(db)()).status).toBe(409); expect(mock.events).not.toContain('insert');
  }
  for (const transaction_type of ['scrap_in', 'scrap_out', 'capital_goods_out']) {
    expect((await route({ insw_tracking_log: { findFirst: async () => ({ transaction_type }) } })()).status).toBe(409);
  }
});

for (const [status, response, expected] of [
  [429, rate, 'READY'], [429, { message: 'API rate limit exceeded' }, 'READY'],
  [429, 'API rate limit exceeded', 'READY'], [502, { status: false, message: 'Bad Gateway' }, 'HELD'],
  [400, { status: false, code: '02', message: 'data barang ITEM tidak ada' }, 'HELD'],
  [400, { status: false, code: '02', message: 'data belum diproses' }, 'HELD'],
  [401, { message: 'Unauthorized' }, 'FAILED'],
] as const) test(`finalizer raw HTTP ${status}/${typeof response === 'string' ? response : JSON.stringify(response)}: ${expected}, no implicit second POST`, async () => {
  const frozen = freezePayload(payload);
  const job = { id: 'q', attemptId: 'a', company_code: 1370, operation: 'INCOMING', intent: 'SOURCE_COMMIT', source_log_id: null,
    source_revision: 'ACCEPTED_WMS_ID', business_date: facts.business_date, identity_key: identity, wms_reference: 'DOC',
    frozen_payload: payload, payload_sha256: frozen.sha256, retry_index: 0, max_auto_retry_snapshot: 10 } as any;
  const updates: any[] = [], inserts: any[] = [];
  const tx: any = { $queryRaw: async (sql: any) => sql.join('').includes('insw_dispatch_gate')
    ? [{ busy_attempt_id: 'a', last_started_at: null, prior_interval_ms: null }] : [{ tail_key: BigInt(1) }],
    $executeRaw: async (sql: any, ...values: any[]) => { if (sql.join('').includes('INSERT INTO insw_tracking_log')) inserts.push(values); return 1; },
    insw_queue_attempt: { findUniqueOrThrow: async () => ({ id: 'a', owner_token: 'owner', queue_id: 'q', retry_index: 0 }), update: async () => ({}) },
    insw_queue_cycle: { findUniqueOrThrow: async () => ({ ...job, status: 'CLAIMED', owner_token: 'owner' }),
      update: async (args: any) => { updates.push(args.data); } },
    insw_tracking_log: { findMany: async () => [] } };
  const db = { ...tx, $queryRaw: async () => [{ id: 1, business_date: new Date(facts.business_date) }], $transaction: async (fn: any) => fn(tx) };
  const finalize = await prepareWmsFinalizer(db as any, 'owner', job, { endpointUrl: 'https://example.invalid/transaction' }, 'INCOMING');
  let requests = 0;
  const outcome = await executeFrozenRequest({ payload, sha256: frozen.sha256, timeoutMs: 100, captureResponse: true,
    request: async () => { requests++; return new Response(typeof response === 'string' ? response : JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } }); } });
  await finalize(outcome, Date.now());
  expect(requests).toBe(1); expect(updates.at(-1).status).toBe(expected);
  const metadata = JSON.parse(inserts[0].at(-1));
  expect(metadata.providerStatus).toBe(typeof response !== 'string' && 'status' in response && response.status === false ? false : null);
  expect(inserts[0].some((v: any) => typeof v === 'string' && v.includes(typeof response === 'string' ? response : response.message))).toBe(true);
  if (status === 401) expect(updates.at(-1).delivery_state).toBe('POSSIBLY_STARTED');
  // A locally manufactured normalized false cannot replace raw provenance.
  const contradictory = { ...outcome, classification: classifyResponse(429, rate, payload), httpCode: 429,
    responseEvidence: { state: 'COMPLETE' as const, raw: '{}', bytes: 2, contentType: 'application/json' } };
  const freshFinalize = await prepareWmsFinalizer(db as any, 'owner', job, { endpointUrl: 'https://example.invalid/transaction' }, 'INCOMING');
  await expect(freshFinalize(contradictory, Date.now())).rejects.toThrow('CONTRADICTORY_OUTCOME_EVIDENCE');
  expect(requests).toBe(1);
});

test('direct POST: approved exhausted rate limit queues once; caller cancellation never invokes request', async () => {
  const mock = resendDb();
  const db = { ...mock.db, insw_tracking_log: { findFirst: async () => ({ transaction_type: 'incoming' }) } };
  expect((await route(db)()).status).toBe(202);
  expect((await route(db)()).status).toBe(409);
  expect(mock.events.filter(e => e === 'insert')).toHaveLength(1);
  const controller = new AbortController(); controller.abort();
  let requests = 0;
  const outcome = await executeFrozenRequest({ payload, sha256: freezePayload(payload).sha256, timeoutMs: 100,
    signal: controller.signal, request: async () => { requests++; throw new Error('must not invoke'); } });
  expect(requests).toBe(0); expect(outcome.delivery).toBe('NOT_STARTED');
  expect(outcome.classification.retryCandidate).toBe(false);
});

test('unknown 02 with HTTP 200/status:true cannot override classification into transport success', async () => {
  const outcome = await executeFrozenRequest({ payload, sha256: freezePayload(payload).sha256, timeoutMs: 100,
    request: async () => new Response(JSON.stringify({ status: true, code: '02', message: 'unreviewed' })) });
  expect(outcome).toMatchObject({ delivery: 'POSSIBLY_STARTED', errorClass: 'INVALID_RESPONSE', classification: { kind: 'UNKNOWN' } });
});
