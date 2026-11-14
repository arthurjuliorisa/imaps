import type { Session } from 'next-auth';
import { intervalSettingsAccess } from './interval-settings-http';
import { workerRecoveryAllowed } from './worker-recovery';
import { workerSupervisorStatus } from '../insw-worker/supervisor-status';

export async function workerStatusRequest(request: Request, session: Session | null) {
  const headers = { 'Cache-Control': 'no-store' };
  const access = intervalSettingsAccess(session);
  if (access !== 200) return Response.json({ error: access === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access, headers });
  if (!workerRecoveryAllowed()) return Response.json({ error: 'Worker status is unavailable in this environment.' }, { status: 403, headers });
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  return Response.json({ data: await workerSupervisorStatus() }, { headers });
}
