import { Agent, request } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { isolatedDatabaseUrl, runIsolatedWorker } from '../lib/insw-worker/isolated-worker';

// No .env, app singleton, company configuration, production sender or proxy.
async function main() {
  const url = isolatedDatabaseUrl(process.env);
  const endpoint = new URL(process.env.INSW_SYNTHETIC_ENDPOINT ?? 'invalid:');
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('LOOPBACK_HTTP_REQUIRED');
  const db = new PrismaClient({ datasources: { db: { url } } });
  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort()); process.once('SIGINT', () => stop.abort());
  try {
    await runIsolatedWorker({ db, signal: stop.signal, timeoutMs: Number(process.env.INSW_SYNTHETIC_TIMEOUT_MS ?? 10000),
      onEvent: (event, data) => { process.send?.({ event, data }); },
      request: (body, signal) => new Promise<Response>((resolve, reject) => {
        // Resolve/reject only on close, including aborted sockets. The worker
        // separately drains this promise even when its bounded transport times out.
        let responseBody = ''; let status = 0; let failure: Error | undefined; let ended = false;
        const outgoing = request(endpoint, { agent: new Agent({ keepAlive: false }), method: 'POST', signal, headers: { 'content-type': 'application/json' } }, incoming => {
          status = incoming.statusCode ?? 500;
          incoming.setEncoding('utf8');
          incoming.on('data', chunk => {
            responseBody += chunk;
            if (responseBody.length > 65536) outgoing.destroy(new Error('SYNTHETIC_RESPONSE_TOO_LARGE'));
          });
          incoming.on('end', () => { ended = true; });
          incoming.on('error', error => { failure = error; });
        });
        outgoing.on('error', error => { failure = error; });
        outgoing.on('close', () => {
          if (failure || !ended) reject(Object.assign(new Error('SYNTHETIC_TRANSPORT_FAILURE'), {
            cause: { code: (failure as NodeJS.ErrnoException | undefined)?.code } }));
          else resolve(new Response(responseBody, { status }));
        });
        outgoing.end(body);
      }),
    });
  } finally { await db.$disconnect(); }
}
main().catch(() => { process.stderr.write('ISOLATED_WORKER_STOPPED_REQUIRES_REVIEW\n'); process.exitCode = 78; });
