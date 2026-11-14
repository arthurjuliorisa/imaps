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
const available = fixedWorkerRecoveryHost.available;
test.beforeEach(() => {
  fixedWorkerRecoveryHost.available = () => false; // Never launch a host helper in this hermetic suite.
  process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE = 'development';
  process.env.DATABASE_PHASE = 'development';
  process.env.ALLOWED_ORIGINS = 'http://localhost';
  delete process.env.NEXTAUTH_URL;
  net.Socket.prototype.connect = (() => { throw new Error('RECOVERY_NETWORK_FORBIDDEN'); }) as typeof connect;
});
test.afterEach(() => { fixedWorkerRecoveryHost.available = available; process.env = { ...originalEnv }; net.Socket.prototype.connect = connect; });

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

test('adapter exceptions are redacted and never report success', async () => {
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

test('API maps trusted outcomes and streams only simple verified stages', async () => {
  const saved = fixedWorkerRecoveryHost.recoverAndRestart;
  try {
    for (const result of ['running', 'already-running', 'refused'] as const) {
      fixedWorkerRecoveryHost.recoverAndRestart = async (input, stage) => {
        expect(input).toEqual({ requestedBy: 'admin' });
        stage?.('Checking'); stage?.('Starting'); return result;
      };
      const response = await workerRecoveryRequest(request(), admin);
      expect(response.status).toBe(result === 'refused' ? 409 : 200);
      const stream = await workerRecoveryRequest(request('{}', { Accept: 'application/x-ndjson' }), admin);
      const events = (await stream.text()).trim().split('\n').map(line => JSON.parse(line));
      expect(events).toEqual([{ stage: 'Checking' }, { stage: 'Starting' }, { result }]);
      expect(JSON.stringify(events)).not.toMatch(/token|pid|REAPED|pm2/i);
    }
  } finally { fixedWorkerRecoveryHost.recoverAndRestart = saved; }
});


const recoveryPath = '/api/insw/queue-settings/worker-recovery';
for (const scenario of [
  { name: 'local build with production Node and development phase', app: 'http://localhost:3000', origin: 'http://localhost:3000', url: 'http://localhost:3000', phase: 'development' },
  { name: 'staging HTTPS reverse proxy with internal HTTP URL', app: 'https://test.example:13443/api/auth', origin: 'https://test.example:13443', url: 'http://127.0.0.1:3000', phase: 'staging' },
  { name: 'explicit public origin allowlist', app: '', allow: 'https://test.example:13443', origin: 'https://test.example:13443', url: 'http://127.0.0.1:3000', phase: 'staging' },
]) {
  test(`recovery accepts exact configured origin: ${scenario.name}`, async () => {
    process.env = { ...process.env, NODE_ENV: 'production' };
    process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE = scenario.phase; process.env.DATABASE_PHASE = scenario.phase;
    process.env.NEXTAUTH_URL = scenario.app; process.env.ALLOWED_ORIGINS = scenario.allow || '';
    const saved = fixedWorkerRecoveryHost.recoverAndRestart; let calls = 0;
    fixedWorkerRecoveryHost.recoverAndRestart = async () => { calls++; return 'already-running'; };
    try {
      const response = await workerRecoveryRequest(new Request(scenario.url + recoveryPath, {
        method: 'POST', headers: { Origin: scenario.origin, Host: new URL(scenario.url).host,
          'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json',
          'X-Forwarded-Host': 'ignored.invalid', 'X-Forwarded-Proto': 'http' }, body: '{}',
      }), admin);
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ result: 'already-running' });
      expect(calls).toBe(1);
    } finally { fixedWorkerRecoveryHost.recoverAndRestart = saved; }
  });
}

for (const origin of ['', 'null', 'https://forged.invalid', 'http://localhost:3001', 'https://localhost:3000',
  'http://127.0.0.1:3000', 'http://localhost:3000.evil.invalid', 'http://localhost:3000/path',
  'http://admin@localhost:3000', 'http://localhost:3000?query=1', 'http://localhost:3000#fragment']) {
  test(`recovery rejects unconfigured or malformed origin: ${origin || '(missing)'}`, async () => {
    // The old development localhost exemption must not allow other local origins.
    process.env = { ...process.env, NODE_ENV: 'development' }; process.env.ALLOWED_ORIGINS = '';
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
    const saved = fixedWorkerRecoveryHost.recoverAndRestart; let calls = 0;
    fixedWorkerRecoveryHost.recoverAndRestart = async () => { calls++; return 'already-running'; };
    try {
      const response = await workerRecoveryRequest(new Request('http://localhost:3000' + recoveryPath, {
        method: 'POST', headers: { Origin: origin, Host: 'localhost:3000', 'Sec-Fetch-Site': 'same-origin',
          'Content-Type': 'application/json', 'X-Forwarded-Host': 'localhost:3000', 'X-Forwarded-Proto': 'http' }, body: '{}',
      }), admin);
      expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'Forbidden origin' });
      expect(calls).toBe(0);
    } finally { fixedWorkerRecoveryHost.recoverAndRestart = saved; }
  });
}

test('request URL, Host, forwarded headers and same-origin claim cannot supply missing trusted configuration', async () => {
  process.env = { ...process.env, NODE_ENV: 'production' }; process.env.ALLOWED_ORIGINS = '';
  for (const configured of ['', 'not-a-url']) {
    process.env.NEXTAUTH_URL = configured;
    const response = await workerRecoveryRequest(new Request('https://forged.invalid' + recoveryPath, {
      method: 'POST', headers: { Origin: 'https://forged.invalid', Host: 'forged.invalid',
        'X-Forwarded-Host': 'forged.invalid', 'X-Forwarded-Proto': 'https',
        'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: '{}',
    }), admin);
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'Forbidden origin' });
  }
});

test('canonical origin retains cross-site, Admin and environment restrictions', async () => {
  process.env = { ...process.env, NODE_ENV: 'production' }; process.env.ALLOWED_ORIGINS = ''; process.env.NEXTAUTH_URL = 'http://localhost:3000';
  const make = (site = 'same-origin') => new Request('http://localhost:3000' + recoveryPath, {
    method: 'POST', headers: { Origin: 'http://localhost:3000', Host: 'localhost:3000',
      'Sec-Fetch-Site': site, 'Content-Type': 'application/json' }, body: '{}',
  });
  expect((await workerRecoveryRequest(make('cross-site'), admin)).status).toBe(403);
  expect((await workerRecoveryRequest(make(), null)).status).toBe(401);
  expect((await workerRecoveryRequest(make(), { user: { id: 'user', role: 'USER' } } as Session)).status).toBe(403);
  process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE = 'production'; process.env.DATABASE_PHASE = 'production';
  expect((await workerRecoveryRequest(make(), admin)).status).toBe(403);
});

test('API returns only opaque confirmation context and forwards explicit attestation with authenticated Admin', async () => {
  const saved = fixedWorkerRecoveryHost.recoverAndRestart;
  const confirmation = '1999999999999.' + 'a'.repeat(64);
  const acknowledgement = { confirmation, shutdownAcknowledged: true as const, evidence: 'Verified supervisor stopped and descendants reaped' };
  const inputs: unknown[] = [];
  fixedWorkerRecoveryHost.recoverAndRestart = async input => {
    inputs.push(input);
    return input.acknowledgement ? 'running' : { result: 'confirmation-required', confirmation };
  };
  try {
    for (const accept of ['application/json', 'application/x-ndjson']) {
      const response = await workerRecoveryRequest(request('{}', { Accept: accept }), admin);
      const event = JSON.parse((await response.text()).trim());
      expect(event).toEqual({ result: 'confirmation-required', confirmation });
      expect(await (await workerRecoveryRequest(request(JSON.stringify(acknowledgement)), admin)).json()).toEqual({ result: 'running' });
    }
    expect(inputs).toEqual([{ requestedBy: 'admin' }, { requestedBy: 'admin', acknowledgement },
      { requestedBy: 'admin' }, { requestedBy: 'admin', acknowledgement }]);
  } finally { fixedWorkerRecoveryHost.recoverAndRestart = saved; }
});

test('API rejects incomplete or arbitrary shutdown attestations before invoking host', async () => {
  const saved = fixedWorkerRecoveryHost.recoverAndRestart;
  let calls = 0;
  fixedWorkerRecoveryHost.recoverAndRestart = async () => { calls++; return 'running'; };
  const ack = { confirmation: '1999999999999.' + 'a'.repeat(64), shutdownAcknowledged: true, evidence: 'Verified shutdown' };
  try {
    for (const body of [
      { ...ack, shutdownAcknowledged: false }, { ...ack, shutdownAcknowledged: 'REAPED' },
      { ...ack, evidence: '' }, { ...ack, evidence: 'unverified\nclaim' }, { ...ack, evidence: 'x'.repeat(501) }, { ...ack, confirmation: 'forged' },
      { ...ack, ownerToken: 'private' }, { ...ack, requestedBy: 'other-admin' }, { ...ack, command: 'restart all' },
    ]) expect((await workerRecoveryRequest(request(JSON.stringify(body)), admin)).status).toBe(400);
    expect(calls).toBe(0);
  } finally { fixedWorkerRecoveryHost.recoverAndRestart = saved; }
});
