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
import { assertNoConflictingBusinessReference, SourceAdmissionConflict } from '../lib/insw-queue/incoming-handoff';

const connect = net.Socket.prototype.connect;
const fetch = globalThis.fetch;
test.beforeAll(() => {
  net.Socket.prototype.connect = (() => { throw new Error('STAGE_A_NO_NETWORK'); }) as typeof connect;
  globalThis.fetch = async () => { throw new Error('STAGE_A_NO_NETWORK'); };
});
test.afterAll(() => { net.Socket.prototype.connect = connect; globalThis.fetch = fetch; });
const evidence = { classification: 'TRANSIENT_FAILURE', reasonCode: 'RATE_LIMIT_REJECTION',
  responseEvidence: 'COMPLETE', providerStatus: false, providerMessage: 'API rate limit exceeded', httpCode: 429 };
const payload = { data: [{ kdKegiatan: '30', dokumenKegiatan: [{ nomorDokKegiatan: 'DOC', barangTransaksi: [{ kdBarang: 'ITEM' }] }] }] };
const cycle = { status: 'FAILED', delivery_state: 'KNOWN_FAILURE', retry_index: 10,
  max_auto_retry_snapshot: 10, owner_token: null, lease_until: null, frozen_payload: payload, payload_sha256: freezePayload(payload).sha256 } as const;
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
  const statesDb = { $queryRaw: async (query: any) => {
    calls++;
    expect(query.sql).toContain('conflict.company_code = q.company_code AND conflict.operation = q.operation');
    expect(query.sql).toContain('conflict.wms_reference = q.wms_reference AND conflict.identity_key <> q.identity_key');
    expect(query.sql).toContain('original.company_code =');
    expect(query.sql).toContain('latest.company_code =');
    expect(query.sql).toContain('q.wms_reference IS NOT NULL AND q.wms_reference');
    expect(query.values).toContain(1370);
    // IDs are deduplicated, parameterized, and no raw provider body is fetched.
    expect(query.values.filter((v: unknown) => v === '00000000-0000-4000-8000-000000000001')).toHaveLength(1);
    expect(query.sql).not.toContain('frozen_payload');
    expect(query.sql).not.toContain('insw_response');
    return [];
  } } as any;
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

test('A28: linked conflict overrides each normal lifecycle; stored results and missing-start uncertainty survive', async () => {
  for (const status of ['READY', 'CLAIMED', 'FAILED', 'SUCCEEDED', 'REMOTE_SUCCEEDED', 'HELD']) {
    const state = { ...cycle, id: 'q', status, stable_reference_conflict: true,
      retry_index: 0, attempt: { id: 'a', started_at: null }, attempts_started: 0 } as any;
    let calls = 0;
    const db = { $queryRaw: async () => { calls++; return [{ original_id: 'q', state }]; } } as any;
    const selected = (await currentQueueStates(db, 1370, ['00000000-0000-4000-8000-000000000001'])).get('q');
    expect(calls).toBe(1);
    for (const [insw_status, recorded] of [['FAILED', 'Failed'], ['PENDING', 'Not Recorded'],
      ['SUCCESS', 'Success'], ['NO_ATTEMPT_LOG', 'Not Recorded']]) {
      const row = { insw_status, current_queue: selected };
      expect(transmissionStatus(row).label).toBe('On Hold');
      expect(recordedResult(row).label).toBe(recorded);
    }
    expect(selected?.status).toBe(status); // Projection never rewrites the stored state.
    const missingTracking = { insw_status: 'NO_ATTEMPT_LOG', current_queue: { ...state, attempt: null } };
    expect(recordedResult(missingTracking).label).toBe('Not Recorded');
    expect(transmissionStatus(missingTracking).label).toBe('On Hold');
    expect(transmissionStatus({ insw_status: 'FAILED', current_queue: { ...state, provenance: 'SIMULATED_REMOTE_REJECTION' } }).explanation)
      .toContain('Conflicting queue identities');
  }
});

// Exercise the existing authoritative reference fence with in-memory rows.
// The query-shape checks above pin the read projection to that same predicate;
// these fixtures do not execute PostgreSQL or certify a query plan.
for (const variant of ['different identity', 'same identity successor', 'recreated WMS source',
  'different company', 'different operation', 'different reference'] as const) {
  test(`A28 reference semantics and presentation: ${variant}`, async () => {
    const scope = { companyCode: 1370, operation: 'PRODUCTION_OUTPUT' as const, wmsReference: 'DOC' };
    const key = canonicalIdentity({ kind: 'WMS_REFERENCE', ...scope, reference: scope.wmsReference,
      revision: 'ACCEPTED_WMS_ID', businessDate: '2026-11-10' }).key;
    const otherKey = canonicalIdentity({ kind: 'WMS_REFERENCE', ...scope, reference: scope.wmsReference,
      revision: 'ACCEPTED_WMS_ID', businessDate: '2026-11-09' }).key;
    const row = { company_code: variant === 'different company' ? 1380 : 1370,
      operation: variant === 'different operation' ? 'INCOMING' : 'PRODUCTION_OUTPUT',
      wms_reference: variant === 'different reference' ? 'OTHER' : 'DOC',
      identity_key: variant === 'same identity successor' || variant === 'recreated WMS source' ? key : otherKey };
    const db = { insw_queue_cycle: { findFirst: async ({ where }: any) =>
      row.company_code === where.company_code && row.operation === where.operation
        && row.wms_reference === where.wms_reference && row.identity_key !== where.identity_key.not ? { id: 'other' } : null } } as any;
    const conflict = await assertNoConflictingBusinessReference(db, scope, key)
      .then(() => false, error => { expect(error).toBeInstanceOf(SourceAdmissionConflict); return true; });
    expect(conflict).toBe(variant === 'different identity');
    const current_queue = { ...cycle, id: 'q', status: 'READY', retry_index: 0, stable_reference_conflict: conflict } as any;
    expect(transmissionStatus({ insw_status: 'FAILED', current_queue }).label).toBe(conflict ? 'On Hold' : 'Waiting');
    expect(recordedResult({ insw_status: 'FAILED', current_queue }).label).toBe('Failed');
  });
}

function resendDb(metadata: any = evidence) {
  const events: string[] = [];
  const queries: any[] = [];
  let latest = 'parent';
  const parent: any = { ...cycle, id: 'parent', operation: 'INCOMING', wms_reference: 'DOC', identity_key: identity, cycle: 1, payload_sha256: cycle.payload_sha256 };
  const tx = {
    insw_tracking_log: { findFirst: async () => ({ metadata, queue_attempt: { queue: parent } }),
      update: async (_args: any) => { events.push('audit'); } },
    insw_queue_cycle: { findFirst: async () => null },
    insw_transmission_policy: { findUnique: async () => ({ min_processing_interval_ms: 3600, max_auto_retry: 10, version: 1 }) },
    $executeRaw: async () => { events.push('supersession-audit'); return 1; },
    $queryRaw: async (query: any, ...values: any[]) => {
      const sql = Array.isArray(query) ? query.join('?') : query.sql;
      queries.push(query);
      if (sql.includes('pg_advisory')) { events.push(String(values[0])); return []; }
      if (sql.includes('FOR UPDATE')) return [{ id: latest }];
      if (sql.includes('UPDATE insw_queue_cycle')) {
        if (parent.status !== 'HELD') return [];
        parent.status = 'SUPERSEDED'; events.push('retire'); return [{ id: parent.id }];
      }
      if (sql.includes('INSERT INTO')) { events.push('insert'); latest = 'successor'; return [{ id: latest }]; }
      return [{ ...parent, id: BigInt(1), metadata }];
    },
  };
  const db = { ...tx, $transaction: async (fn: any) => {
    const before = structuredClone(parent); const previousLatest = latest;
    try { return await fn(tx); } catch (error) { Object.assign(parent, before); latest = previousLatest; throw error; }
  } } as any;
  return { db, tx, events, queries, parent };
}
test('admission: stable reference before identity/row lock; frozen copy; repeated click cannot create a second successor', async () => {
  const mock = resendDb();
  expect(await coordination.resendWmsLog(mock.db, 1370, BigInt(1), 'operator', 'reviewed', true)).toMatchObject({ status: 'accepted' });
  expect(mock.events[0]).toContain('insw-source-reference'); expect(mock.events[1]).toBe(identity);
  expect(mock.events.filter(e => e === 'insert')).toHaveLength(1);
  const insert = mock.queries.find(q => Array.isArray(q) && q.join('').includes('INSERT INTO'));
  expect(insert.join('')).toContain('frozen_payload, payload_sha256');
  await expect(coordination.resendWmsLog(mock.db, 1370, BigInt(1), 'operator', 'again', true)).rejects.toThrow('Manual Resend unavailable');
  expect(mock.events.filter(e => e === 'insert')).toHaveLength(1);
});
test('worker parent: category, frozen hash, history/identity and authorized successor are rechecked', async () => {
  for (const invalid of [false, true]) {
    const mock = resendDb({ ...evidence, ...(invalid ? { reasonCode: 'AUTHORIZATION_FAILURE' } : {}), manual_resend: { queue_id: 'successor' } });
    const successor = { id: 'successor', operation: 'INCOMING', source_log_id: BigInt(1), identity_key: identity, cycle: 2,
      payload_sha256: cycle.payload_sha256, company_code: 1370 } as any;
    if (invalid) await expect(coordination.verifyWmsManualCycle(mock.db, successor)).rejects.toThrow('INVALID_WMS_MANUAL_SUCCESSOR');
    else {
      await coordination.verifyWmsManualCycle(mock.db, successor);
      await expect(coordination.verifyWmsManualCycle(mock.db, { ...successor, payload_sha256: 'changed' })).rejects.toThrow('INVALID_WMS_MANUAL_SUCCESSOR');
      mock.db.$queryRaw = async () => [];
      await expect(coordination.verifyWmsManualCycle(mock.db, successor)).rejects.toThrow('INVALID_WMS_MANUAL_SUCCESSOR');
    }
  }
});

function route(db: any, authenticated = true, body: unknown = { reason: 'reviewed', commitment: true }) {
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
  return () => exports.POST(new Request('http://local/resend', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: '1' }) });
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
  [400, { status: false, code: '02', message: 'data barang ITEM tidak ada' }, 'FAILED'],
  [400, { status: false, code: '02', message: 'data belum diproses' }, 'HELD'],
  [401, { message: 'Unauthorized' }, 'HELD'],
  [403, { status: false, message: 'Unauthorized' }, 'FAILED'],
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
  if (expected === 'FAILED' && typeof response !== 'string' && 'status' in response && response.status === false) {
    expect(updates.at(-1).delivery_state).toBe('KNOWN_FAILURE');
  }
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

const manualCategories = [
  ['A14', { classification: 'PERMANENT_FAILURE', reasonCode: 'MISSING_ITEM_VALIDATION', httpCode: 400, providerStatus: false }],
  // A15 has no reviewed literal classifier: use its existing unknown-02 bucket.
  ['A15', { classification: 'UNKNOWN', reasonCode: 'UNRECOGNIZED_CODE_02', httpCode: 400, providerStatus: false }],
  ['A17/400', { classification: 'UNKNOWN', reasonCode: 'UNCLASSIFIED_RESPONSE', httpCode: 400, providerStatus: false }],
  ['A17/422', { classification: 'UNKNOWN', reasonCode: 'UNCLASSIFIED_RESPONSE', httpCode: 422, providerStatus: false }],
  ['A18/401', { classification: 'PERMANENT_FAILURE', reasonCode: 'AUTHORIZATION_FAILURE', httpCode: 401, providerStatus: null }],
  ['A18/403', { classification: 'PERMANENT_FAILURE', reasonCode: 'AUTHORIZATION_FAILURE', httpCode: 403, providerStatus: false }],
  ['A19/malformed', { classification: 'UNKNOWN', reasonCode: 'MALFORMED_RESPONSE', httpCode: 200, providerStatus: null }],
  ['A19/contradictory', { classification: 'UNKNOWN', reasonCode: 'CONTRADICTORY_RESPONSE', httpCode: 400, providerStatus: true }],
] as const;
for (const [category, details] of manualCategories) test(`${category}: terminal manual policy, UI projection, direct API and worker share gates`, async () => {
  const metadata = { ...details, responseEvidence: 'COMPLETE' };
  const parent = { ...cycle, retry_index: 0 }; // Remaining numeric budget is not an automatic retry entitlement.
  expect(coordination.wmsResendEligible(parent, metadata)).toBe(true);
  const projection = await logResendEligibility({ $queryRaw: async () => [{ id: BigInt(1), ...parent, metadata }] } as any,
    1370, [{ id: '1', transaction_type: 'incoming' }]);
  expect(projection.has('1')).toBe(true);
  for (const patch of [{ status: 'READY' }, { status: 'CLAIMED' },
    { delivery_state: 'POSSIBLY_STARTED' }, { delivery_state: 'KNOWN_SUCCESS' }, { delivery_state: 'NOT_STARTED' },
    { owner_token: 'owner' }, { lease_until: new Date() }]) {
    expect(coordination.wmsResendEligible({ ...parent, ...patch } as any, metadata)).toBe(false);
  }
  const h = resendDb(metadata);
  Object.assign(h.parent, parent);
  const original = JSON.stringify(metadata);
  const apiDb = { ...h.db, insw_tracking_log: { findFirst: async () => ({ transaction_type: 'incoming' }) } };
  expect((await route(apiDb)()).status).toBe(202);
  expect(JSON.stringify(metadata)).toBe(original); // No ambiguity reclassification.
  expect(h.events.filter(e => e === 'insert')).toHaveLength(1);
  await coordination.verifyWmsManualCycle(resendDb({ ...metadata, manual_resend: { queue_id: 'successor', commitment: true } }).db,
    { id: 'successor', operation: 'INCOMING', source_log_id: BigInt(1), identity_key: identity,
      cycle: 2, payload_sha256: cycle.payload_sha256, company_code: 1370 } as any);
});

test('forged API requires a bounded reason and explicit boolean acknowledgement; no admission side effects', async () => {
  for (const body of [{}, null, { reason: 'reviewed' }, { reason: 'reviewed', commitment: 'true' },
    { commitment: true }, { reason: '', commitment: true }, { reason: ' '.repeat(2), commitment: true },
    { reason: 'x'.repeat(501), commitment: true }, { reason: 'bad\nreason', commitment: true }]) {
    const h = resendDb();
    const db = { ...h.db, insw_tracking_log: { findFirst: async () => ({ transaction_type: 'incoming' }) } };
    expect((await route(db, true, body)()).status).toBe(400);
    expect(h.events).toEqual([]);
  }
  const h = resendDb();
  await expect(coordination.resendWmsLog(h.db, 1370, BigInt(1), 'op', 'reviewed')).rejects.toThrow('acknowledgement');
  expect(h.events).toEqual([]);
});

test('admission audits commitment and preserves frozen parent/history; simultaneous clicks serialize once', async () => {
  const h = resendDb({ classification: 'PERMANENT_FAILURE', reasonCode: 'AUTHORIZATION_FAILURE',
    responseEvidence: 'COMPLETE', httpCode: 403 });
  const parent = structuredClone(h.parent);
  let audit: any;
  h.db.insw_tracking_log.update = async ({ data }: any) => { audit = data.metadata; };
  // Model the existing transactional gate/reference/identity locks, not a DB race proof.
  const transaction = h.db.$transaction;
  let tail = Promise.resolve();
  h.db.$transaction = (fn: any) => {
    const result = tail.then(() => transaction(fn));
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const outcomes = await Promise.allSettled([1, 2].map(() => coordination.resendWmsLog(h.db, 1370, BigInt(1), 'op', 'reviewed', true)));
  expect(outcomes.map(o => o.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(h.events.filter(e => e === 'insert')).toHaveLength(1);
  expect(h.parent).toEqual(parent);
  expect(audit).toMatchObject({ classification: 'PERMANENT_FAILURE', reasonCode: 'AUTHORIZATION_FAILURE',
    manual_resend: { operator: 'op', reason: 'reviewed', commitment: true, queue_id: 'successor', prior_queue_id: 'parent' } });
  expect(audit.manual_resend.authorized_at).toEqual(expect.any(String));
  const gate = h.queries.find(q => Array.isArray(q) && q.join('').includes('insw_dispatch_gate'));
  expect(gate.join('')).toContain('FOR UPDATE');
});

test('batched SQL preserves exact history, known success, completed attempt, ownership and source fences', async () => {
  const queries: any[] = [];
  const db = { $queryRaw: async (sql: any) => { queries.push(sql); return []; } } as any;
  await coordination.wmsLogResendEligibility(db, 1370, [BigInt(1), BigInt(2)]);
  const sql = queries[0].sql;
  for (const guard of ['a.completed_at IS NOT NULL', 'unfinished.completed_at IS NULL', "history.delivery_state = 'KNOWN_SUCCESS'",
    'insw_manual_enqueue_gate_safe(p.identity_key,', 'target_owned.owner_token IS NOT NULL',
    'target_owned.lease_until IS NOT NULL', 'newer.cycle > p.cycle',
    'newer_attempt.retry_index > a.retry_index', "conflict.insw_status = 'SUCCESS'", 'p.company_code = l.company_code',
    'l.transaction_type = lower(p.operation::text)', 'g.id = l.transaction_id', 'jsonb_typeof(p.frozen_payload)',
    'conflict.identity_key <> p.identity_key']) expect(sql).toContain(guard);
  await coordination.wmsLogResendEligibility(db, 1370, [BigInt(1)], 'successor');
  expect(sql).not.toContain('gate.owner_token IS NULL'); // Global ownership alone is no longer a veto.
  expect(queries[1].sql).toContain('insw_manual_enqueue_gate_safe(p.identity_key,');
  expect(queries[1].sql).not.toContain('gate.owner_token IS NULL'); // Exclude only the admitted successor.
  expect(queries[1].sql).toContain('history.id <>');
  expect(queries[1].values).toContain('successor');
});

test('A21 unfinished/crashed/no-log/no-source cannot be recovered or fabricated by Resend', async () => {
  const metadata = { classification: 'UNKNOWN', reasonCode: 'NOT_STARTED', responseEvidence: 'UNAVAILABLE' };
  for (const state of [cycle, { ...cycle, status: 'HELD', delivery_state: 'NOT_STARTED' },
    { ...cycle, status: 'CLAIMED', delivery_state: 'POSSIBLY_STARTED', owner_token: 'owner' }]) {
    expect(coordination.wmsResendEligible(state as any, metadata)).toBe(false);
  }
  const db = { $transaction: async (fn: any) => fn({ insw_tracking_log: { findFirst: async () => null } }) } as any;
  await expect(coordination.resendWmsLog(db, 1370, BigInt(1), 'op', 'reviewed', true)).rejects.toThrow('queue attempt required');
  // A HELD parent blocks another active identity even if an invocation has ended.
  const migration = readFileSync('prisma/migrations/20261022000000_insw_queue_foundation/migration.sql', 'utf8');
  expect(migration).toContain("WHERE status IN ('READY', 'CLAIMED', 'REMOTE_SUCCEEDED', 'HELD')");
  expect(migration).toContain("status <> 'FAILED' OR delivery_state = 'KNOWN_FAILURE'");
});

test('direct API rejects when authoritative eligibility no longer passes; no successor is created', async () => {
  const h = resendDb({ classification: 'PERMANENT_FAILURE', reasonCode: 'AUTHORIZATION_FAILURE', httpCode: 403, responseEvidence: 'COMPLETE' });
  const query = h.tx.$queryRaw;
  h.tx.$queryRaw = async (sql: any, ...values: any[]) => {
    // SQL guards are asserted above; execution against PostgreSQL remains pending.
    if (sql.sql?.includes('SELECT l.id')) return [];
    return query(sql, ...values);
  };
  const db = { ...h.db, insw_tracking_log: { findFirst: async () => ({ transaction_type: 'incoming' }) } };
  expect((await route(db)()).status).toBe(409);
  expect(h.events).not.toContain('insert');
});

for (const [category, details] of [...manualCategories, ['A21/pre-invocation-drained', {
  classification: 'UNKNOWN', reasonCode: 'NOT_STARTED', responseEvidence: 'UNAVAILABLE',
  adapter: 'WMS_QUEUE_FINALIZER', phase: 'PREFLIGHT',
}]] as const) test(`${category}: inactive HELD supersession preserves uncertainty, linked audit and worker preflight`, async () => {
  const metadata: any = { responseEvidence: 'COMPLETE', ...details };
  const h = resendDb(metadata);
  Object.assign(h.parent, { status: 'HELD', retry_index: 0, hold_reason: 'DELIVERY_UNKNOWN',
    delivery_state: category.startsWith('A21') ? 'NOT_STARTED' : 'POSSIBLY_STARTED' });
  const original = structuredClone(h.parent);
  expect(coordination.wmsResendEligible(h.parent, metadata)).toBe(true);
  expect((await logResendEligibility(h.db, 1370, [{ id: '1', transaction_type: 'incoming' }])).has('1')).toBe(true);
  let audit: any;
  h.tx.insw_tracking_log.update = async ({ data }: any) => { audit = data.metadata; metadata.manual_resend = audit.manual_resend; };
  const db = { ...h.db, insw_tracking_log: { findFirst: async () => ({ transaction_type: 'incoming' }) } };
  expect((await route(db)()).status).toBe(202);
  expect(h.events.filter(e => e === 'retire')).toHaveLength(1);
  expect(h.events.filter(e => e === 'insert')).toHaveLength(1);
  expect(h.events).toContain('supersession-audit');
  expect(h.parent).toEqual({ ...original, status: 'SUPERSEDED' }); // Double does not manufacture an attempt completion.
  expect(audit).toMatchObject({ ...details, manual_resend: { prior_status: 'HELD', supersession: true,
    commitment: true, prior_queue_id: 'parent', queue_id: 'successor', operator: 'op', reason: 'reviewed' } });
  expect(coordination.wmsResendEligible(h.parent, metadata)).toBe(false); // No readmission of a retired parent.
  await coordination.verifyWmsManualCycle(h.db, { id: 'successor', operation: 'INCOMING', source_log_id: BigInt(1),
    identity_key: identity, cycle: 2, payload_sha256: original.payload_sha256, company_code: 1370 } as any);
  await expect(coordination.resendWmsLog(h.db, 1370, BigInt(1), 'op', 'again', true)).rejects.toThrow('Manual Resend unavailable');
});

test('A21 local evidence is narrow: missing finalizer attestation and unfinished/owned work stay blocked', async () => {
  const held: any = { ...cycle, status: 'HELD', delivery_state: 'NOT_STARTED' };
  const evidence = { classification: 'UNKNOWN', reasonCode: 'NOT_STARTED', responseEvidence: 'UNAVAILABLE',
    adapter: 'WMS_QUEUE_FINALIZER', phase: 'PREFLIGHT' };
  for (const patch of [{ adapter: undefined }, { phase: 'REQUEST' }, { reasonCode: 'LOCAL_DATABASE_PREPARATION_FAILURE' }]) {
    expect(coordination.wmsResendEligible(held, { ...evidence, ...patch })).toBe(false);
  }
  for (const patch of [{ owner_token: 'old-owner' }, { lease_until: new Date(0) }, { delivery_state: 'KNOWN_SUCCESS' },
    { status: 'READY' }, { status: 'CLAIMED' }]) {
    expect(coordination.wmsResendEligible({ ...held, ...patch }, evidence)).toBe(false);
  }
  // No weakening of completed_at: SQL must exclude all unfinished history,
  // including recovered A21 lacking a log. These are query-shape assertions.
  let query: any;
  await coordination.wmsLogResendEligibility({ $queryRaw: async (q: any) => { query = q; return []; } } as any, 1370, [BigInt(1)]);
  expect(query.sql).toContain('a.completed_at IS NOT NULL');
  expect(query.sql).toContain('unfinished.completed_at IS NULL');
  expect(query.sql).toContain('l.insw_request_payload = p.frozen_payload');
});

test('projection rejects missing/corrupt frozen hashes before HELD can be advertised or admitted', async () => {
  const metadata = { classification: 'UNKNOWN', reasonCode: 'MALFORMED_RESPONSE', responseEvidence: 'COMPLETE' };
  for (const patch of [{ frozen_payload: null }, { frozen_payload: {} }, { payload_sha256: 'x'.repeat(64) },
    { payload_sha256: 'a'.repeat(64) }]) {
    const h = resendDb(metadata);
    Object.assign(h.parent, { status: 'HELD', delivery_state: 'POSSIBLY_STARTED' }, patch);
    expect((await coordination.wmsLogResendEligibility(h.db, 1370, [BigInt(1)])).size).toBe(0);
    await expect(coordination.resendWmsLog(h.db, 1370, BigInt(1), 'op', 'reviewed', true)).rejects.toThrow('Manual Resend unavailable');
    expect(h.events).not.toContain('retire'); expect(h.events).not.toContain('insert');
  }
});

test('held transient rate-limit work never bypasses automatic retry; worker requires durable retirement linkage', async () => {
  expect(coordination.wmsResendEligible({ ...cycle, status: 'HELD' } as any, evidence)).toBe(false);
  const h = resendDb({ classification: 'UNKNOWN', reasonCode: 'MALFORMED_RESPONSE', responseEvidence: 'COMPLETE',
    manual_resend: { queue_id: 'successor', commitment: true } });
  Object.assign(h.parent, { status: 'HELD', delivery_state: 'POSSIBLY_STARTED' });
  const successor: any = { id: 'successor', operation: 'INCOMING', source_log_id: BigInt(1), identity_key: identity,
    cycle: 2, payload_sha256: cycle.payload_sha256, company_code: 1370 };
  await expect(coordination.verifyWmsManualCycle(h.db, successor)).rejects.toThrow('INVALID_WMS_MANUAL_SUCCESSOR');
  h.parent.status = 'SUPERSEDED';
  h.db.$queryRaw = async (q: any) => {
    expect(q.sql).toContain('retired.successor_queue_id =');
    expect(q.sql).toContain('retired.source_log_id = l.id AND retired.commitment');
    expect(q.sql).not.toContain("OR p.status = 'HELD'");
    return []; // Missing durable audit or changed authoritative history.
  };
  await expect(coordination.verifyWmsManualCycle(h.db, successor)).rejects.toThrow('INVALID_WMS_MANUAL_SUCCESSOR');
});

test('held double admission serializes once in model; worker/recovery winning admission blocks without retirement', async () => {
  const metadata = { classification: 'UNKNOWN', reasonCode: 'MALFORMED_RESPONSE', responseEvidence: 'COMPLETE' };
  const h = resendDb(metadata);
  Object.assign(h.parent, { status: 'HELD', delivery_state: 'POSSIBLY_STARTED' });
  const run = h.db.$transaction;
  let tail = Promise.resolve();
  h.db.$transaction = (fn: any) => {
    const next = tail.then(() => run(fn)); tail = next.catch(() => undefined); return next;
  };
  const results = await Promise.allSettled([1, 2].map(() => coordination.resendWmsLog(h.db, 1370, BigInt(1), 'op', 'reviewed', true)));
  expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(h.events.filter(e => e === 'insert')).toHaveLength(1);
  const blocked = resendDb(metadata);
  Object.assign(blocked.parent, { status: 'HELD', delivery_state: 'POSSIBLY_STARTED' });
  const query = blocked.tx.$queryRaw;
  blocked.tx.$queryRaw = async (q: any, ...args: any[]) => q.sql?.includes('SELECT l.id') ? [] : query(q, ...args);
  await expect(coordination.resendWmsLog(blocked.db, 1370, BigInt(1), 'op', 'reviewed', true)).rejects.toThrow('Manual Resend unavailable');
  expect(blocked.events).not.toContain('retire');
});

for (const failureAt of ['successor', 'durable-audit', 'log-audit']) test(`simulated transaction rollback at ${failureAt} restores HELD admission`, async () => {
  const h = resendDb({ classification: 'UNKNOWN', reasonCode: 'MALFORMED_RESPONSE', responseEvidence: 'COMPLETE' });
  Object.assign(h.parent, { status: 'HELD', delivery_state: 'POSSIBLY_STARTED' });
  const before = structuredClone(h.parent);
  const query = h.tx.$queryRaw; const execute = h.tx.$executeRaw; const update = h.tx.insw_tracking_log.update;
  h.tx.$queryRaw = async (q: any, ...args: any[]) => {
    if (failureAt === 'successor' && Array.isArray(q) && q.join('').includes('INSERT INTO insw_queue_cycle')) throw new Error('SIMULATED_DB_ERROR');
    return query(q, ...args);
  };
  h.tx.$executeRaw = async () => { if (failureAt === 'durable-audit') throw new Error('SIMULATED_DB_ERROR'); return execute(); };
  h.tx.insw_tracking_log.update = async () => { if (failureAt === 'log-audit') throw new Error('SIMULATED_DB_ERROR'); return update({}); };
  await expect(coordination.resendWmsLog(h.db, 1370, BigInt(1), 'op', 'reviewed', true)).rejects.toThrow('SIMULATED_DB_ERROR');
  expect(h.parent).toEqual(before);
  h.tx.$queryRaw = query; h.tx.$executeRaw = execute; h.tx.insw_tracking_log.update = update;
  expect(await coordination.resendWmsLog(h.db, 1370, BigInt(1), 'op', 'reviewed', true)).toMatchObject({ status: 'accepted' });
});

// SQL is inspected here, never executed against a configured database. Positive
// transaction doubles prove application flow, not PostgreSQL predicate/lock behavior.
for (const status of ['FAILED', 'HELD']) for (const worker of ['idle owner', 'unrelated busy']) {
  test(`online enqueue application flow: ${status}, ${worker} (SQL result double)`, async () => {
    const metadata = { classification: 'PERMANENT_FAILURE', reasonCode: 'AUTHORIZATION_FAILURE',
      responseEvidence: 'COMPLETE', httpCode: 403 };
    const h = resendDb(metadata);
    const gate = Object.freeze({ id: 1, owner_token: 'sticky-worker', lease_until: new Date(0),
      process_identity: { host: 'fixture' }, busy_attempt_id: worker === 'unrelated busy' ? 'other-attempt' : null });
    const query = h.tx.$queryRaw;
    h.tx.$queryRaw = async (q: any, ...values: any[]) => Array.isArray(q) && q.join('').includes('FROM insw_dispatch_gate')
      ? [gate] : query(q, ...values);
    Object.assign(h.parent, { status, delivery_state: status === 'HELD' ? 'POSSIBLY_STARTED' : 'KNOWN_FAILURE' });
    expect((await logResendEligibility(h.db, 1370, [{ id: '1', transaction_type: 'incoming' }])).has('1')).toBe(true);
    const result = await coordination.resendWmsLog(h.db, 1370, BigInt(1), 'op', 'duplicate risk reviewed', true);
    expect(result).toMatchObject({ status: 'accepted', queue_id: 'successor' });
    expect(result.message).toContain('not yet delivered');
    expect(h.events.filter(e => e === 'insert')).toHaveLength(1);
    expect(h.events.includes('retire')).toBe(status === 'HELD');
    expect(h.events.includes('supersession-audit')).toBe(status === 'HELD');
    for (const query of h.queries) {
      const sql = Array.isArray(query) ? query.join('') : query.sql;
      expect(sql).not.toMatch(/UPDATE insw_dispatch_gate/);
    }
  });
}
test('missing gate blocks before reference/identity locks or writes', async () => {
  const h = resendDb();
  const original = h.tx.$queryRaw;
  h.tx.$queryRaw = async (q: any, ...values: any[]) => Array.isArray(q) && q.join('').includes('FROM insw_dispatch_gate')
    ? [] : original(q, ...values);
  await expect(coordination.resendWmsLog(h.db, 1370, BigInt(1), 'op', 'reviewed', true)).rejects.toThrow('dispatch gate missing');
  expect(h.events).toEqual([]);
});
for (const state of ['same-target busy', 'unfinished target', 'target ownership', 'corrupt gate']) {
  test(`stale candidate revalidated before mutation: ${state} (SQL rejection double)`, async () => {
    const h = resendDb();
    expect((await coordination.wmsLogResendEligibility(h.db, 1370, [BigInt(1)])).has('1')).toBe(true);
    const original = h.tx.$queryRaw;
    h.tx.$queryRaw = async (q: any, ...values: any[]) => !Array.isArray(q) && q.sql.includes('insw_manual_enqueue_gate_safe')
      ? [] : original(q, ...values);
    await expect(coordination.resendWmsLog(h.db, 1370, BigInt(1), 'op', 'reviewed', true)).rejects.toThrow('Manual Resend unavailable');
    expect(h.events).not.toContain('insert');
    expect(h.events).not.toContain('retire');
  });
}
test('forward SQL fence preserves immutable/deferred protection and fails closed without waiting in row triggers', () => {
  const sql = readFileSync('prisma/migrations/20261114000000_insw_online_manual_enqueue/migration.sql', 'utf8');
  expect(sql).toContain('CREATE OR REPLACE FUNCTION insw_guard_supersession()');
  expect(sql).toContain('BEFORE UPDATE OF status ON insw_queue_cycle');
  expect(sql).toContain('FOR EACH STATEMENT');
  expect(sql).toContain('FOR UPDATE NOWAIT');
  expect(sql).toContain('pg_try_advisory_xact_lock(hashtextextended(reference_key, 0))');
  expect(sql).toContain('pg_try_advisory_xact_lock(hashtextextended(OLD.identity_key, 0))');
  expect(sql).toContain('a.completed_at IS NULL');
  expect(sql).toContain('q.identity_key = OLD.identity_key');
  expect(sql).toContain('q.identity_key <> target_identity OR q.id = self_successor');
  expect(sql).toContain('a.owner_token = g.owner_token');
  expect(sql).toContain('g.prior_interval_ms >= 3600');
  expect(sql).toContain("current_setting('transaction_isolation') <> 'read committed'");
  expect(sql).toContain('a.completed_at IS NULL AND a.retry_index = q.retry_index');
  expect(sql).not.toMatch(/DROP |DISABLE TRIGGER|UPDATE insw_dispatch_gate|SECURITY DEFINER/);
  const original = readFileSync('prisma/migrations/20261113000100_insw_manual_supersession/migration.sql', 'utf8');
  expect(original).toContain('DEFERRABLE INITIALLY DEFERRED');
  expect(original).toContain('INSW supersession audit is immutable');
});
