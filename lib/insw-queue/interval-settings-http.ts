import type { Session } from 'next-auth';
import type { PrismaClient } from '@prisma/client';
import { isAllowedOrigin } from '../security/request-origin';
import { readPolicy } from './policy.repository';
import { IntervalSettingsError, intervalProjection, updateInterval } from './interval-settings';

export function intervalSettingsAccess(session: Session | null): number {
  if (!session?.user?.id) return 401;
  return session.user.role === 'ADMIN' ? 200 : 403;
}

// Session acquisition stays in the route; this boundary is also exercised with
// isolated databases, without creating accounts or operational sessions.
export async function intervalSettingsRequest(request: Request, session: Session | null, db: PrismaClient) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const access = intervalSettingsAccess(session);
  if (access !== 200) return json({ error: access === 401 ? 'Unauthorized' : 'Forbidden' }, access);
  try {
    if (request.method === 'GET') return json({ data: intervalProjection(await readPolicy(db)) });
    if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
    // Cookie authentication needs an explicit trusted origin for mutations. JSON
    // content type also prevents cross-site form submission.
    if (!isAllowedOrigin(request.headers.get('origin')) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return json({ error: 'Forbidden origin' }, 403);
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return json({ error: 'JSON content type required' }, 415);
    }
    let input: unknown;
    try { input = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    return json({ data: await updateInterval(db, input, session!.user.id) });
  } catch (error) {
    if (error instanceof IntervalSettingsError) return json({ error: error.message }, error.status);
    console.error('[INSW Queue Settings] Request failed', error);
    return json({ error: 'Queue settings are unavailable. Reload before trying again.' }, 500);
  }
}
