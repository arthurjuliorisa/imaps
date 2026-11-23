// A bare authority only: URL parsing alone would silently repair some invalid inputs.
function parseAuthority(protocol: string, authority: string | null): URL | null {
  if (!authority || !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]{1,5})?$/i.test(authority)) return null;
  try {
    const url = new URL(`${protocol}://${authority}`);
    const defaultPort = protocol === 'https' ? '443' : '80';
    if (!url.hostname || (url.port && Number(url.port) === 0)
      || (authority.toLowerCase() !== url.host && authority.toLowerCase() !== `${url.hostname}:${defaultPort}`)) return null;
    if (!url.hostname.startsWith('[') && !url.hostname.split('.').every(label =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
    return url;
  } catch { return null; }
}

/**
 * Regenerate's ingress contract: port 3000 must be accessible only to the trusted
 * local proxy, which overwrites Host and X-Forwarded-Proto. Request headers cannot
 * prove that network boundary; verify it on the VPS before deploying this change.
 * Never derive authority from X-Forwarded-Host or fall back to the internal URL.
 */
export function hasValidRegenerationOrigin(request: Pick<Request, 'headers'>): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const protocol = request.headers.get('x-forwarded-proto');
  if (protocol !== 'http' && protocol !== 'https') return false;
  const expected = parseAuthority(protocol, request.headers.get('host'));
  if (!expected) return false;

  // Known Nginx config sends the same $host for both fields. If supplied, this
  // secondary field must agree; it can never select a different trusted host.
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost !== null && parseAuthority(protocol, forwardedHost)?.origin !== expected.origin) return false;

  const origin = request.headers.get('origin');
  const match = origin?.match(/^(https?):\/\/([^/]+)$/);
  if (!match) return false;
  return parseAuthority(match[1], match[2])?.origin === expected.origin;
}
