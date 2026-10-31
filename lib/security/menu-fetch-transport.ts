import type { NextRequest } from 'next/server';
import { Agent, fetch } from 'undici';
import { getRequestHost, isAllowedRequestHost } from './request-origin';

// Request-scoped use of a direct dispatcher: never inherit an environment or
// global proxy dispatcher for this credential-bearing, same-instance call.
const directDispatcher = new Agent();
export const fetchInternalMenus = fetch;
export { directDispatcher };

export function getMenuFetchTarget(port = process.env.PORT): URL {
  // next start publishes its actual selected port in PORT (including -p).
  // The listener must accept plain HTTP on IPv4 loopback, as the default Next
  // wildcard listener does. No DNS, public origin, or request header is used.
  const value = port ?? '3000';
  if (!/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('Invalid internal menu listener port');
  }
  return new URL(`http://127.0.0.1:${Number(value)}/api/settings/access-menu/current-user-menus`);
}

export function getMenuSessionHeaders(request: NextRequest): Record<string, string> {
  const host = getRequestHost(request)?.split(',')[0]?.trim().toLowerCase();
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
    || request.nextUrl.protocol.slice(0, -1);
  if (!host || !isAllowedRequestHost(request) || !['http', 'https'].includes(proto)) {
    throw new Error('Invalid menu session origin');
  }
  const origin = new URL(`${proto}://${host}`);
  // The shared host check intentionally accepts legacy inputs. At this boundary
  // require a bare authority, excluding credentials, paths and URL delimiters.
  if (!origin.hostname || origin.username || origin.password
    || /[\s/@\\?#]/.test(host)) {
    throw new Error('Invalid menu session host');
  }
  return {
    cookie: request.headers.get('cookie') || '',
    'x-forwarded-host': origin.host,
    'x-forwarded-proto': proto,
  };
}
