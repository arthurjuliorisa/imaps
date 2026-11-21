import { MissingInswUomMappingError } from '../lib/insw-uom-mapping-error';
import { test, expect } from '@playwright/test';
import type { Prisma, PrismaClient } from '@prisma/client';
import net from 'node:net';
import { canonicalIdentity, freezePayload } from '../lib/insw-queue/contracts';
import {
  prepareCountHandoff, prepareProductionOutputHandoff, handoffIncomingInTransaction,
  type PreparedIncomingHandoff, SourceAdmissionConflict,
} from '../lib/insw-queue/incoming-handoff';
import { captureCompletedWmsSource } from '../lib/insw-worker/completed-source-capture';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
import { wmsResendEligible } from '../lib/insw-queue/wms-coordination';

// Fail every attempted socket/fetch, including accidental DB and provider access.
// Only plain in-memory database doubles and the real local conversion boundary run.
const connect = net.Socket.prototype.connect;
const fetch = globalThis.fetch;
test.beforeAll(() => {
  net.Socket.prototype.connect = (() => { throw new Error('C1_NO_NETWORK'); }) as typeof connect;
  globalThis.fetch = async () => { throw new Error('C1_NO_NETWORK'); };
});
test.afterAll(() => { net.Socket.prototype.connect = connect; globalThis.fetch = fetch; });

type Row = Record<string, any>;
const date = '2026-07-22';
function input(operation: 'ADJUSTMENT' | 'STOCK_OPNAME' | 'PRODUCTION_OUTPUT' = 'ADJUSTMENT', sourceId = 32,
  companyCode = 1370, wmsReference = 'AMI0126072200002-01', businessDate = date, revision = 'COMMITTED_SOURCE', qty = 1) {
  const payload = { data: [{ kdKegiatan: operation === 'ADJUSTMENT' ? '33' : operation === 'STOCK_OPNAME' ? '32' : '30',
    dokumenKegiatan: [{ nomorDokKegiatan: wmsReference, tanggalKegiatan: businessDate.split('-').reverse().join('-'),
      namaEntitas: String(companyCode), barangTransaksi: [{ kdKategoriBarang: '1', kdBarang: 'ITEM',
        uraianBarang: 'Item', jumlah: qty, kdSatuan: 'PCE', nilai: 1, dokumen: [] }] }] }] };
  return { operation, sourceId, companyCode, wmsReference, businessDate, revision, payload,
    requestedBy: 'C1-MOCK', authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT' as const };
}
function prepared(i = input()): PreparedIncomingHandoff {
  return i.operation === 'PRODUCTION_OUTPUT' ? prepareProductionOutputHandoff(i, null) : prepareCountHandoff({ ...i, operation: i.operation });
}
function historical(i = input('ADJUSTMENT', 30), status = 'HELD'): Row {
  const identity = canonicalIdentity(i.operation === 'PRODUCTION_OUTPUT'
    ? { kind: 'WMS_REFERENCE', operation: i.operation, companyCode: i.companyCode, reference: i.wmsReference, revision: i.revision, businessDate: i.businessDate }
    : { kind: 'SOURCE_HEADER', operation: i.operation, companyCode: i.companyCode, sourceId: i.sourceId, revision: i.revision, businessDate: i.businessDate });
  return { id: 'old-cycle', company_code: i.companyCode, operation: i.operation, wms_reference: i.wmsReference,
    identity_key: identity.key, status, cycle: 1, intent: 'SOURCE_COMMIT', source_log_id: null,
    payload_sha256: freezePayload(i.payload).sha256, frozen_payload: i.payload, tail_key: BigInt(1), max_auto_retry_snapshot: 10 };
}
function database(rows: Row[] = []) {
  const events: string[] = [];
  const queries: Row[] = [];
  let inserts = 0;
  const tx = {
    $queryRaw: async (parts: TemplateStringsArray, ...values: any[]) => {
      const sql = parts.join('?');
      if (sql.includes('pg_advisory_xact_lock')) { events.push(`lock:${values[0]}`); return []; }
      if (!sql.includes('INSERT INTO insw_queue_cycle')) throw new Error(`Unexpected SQL: ${sql}`);
      inserts++;
      events.push('insert');
      return [{ id: 'new-cycle', cycle: 1, status: 'READY', tail_key: BigInt(2), max_auto_retry_snapshot: 10 }];
    },
    insw_queue_cycle: { findFirst: async ({ where }: any) => {
      queries.push(where); events.push('queue-read');
      return rows.find(r => Object.entries(where).every(([key, value]) =>
        typeof value === 'object' && value !== null ? r[key] !== (value as any).not : r[key] === value)) ?? null;
    } },
    insw_tracking_log: { findFirst: async () => { events.push('legacy-read'); return null; } },
    insw_transmission_policy: { findUnique: async () => ({ min_processing_interval_ms: 3600, max_auto_retry: 10, version: 1 }) },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, events, queries, inserts: () => inserts };
}

for (const status of ['HELD', 'SUCCEEDED', 'READY', 'CLAIMED', 'FAILED', 'REMOTE_SUCCEEDED']) {
  test(`C1-ADJ-01/02: source 30 → 32, historical ${status}, tracking absent`, async () => {
    const row = historical(input('ADJUSTMENT', 30), status);
    const before = JSON.stringify(row, (_, v) => typeof v === 'bigint' ? String(v) : v);
    const db = database([row]);
    const error = await handoffIncomingInTransaction(db.tx, prepared()).catch(e => e);
    expect(error).toBeInstanceOf(SourceAdmissionConflict);
    expect(error.reason).toBe('BUSINESS_REFERENCE_ALREADY_QUEUED');
    expect(error.message).toContain('old-cycle');
    expect(error.message).toContain('1370');
    expect(error.message).toContain('ADJUSTMENT');
    expect(error.message).toContain('AMI0126072200002-01');
    expect(error.message).not.toMatch(/frozen_payload|barangTransaksi/);
    expect(db.inserts()).toBe(0);
    expect(db.events).toHaveLength(3); // reference lock, identity lock, bounded conflict lookup
    expect(db.events[0]).toContain('insw-source-reference');
    expect(db.events[1]).toContain('insw-v1');
    expect(JSON.stringify(row, (_, v) => typeof v === 'bigint' ? String(v) : v)).toBe(before);
  });
}
test('C1-COUNT-01: Stock Opname confirmation/PK recreation is fenced', async () => {
  const db = database([historical(input('STOCK_OPNAME', 30, 1370, 'COUNT', date, 'CONFIRMED:old'))]);
  await expect(handoffIncomingInTransaction(db.tx, prepared(input('STOCK_OPNAME', 32, 1370, 'COUNT', date, 'CONFIRMED:new'))))
    .rejects.toThrow('BUSINESS_REFERENCE_ALREADY_QUEUED');
  expect(db.inserts()).toBe(0);
});
for (const variant of ['company', 'operation', 'reference'] as const) {
  test(`C1-SCOPE-01: distinct ${variant} is admitted`, async () => {
    const db = database([historical()]);
    const i = input(variant === 'operation' ? 'STOCK_OPNAME' : 'ADJUSTMENT', 32,
      variant === 'company' ? 1380 : 1370, variant === 'reference' ? 'NEW' : 'AMI0126072200002-01');
    expect((await handoffIncomingInTransaction(db.tx, prepared(i))).created).toBe(true);
    expect(db.inserts()).toBe(1);
    expect(db.queries).toHaveLength(2);
  });
}
for (const variant of ['date', 'revision', 'payload'] as const) {
  test(`C1-REV-01: changed ${variant} fails closed`, async () => {
    const db = database([historical()]);
    const i = input('ADJUSTMENT', variant === 'payload' ? 30 : 32, 1370, 'AMI0126072200002-01',
      variant === 'date' ? '2026-07-23' : date, variant === 'revision' ? 'NEW_REVISION' : 'COMMITTED_SOURCE', variant === 'payload' ? 2 : 1);
    await expect(handoffIncomingInTransaction(db.tx, prepared(i))).rejects.toThrow('INSW_SOURCE_ADMISSION_CONFLICT');
    expect(db.inserts()).toBe(0);
  });
}
test('C1-PO-01: identical WMS_REFERENCE repeat retains cycle; conflicting frozen payload rejected', async () => {
  const i = input('PRODUCTION_OUTPUT', 32, 1370, 'PO', date, 'ACCEPTED_WMS_ID');
  const db = database([historical({ ...i, sourceId: 30 })]);
  const old = structuredClone(historical({ ...i, sourceId: 30 }));
  expect(await handoffIncomingInTransaction(db.tx, prepared(i))).toMatchObject({ id: 'old-cycle', created: false });
  await expect(handoffIncomingInTransaction(db.tx, prepared({ ...i, payload: input('PRODUCTION_OUTPUT', 32, 1370, 'PO', date, 'ACCEPTED_WMS_ID', 2).payload })))
    .rejects.toThrow('FROZEN_IDENTITY_CONFLICT');
  expect(db.inserts()).toBe(0);
  expect(historical({ ...i, sourceId: 30 })).toEqual(old);
});
test('exact repeat cannot hide a second conflicting historical identity', async () => {
  const db = database([historical(), historical(input('ADJUSTMENT', 32))]);
  await expect(handoffIncomingInTransaction(db.tx, prepared())).rejects.toThrow('BUSINESS_REFERENCE_ALREADY_QUEUED');
});

function captureDb(rows: Row[] = []) {
  const mock = database(rows);
  let reads = 0;
  const source = { id: 32, company_code: 1370, wms_id: 'AMI0126072200002-01', transaction_date: new Date(`${date}T00:00:00Z`) };
  const db = { ...mock.tx, adjustments: {
    findFirst: async () => source,
    findMany: async () => { reads++; return [{ id: 32 }]; },
  }, $transaction: async (fn: (tx: any) => Promise<any>) => fn({ ...db, $transaction: undefined }) };
  // A transaction client must not have the $transaction property at all.
  db.$transaction = async fn => { const { $transaction: _, ...tx } = db; return fn(tx); };
  return { ...mock, db: db as unknown as PrismaClient, reads: () => reads, source };
}
const scope = { operation: 'ADJUSTMENT' as const, companyCode: 1370, sourceId: 32, businessDate: date,
  revision: 'COMMITTED_SOURCE', requestedBy: 'C1-MOCK', completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED' as const };
test('producer rejects source recreation before conversion; ambiguous live headers fail closed', async () => {
  const mock = captureDb([historical()]);
  await expect(captureCompletedWmsSource(mock.db, scope)).rejects.toThrow('BUSINESS_REFERENCE_ALREADY_QUEUED');
  expect(mock.inserts()).toBe(0);
  const ambiguous = captureDb();
  ambiguous.db.adjustments.findMany = (async () => [{ id: 30 }, { id: 32 }]) as any;
  await expect(captureCompletedWmsSource(ambiguous.db, scope)).rejects.toThrow('AMBIGUOUS_ORIGINAL_SOURCE');
});
test('producer rechecks raced historical conflict inside transaction after conversion', async () => {
  const rows: Row[] = [];
  const mock = captureDb(rows);
  const convert = INSWIntegrationService.prototype.convertAdjustmentToINSW;
  INSWIntegrationService.prototype.convertAdjustmentToINSW = async () => { rows.push(historical()); return input().payload; };
  try {
    await expect(captureCompletedWmsSource(mock.db, scope)).rejects.toThrow('BUSINESS_REFERENCE_ALREADY_QUEUED');
    expect(mock.inserts()).toBe(0);
    expect(mock.reads()).toBe(2);
  } finally { INSWIntegrationService.prototype.convertAdjustmentToINSW = convert; }
});
test('producer checks payload even for same canonical identity; manual lock order remains stable-first', async () => {
  const mock = captureDb([historical(input('ADJUSTMENT', 32))]);
  const convert = INSWIntegrationService.prototype.convertAdjustmentToINSW;
  INSWIntegrationService.prototype.convertAdjustmentToINSW = async () => input('ADJUSTMENT', 32, 1370, 'AMI0126072200002-01', date, 'COMMITTED_SOURCE', 2).payload;
  try {
    await expect(captureCompletedWmsSource(mock.db, scope)).rejects.toThrow('FROZEN_IDENTITY_CONFLICT');
    const fresh = captureDb();
    await captureCompletedWmsSource(fresh.db, { ...scope, completion: 'MANUAL_REGENERATION_SERVER_CHECKS' }, {
      recheck: async () => { fresh.events.push('manual-recheck'); }, audit: async () => { fresh.events.push('audit'); },
    });
    const firstLock = fresh.events.findIndex(event => event.startsWith('lock:'));
    expect(fresh.events[firstLock]).toContain('insw-source-reference');
    expect(fresh.events[firstLock + 1]).toContain('insw-v1');
    expect(fresh.events[firstLock + 2]).toBe('manual-recheck');
    expect(fresh.events.at(-1)).toBe('audit');
  } finally { INSWIntegrationService.prototype.convertAdjustmentToINSW = convert; }
});
test('C1-RESEND-01: existing pure owner/lease/retry/HELD gates remain enforced', () => {
  const failed = { status: 'FAILED', delivery_state: 'KNOWN_FAILURE', retry_index: 10, max_auto_retry_snapshot: 10,
    owner_token: null, lease_until: null } as const;
  const evidence = { classification: 'TRANSIENT_FAILURE', reasonCode: 'RATE_LIMIT_REJECTION', responseEvidence: 'COMPLETE', providerStatus: false, providerMessage: 'API rate limit exceeded', httpCode: 429 };
  expect(wmsResendEligible(failed, evidence)).toBe(true);
  expect(wmsResendEligible(failed)).toBe(false);
  for (const change of [{ status: 'HELD' }, { delivery_state: 'POSSIBLY_STARTED' }, { retry_index: 9 },
    { owner_token: 'owner' }, { lease_until: new Date() }]) expect(wmsResendEligible({ ...failed, ...change } as any, evidence)).toBe(false);
});

test('C1-PO-01: full producer repeat with tracking retains history after source recreation', async () => {
  const i = input('PRODUCTION_OUTPUT', 32, 1370, 'PO', date, 'ACCEPTED_WMS_ID');
  const row = historical({ ...i, sourceId: 30 }, 'SUCCEEDED');
  const mock = database([row]);
  const db = { ...mock.tx, production_outputs: {
    findFirst: async () => ({ id: 32, wms_id: 'PO', transaction_date: new Date(`${date}T00:00:00Z`), reversal: null }),
    findMany: async () => [{ id: 32 }],
  }, insw_tracking_log: { findFirst: async () => ({ id: 99 }) },
    $transaction: async (fn: (tx: any) => Promise<any>) => { const { $transaction: _, ...tx } = db; return fn(tx); } };
  const convert = INSWIntegrationService.prototype.convertProductionOutputToINSW;
  INSWIntegrationService.prototype.convertProductionOutputToINSW = async () => i.payload;
  try {
    expect(await captureCompletedWmsSource(db as unknown as PrismaClient, { ...scope, operation: 'PRODUCTION_OUTPUT', revision: 'ACCEPTED_WMS_ID' }))
      .toEqual({ outcome: 'ALREADY_CAPTURED', id: 'old-cycle', created: false });
    expect(mock.inserts()).toBe(0);
    expect(row.status).toBe('SUCCEEDED');
    expect(row.identity_key).not.toContain('SOURCE_HEADER');
  } finally { INSWIntegrationService.prototype.convertProductionOutputToINSW = convert; }
});
test('legacy history without a matching queue still blocks automatic capture', async () => {
  const mock = captureDb();
  mock.db.insw_tracking_log.findFirst = (async () => ({ id: 99 })) as any;
  await expect(captureCompletedWmsSource(mock.db, scope)).rejects.toThrow('LEGACY_DELIVERY_REQUIRES_INVESTIGATION_OR_LOCAL_REPAIR');
  expect(mock.inserts()).toBe(0);
});
test('source association changes during conversion fail closed before insertion', async () => {
  const mock = captureDb();
  const convert = INSWIntegrationService.prototype.convertAdjustmentToINSW;
  INSWIntegrationService.prototype.convertAdjustmentToINSW = async () => {
    mock.source.wms_id = 'CHANGED'; return input().payload;
  };
  try {
    await expect(captureCompletedWmsSource(mock.db, scope)).rejects.toThrow('SOURCE_CHANGED_DURING_CAPTURE');
    expect(mock.inserts()).toBe(0);
  } finally { INSWIntegrationService.prototype.convertAdjustmentToINSW = convert; }
});

for (const manual of [false, true]) test(`UAT3-02: capture propagates missing-UoM type without changing ordinary Error text (manual=${manual})`, async () => {
  const h = captureDb();
  const db: any = h.db;
  db.insw_uom_mapping = { findMany: async () => [] };
  db.adjustments.findFirst = async () => ({ ...h.source, items: [{ uom: 'KG2', qty: 1 }] });
  const error = await captureCompletedWmsSource(db, { ...scope,
    completion: manual ? 'MANUAL_REGENERATION_SERVER_CHECKS' : 'EXISTING_BUSINESS_COMPLETION_RESOLVED' },
    manual ? { recheck: async () => {}, audit: async () => {} } : undefined).catch(e => e);
  expect(error).toBeInstanceOf(MissingInswUomMappingError);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('UOM mapping tidak ditemukan untuk: KG2. Silakan tambahkan mapping di menu INSW > UOM Mapping terlebih dahulu.');
  expect(h.inserts()).toBe(0);
});
