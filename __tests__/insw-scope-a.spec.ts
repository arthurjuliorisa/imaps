import { test, expect } from '@playwright/test';
import type { Session } from 'next-auth';
import type { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { queueMonitoringRequest, QUEUE_STATUSES } from '../lib/insw-queue/monitoring';
import { intervalSettingsRequest } from '../lib/insw-queue/interval-settings-http';
import { parseIntervalUpdate, updateInterval } from '../lib/insw-queue/interval-settings';

const admin = (companyCode = '1370', role = 'ADMIN') => ({ user: { id: 'admin', role, companyCode }, expires: '' }) as Session;
const forbiddenDb = new Proxy({}, { get() { throw new Error('Unexpected database access'); } }) as PrismaClient;
const request = new Request('http://localhost/api/insw/queue-settings/monitoring');
const policy = { id: 1, min_processing_interval_ms: 3600, max_auto_retry: 5, version: 3, updated_at: new Date(), updated_by: 'admin', change_reason: 'Test' };

test('retry input permits 0–10 and rejects forged, fractional, coercible and unsupported values before database access', async () => {
  const input = { intervalMs: 3600, expectedVersion: 3, reason: 'Test' };
  for (const maxAutoRetry of [0, 1, 10]) expect(parseIntervalUpdate({ ...input, maxAutoRetry }).maxAutoRetry).toBe(maxAutoRetry);
  for (const maxAutoRetry of [-1, 11, 1.5, '2', null, true, Infinity, NaN, {}, []]) expect(() => parseIntervalUpdate({ ...input, maxAutoRetry })).toThrow();
  for (const body of [{ ...input, maxAutoRetry: 11 }, { ...input, maxAutoRetry: 3, owner_token: 'forged' }]) {
    const response = await intervalSettingsRequest(new Request('http://localhost/api/insw/queue-settings', { method: 'PATCH', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), admin(), forbiddenDb);
    expect(response.status).toBe(400);
  }
});

test('retry policy uses CAS and atomic audit without rewriting queue snapshots', async () => {
  const changes: any[] = [];
  const tx = {
    insw_transmission_policy: {
      updateMany: async (value: any) => { changes.push(value); return { count: 1 }; },
      findUnique: async () => ({ ...policy, max_auto_retry: 0, version: 4 }),
    },
    insw_policy_change: { create: async (value: any) => { changes.push(value); } },
  };
  const db = { insw_transmission_policy: { findUnique: async () => policy }, $transaction: async (fn: any) => fn(tx) } as unknown as PrismaClient;
  const input = { intervalMs: 3600, maxAutoRetry: 0, expectedVersion: 3, reason: 'Disable automatic retries' };
  expect(await updateInterval(db, input, 'admin')).toMatchObject({ maxAutoRetry: 0, version: 4 });
  expect(changes[0]).toMatchObject({ where: { id: 1, version: 3 }, data: { max_auto_retry: 0, version: 4 } });
  expect(changes[1]).toMatchObject({ data: { max_auto_retry: 0, version: 4, changed_by: 'admin', reason: input.reason } });
  await expect(updateInterval(db, { ...input, expectedVersion: 2 }, 'admin')).rejects.toMatchObject({ status: 409 });
  expect(changes).toHaveLength(2);
});

test('monitoring enforces admin and session company before any read; rejects writes', async () => {
  for (const [session, status] of [[null, 401], [admin('1370', 'USER'), 403], [admin(''), 400], [admin('1370evil'), 400], [admin('0'), 400]] as const) {
    expect((await queueMonitoringRequest(request, session, forbiddenDb)).status).toBe(status);
  }
  expect((await queueMonitoringRequest(new Request(request.url, { method: 'POST' }), admin(), forbiddenDb)).status).toBe(405);
});

test('single scoped snapshot projects counts and safe local evidence without liveness claims or secrets', async () => {
  for (const company of ['1370', '1380']) {
    let calls = 0;
    const db = { $queryRaw: async (sql: any) => {
      calls++;
      expect(sql.values.filter((v: unknown) => v === Number(company))).toHaveLength(2);
      expect(sql.text).toContain('GROUP BY status'); expect(sql.text).toContain('LIMIT 20');
      expect(sql.text).not.toMatch(/FOR UPDATE|UPDATE insw|INSERT|process_identity|error_message/);
      return [{ observed_at: new Date('2026-11-14T00:00:00Z'), owner_present: true, busy: false, last_started_at: null,
        counts: [{ status: 'READY', count: 4 }, { status: 'CLAIMED', count: 2 }],
        failures: [{ id: 'queue-ref', recorded_at: '2026-11-14T00:00:00Z', error_code: 'token=SECRET https://secret.invalid/payload', hold_reason: null }], owner_token: 'SECRET', process_identity: { pid: 123 } }];
    } } as unknown as PrismaClient;
    const response = await queueMonitoringRequest(new Request(`${request.url}?company=9999`), admin(company), db);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { data } = await response.json();
    expect(calls).toBe(1); expect(data.companyCode).toBe(Number(company));
    expect(data.worker.status).toBe('Owner recorded — process status unverified');
    expect(data.counts).toEqual(Object.fromEntries(QUEUE_STATUSES.map(s => [s, s === 'READY' ? 4 : s === 'CLAIMED' ? 2 : 0])));
    expect(data.failures[0].message).toContain('Local preparation failure recorded');
    expect(JSON.stringify(data)).not.toMatch(/SECRET|pid|owner_token|process_identity|payload/);
  }
});

test('missing owner does not imply stopped; failed reads return unknown error rather than fabricated counts', async () => {
  const db = { $queryRaw: async () => [{ observed_at: new Date(), owner_present: false, busy: false, last_started_at: null, counts: [], failures: [] }] } as unknown as PrismaClient;
  expect((await (await queueMonitoringRequest(request, admin(), db)).json()).data.worker.status).toContain('Unknown / Stale');
  const broken = { $queryRaw: async () => { throw new Error('secret connection payload'); } } as unknown as PrismaClient;
  const response = await queueMonitoringRequest(request, admin(), broken);
  expect(response.status).toBe(500); const body = await response.json();
  expect(body.data).toBeUndefined(); expect(JSON.stringify(body)).not.toContain('secret');
});

test('manual resend copy is English with boolean acknowledgement and disabled uncommitted confirmation', () => {
  const source = readFileSync('app/(authenticated)/insw/logs/page.tsx', 'utf8');
  for (const text of ['Confirm Manual Resend', 'Are you sure you want to resend this transaction to INSW?', 'Reason for Resending', 'Enter the reason for this manual resend...', 'I have reviewed the available information and accept responsibility for this manual resend, including the risk that INSW may have already processed the transaction.', 'Confirm Resend', 'Manual resend accepted to queue; delivery to INSW is not yet confirmed.', 'aria-labelledby="manual-resend-title"']) expect(source).toContain(text);
  expect(source).not.toMatch(/Kirim Ulang|Alasan kirim ulang|Saya telah|Gagal mengirim ulang|Gagal mengecek adjustment|Apakah Anda|Batal/);
  expect(source).toContain('setResendCommitment(event.target.checked)');
  expect(source).toContain('disabled={!resendReason.trim() || !resendCommitment || resendingId !== null}');
  expect(source).toContain('commitment: resendCommitment');
  expect(readFileSync('app/api/insw/logs/[id]/resend/route.ts', 'utf8')).toContain('body.commitment !== true');
});

test('monitoring route stays authenticated and read-only, polling keeps honest failure and visibility states', () => {
  const route = readFileSync('app/api/insw/queue-settings/monitoring/route.ts', 'utf8');
  expect(route).toContain('queueMonitoringRequest(request, await getServerSession(authOptions), prisma)');
  expect(route).not.toMatch(/export async function (POST|PATCH|DELETE)/);
  const ui = readFileSync('app/(authenticated)/insw/queue-settings/QueueMonitoring.tsx', 'utf8');
  expect(ui).toContain('if (disposed || inFlight || document.visibilityState');
  expect(ui).toContain('controller?.abort()'); expect(ui).toContain('30000');
  expect(ui).toContain('Last observation (stale)'); expect(ui).toContain('No verified heartbeat available');
  expect(ui).not.toMatch(/Restart Worker|Recover Ownership|Force Release|Retry All/);
});
