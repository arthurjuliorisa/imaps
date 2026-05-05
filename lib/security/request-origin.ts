import type { NextRequest } from 'next/server';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function parseCsv(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function extractHostname(host?: string | null): string | null {
  const firstHost = host?.split(',')[0]?.trim().toLowerCase();

  if (!firstHost) {
    return null;
  }

  try {
    return new URL(`http://${firstHost}`).hostname.toLowerCase();
  } catch {
    const withoutPort = firstHost.split(':')[0]?.trim();
    return withoutPort || null;
  }
}

function normalizeAllowedHost(value: string): string | null {
  return extractHostname(value);
}

export function getAllowedHosts(): Set<string> {
  return new Set(
    parseCsv(process.env.ALLOWED_HOSTS)
      .map(normalizeAllowedHost)
      .filter((host): host is string => Boolean(host))
  );
}

export function isAllowedHost(host?: string | null): boolean {
  const hostname = extractHostname(host);

  if (!hostname) {
    return false;
  }

  if (process.env.NODE_ENV !== 'production' && LOCAL_HOSTS.has(hostname)) {
    return true;
  }

  const allowedHosts = getAllowedHosts();

  if (allowedHosts.size === 0) {
    return true;
  }

  return allowedHosts.has(hostname);
}

export function getRequestHost(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-host') || request.headers.get('host');
}

export function isAllowedRequestHost(request: NextRequest): boolean {
  return isAllowedHost(getRequestHost(request));
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

export function getAllowedOrigins(): Set<string> {
  return new Set(
    parseCsv(process.env.ALLOWED_ORIGINS)
      .map(normalizeOrigin)
      .filter((origin): origin is string => Boolean(origin))
  );
}

export function isAllowedOrigin(origin?: string | null): boolean {
  if (!origin) {
    return false;
  }

  const normalizedOrigin = normalizeOrigin(origin);

  if (!normalizedOrigin) {
    return false;
  }

  const hostname = extractHostname(new URL(normalizedOrigin).host);

  if (process.env.NODE_ENV !== 'production' && hostname && LOCAL_HOSTS.has(hostname)) {
    return true;
  }

  const allowedOrigins = getAllowedOrigins();

  if (allowedOrigins.size === 0) {
    return false;
  }

  return allowedOrigins.has(normalizedOrigin);
}
