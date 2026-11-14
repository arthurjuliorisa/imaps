import { test, expect } from '@playwright/test';
import type { Session } from 'next-auth';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { workerRecoveryAllowed, fixedWorkerRecoveryHost } from '../lib/insw-queue/worker-recovery';
import { workerRecoveryRequest } from '../lib/insw-queue/worker-recovery-http';

const admin = { user: { id: 'admin', role: 'ADMIN' }, expires: '' } as Session;
const request = (body = '{}', headers: Record<string, string> = {}, method = 'POST') => new Request('http://localhost/api/insw/queue-settings/worker-recovery', {
  method, headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...headers },
  ...(method === 'POST' ? { body } : {}),
});
const originalEnv = { ...process.env };
const connect = net.Socket.prototype.connect;
test.beforeEach(() => {
  process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE = 'development';
  process.env.DATABASE_PHASE = 'development';
  process.env.ALLOWED_ORIGINS = 'http://localhost';
  net.Socket.prototype.connect = (() => { throw new Error('RECOVERY_NETWORK_FORBIDDEN'); }) as typeof connect;
});
test.afterEach(() => { process.env = { ...originalEnv }; net.Socket.prototype.connect = connect; });

test('visibility permits only explicit development/staging and private phase cannot contradict it', () => {
  for (const phase of ['development', 'staging']) {
    expect(workerRecoveryAllowed({ NEXT_PUBLIC_ENVIRONMENT_PHASE: phase })).toBe(true);
    expect(workerRecoveryAllowed({ NEXT_PUBLIC_ENVIRONMENT_PHASE: phase, DATABASE_PHASE: phase })).toBe(true);
    expect(workerRecoveryAllowed({ NEXT_PUBLIC_ENVIRONMENT_PHASE: phase, DATABASE_PHASE: 'production' })).toBe(false);
  }
  for (const phase of [undefined, '', 'production', 'test', 'Development']) {
    expect(workerRecoveryAllowed({ NEXT_PUBLIC_ENVIRONMENT_PHASE: phase, DATABASE_PHASE: 'development' })).toBe(false);
  }
});

test('API independently denies Production, unknown phase and private phase mismatch', async () => {
  for (const phase of ['production', '', 'unknown']) {
    process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE = phase;
    expect((await workerRecoveryRequest(request(), admin)).status).toBe(403);
  }
  process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE = 'development';
  process.env.DATABASE_PHASE = 'production';
  expect((await workerRecoveryRequest(request(), admin)).status).toBe(403);
});

test('only authenticated canonical Admin can invoke the boundary', async () => {
  expect((await workerRecoveryRequest(request(), null)).status).toBe(401);
  expect((await workerRecoveryRequest(request(), { user: { role: 'ADMIN' } } as Session)).status).toBe(401);
  for (const role of ['USER', 'SUPER_ADMIN', 'SUPERADMIN', 'ADMINISTRATOR']) {
    expect((await workerRecoveryRequest(request(), { user: { id: 'other', role } } as Session)).status).toBe(403);
  }
});

test('mutation requires trusted origin, JSON and no browser-selected parameters', async () => {
  const rejectedHeaders: Record<string, string>[] = [{ Origin: '' }, { Origin: 'https://untrusted.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }];
  for (const headers of rejectedHeaders) {
    expect((await workerRecoveryRequest(request('{}', headers), admin)).status).toBe(403);
  }
  expect((await workerRecoveryRequest(request('{}', { 'Content-Type': 'text/plain' }), admin)).status).toBe(415);
  expect((await workerRecoveryRequest(request('{}', {}, 'GET'), admin)).status).toBe(405);
  for (const body of ['{', 'null', '[]', '{"ownerToken":"secret"}', '{"evidence":"REAPED"}', '{"command":"pm2 restart all"}']) {
    expect((await workerRecoveryRequest(request(body), admin)).status).toBe(400);
  }
});

test('disabled adapter and concurrent requests perform no recovery or start and cannot claim running', async () => {
  expect(await fixedWorkerRecoveryHost.recoverAndRestart({ requestedBy: 'admin' })).toBe('unavailable');
  for (const phase of ['development', 'staging']) {
    process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE = phase; process.env.DATABASE_PHASE = phase;
    const responses = await Promise.all(Array.from({ length: 4 }, () => workerRecoveryRequest(request(), admin)));
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'Worker recovery is unavailable. Contact your system administrator.' });
    }
  }
});

test('adapter exceptions are redacted without logging or success', async () => {
  const recover = fixedWorkerRecoveryHost.recoverAndRestart;
  fixedWorkerRecoveryHost.recoverAndRestart = async () => { throw new Error('private-owner-token /proc/private PM2_HOME=secret'); };
  try {
    const response = await workerRecoveryRequest(request(), admin);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/private|secret|PM2|\/proc/);
  } finally { fixedWorkerRecoveryHost.recoverAndRestart = recover; }
});

test('page supplies visibility only after Admin access; route uses the privileged boundary', () => {
  const page = readFileSync('app/(authenticated)/insw/queue-settings/page.tsx', 'utf8');
  expect(page.indexOf("if (access !== 200)")).toBeLessThan(page.indexOf('showWorkerRecovery={workerRecoveryAllowed()}'));
  const route = readFileSync('app/api/insw/queue-settings/worker-recovery/route.ts', 'utf8');
  expect(route).toContain('workerRecoveryRequest(request, await getServerSession(authOptions))');
});
