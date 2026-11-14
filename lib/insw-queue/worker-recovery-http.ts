import type { RecoveryAcknowledgement } from '../insw-worker/fixed-recovery-engine';
import type { Session } from 'next-auth';
import { getAllowedOrigins } from '../security/request-origin';
import { intervalSettingsAccess } from './interval-settings-http';
import { fixedWorkerRecoveryHost, workerRecoveryAllowed, workerRecoveryUnavailable } from './worker-recovery';

function recoveryOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    // Require a serialized HTTP(S) origin, including its exact scheme and port.
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false;
    if (getAllowedOrigins().has(origin)) return true;
    // Public application URL is server configuration, also behind a proxy.
    // Neither Host nor forwarded headers can establish a trusted origin.
    return !!process.env.NEXTAUTH_URL && origin === new URL(process.env.NEXTAUTH_URL).origin;
  } catch { return false; }
}

export async function workerRecoveryRequest(request: Request, session: Session | null) {
  const json = (error: string, status: number) => Response.json({ error }, {
    status, headers: { 'Cache-Control': 'no-store' },
  });
  const access = intervalSettingsAccess(session);
  if (access !== 200) return json(access === 401 ? 'Unauthorized' : 'Forbidden', access);
  if (!workerRecoveryAllowed()) return json('Worker recovery is unavailable in this environment.', 403);
  if (request.method !== 'POST') return json('Method not allowed', 405);
  if (!recoveryOriginAllowed(request.headers.get('origin')) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return json('Forbidden origin', 403);
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json('JSON content type required', 415);
  }
  // Only a server-issued opaque context and the manual shutdown attestation.
  let acknowledgement: RecoveryAcknowledgement | undefined;
  try {
    const text = await request.text();
    if (text.length > 2048) return json('Invalid request.', 400);
    const body = JSON.parse(text);
    if (!body || Array.isArray(body) || typeof body !== 'object') return json('Invalid request.', 400);
    if (Object.keys(body).length) {
      if (Object.keys(body).sort().join(',') !== 'confirmation,evidence,shutdownAcknowledged'
        || typeof body.confirmation !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(body.confirmation)
        || body.shutdownAcknowledged !== true || typeof body.evidence !== 'string'
        || !body.evidence.trim() || body.evidence.length > 500 || /[\u0000-\u001f]/.test(body.evidence)) return json('Invalid shutdown acknowledgement.', 400);
      acknowledgement = body;
    }
  } catch { return json('Invalid request.', 400); }
  const input = { requestedBy: session!.user.id, ...(acknowledgement ? { acknowledgement } : {}) };
  if (request.headers.get('accept') === 'application/x-ndjson') {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let connected = true;
        const send = (value: unknown) => {
          if (connected) { try { controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); } catch { connected = false; } }
        };
        try {
          const result = await fixedWorkerRecoveryHost.recoverAndRestart(input, stage => send({ stage }));
          send(typeof result === 'string' ? { result } : result);
        } catch { console.error('[INSW recovery] HOST_BOUNDARY_FAILED'); send({ result: 'refused' }); }
        try { controller.close(); } catch { /* Disconnected callers do not cancel host locking. */ }
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  }
  try {
    const result = await fixedWorkerRecoveryHost.recoverAndRestart(input);
    if (typeof result !== 'string') return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    if (result === 'running' || result === 'already-running') {
      return Response.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (result === 'refused') return json('Unable to recover. Contact your system administrator.', 409);
  } catch {
    console.error('[INSW recovery] HOST_BOUNDARY_FAILED');
  }
  return json(workerRecoveryUnavailable, 503);
}
