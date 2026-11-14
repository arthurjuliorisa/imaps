import type { Session } from 'next-auth';
import { isAllowedOrigin } from '../security/request-origin';
import { intervalSettingsAccess } from './interval-settings-http';
import { fixedWorkerRecoveryHost, workerRecoveryAllowed, workerRecoveryUnavailable } from './worker-recovery';

export async function workerRecoveryRequest(request: Request, session: Session | null) {
  const json = (error: string, status: number) => Response.json({ error }, {
    status, headers: { 'Cache-Control': 'no-store' },
  });
  const access = intervalSettingsAccess(session);
  if (access !== 200) return json(access === 401 ? 'Unauthorized' : 'Forbidden', access);
  if (!workerRecoveryAllowed()) return json('Worker recovery is unavailable in this environment.', 403);
  if (request.method !== 'POST') return json('Method not allowed', 405);
  if (!isAllowedOrigin(request.headers.get('origin')) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return json('Forbidden origin', 403);
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json('JSON content type required', 415);
  }
  // No request fields are supported, including tokens and purported reap proof.
  try {
    if ((await request.text()) !== '{}') return json('This action accepts no parameters.', 400);
  } catch { return json('Invalid request.', 400); }
  try {
    await fixedWorkerRecoveryHost.recoverAndRestart({ requestedBy: session!.user.id });
  } catch {
    // Do not log/return host errors, process evidence or retained ownership.
  }
  // Deliberately cannot report success until a trusted host integration exists.
  return json(workerRecoveryUnavailable, 503);
}
