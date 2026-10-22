// Test-only counterexample/protocol probe. NEVER a worker or production adapter.
// No environment loading, credentials, external endpoint, or automatic takeover loop.
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { claimJob, transition } from '../../lib/insw-queue/queue.repository';
import { acquireStickyOwnership } from '../../lib/insw-worker/ownership.repository';
import { executeFrozenRequest } from '../../lib/insw-worker/transport';
import { freezePayload } from '../../lib/insw-queue/contracts';

let db: PrismaClient;
let send: (() => Promise<void>) | undefined;
process.on('message', async (message: { action: string; url: string; endpoint: string; topology: string; marker: boolean; timeout: boolean }) => {
  try {
    if (message.action === 'send') {
      if (!send) throw new Error('NOT_ADMITTED');
      const invoke = send;
      send = undefined;
      await invoke();
      process.send?.({ event: 'finished' });
      return;
    }
    if (message.action !== 'init' || db) throw new Error('INVALID_TEST_COMMAND');
    const url = new URL(message.url);
    const endpoint = new URL(message.endpoint);
    if (!process.send || !['postgres:', 'postgresql:'].includes(url.protocol)
      || url.hostname !== '127.0.0.1' || !/^\/[a-z0-9_]+_phase_c1_test$/.test(url.pathname)
      || url.search || url.hash || endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1'
      || endpoint.username || endpoint.password || !['lease', 'sticky'].includes(message.topology)) {
      throw new Error('UNSAFE_TEST_TARGET');
    }
    url.searchParams.set('connection_limit', '1');
    db = new PrismaClient({ datasources: { db: { url: url.href } } });
    let token: string;
    // Deliberately test two candidate protocols against the existing dormant gate.
    // Lease mode is UNSAFE and exists solely to reproduce the pause counterexample.
    // Sticky mode has NO release/reset/takeover, even after session/process loss.
    if (message.topology === 'sticky') {
      try { token = await acquireStickyOwnership(db); }
      catch { process.send?.({ event: 'blocked' }); return; }
    } else {
      token = randomUUID();
      const rows = await db.$queryRaw<{ owner_token: string }[]>`
      UPDATE insw_dispatch_gate SET owner_token = ${token}::uuid,
        lease_until = clock_timestamp() + interval '1 hour'
      WHERE id = 1 AND (owner_token IS NULL OR (${message.topology === 'lease'} AND lease_until <= clock_timestamp()))
      RETURNING owner_token`;
      if (!rows.length) { process.send?.({ event: 'blocked' }); return; }
    }
    const claim = await claimJob(db, 60000);
    if (!claim) throw new Error('MISSING_TEST_JOB');
    if (message.marker) await transition(db, claim, 'MARK_POSSIBLE_START');
    const [session] = await db.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    const primitive = () => new Promise<Response>((resolve, reject) => {
      // Real loopback HTTP, deliberately no recheck: exposes the uncloseable gap
      // after a final DB check and before an external effect on owner resume.
      const outgoing = request(endpoint, { method: 'POST' }, response => {
        response.resume(); response.on('end', () => resolve(new Response('{"status":true}')));
      });
      outgoing.on('error', reject);
      outgoing.end('{}');
    });
    send = message.timeout ? async () => {
      const payload = {};
      const outcome = await executeFrozenRequest({ payload, sha256: freezePayload(payload).sha256, timeoutMs: 200, request: primitive });
      process.send?.({ event: 'timeout', outcome });
    } : async () => { await primitive(); };
    process.send?.({ event: 'ready', claim: { id: claim.id, owner_token: claim.owner_token }, token, pid: session.pid });
  } catch {
    process.send?.({ event: 'error' }); // Never print connection strings/errors.
  }
});

// PM2-like orderly stop also retains sticky ownership. No implicit release.
process.on('SIGTERM', () => { void db?.$disconnect().finally(() => process.exit(0)); });
