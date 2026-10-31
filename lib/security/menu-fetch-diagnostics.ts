// Fixed allowlists prevent error properties from becoming a channel for secrets.
const SAFE_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ABORT_ERR',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET', 'UND_ERR_ABORTED', 'UND_ERR_RESPONSE_STATUS_CODE',
  'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_UNKNOWN_PROTOCOL',
  'ERR_SSL_PACKET_LENGTH_TOO_LONG', 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION',
  'ERR_SSL_UNSUPPORTED_PROTOCOL', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'HPE_INVALID_CONSTANT', 'HPE_INVALID_HEADER_TOKEN', 'HPE_INVALID_STATUS',
]);
const SAFE_NAMES = new Set([
  'Error', 'TypeError', 'SyntaxError', 'RangeError', 'AggregateError',
  'AbortError', 'TimeoutError',
]);

function read(value: unknown, key: string): unknown {
  // Error metadata is diagnostic only; even a throwing accessor must not affect auth.
  try {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)[key] : undefined;
  } catch {
    return undefined;
  }
}

function errorDetails(error: unknown) {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  const codes = new Set<string>();
  // Bound total nodes, queued children, code count and strings (via allowlists).
  for (let index = 0; index < queue.length && index < 16; index++) {
    const item = queue[index];
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    const code = read(item, 'code');
    if (typeof code === 'string' && SAFE_CODES.has(code) && codes.size < 8) codes.add(code);
    if (queue.length < 16) queue.push(read(item, 'cause'));
    const children = read(item, 'errors');
    if (Array.isArray(children)) {
      for (let child = 0; child < children.length && queue.length < 16; child++) {
        queue.push(read(children, String(child)));
      }
    }
  }
  const name = read(error, 'name');
  const category = [...codes].some(code => code.startsWith('ERR_SSL_') || code.startsWith('HPE_'))
    ? 'protocol'
    : [...codes].some(code => code.startsWith('ERR_TLS_') || /CERT|ISSUER|SIGNATURE/.test(code))
      ? 'tls' : codes.size ? 'transport' : 'unknown';
  return {
    exception: typeof name === 'string' && SAFE_NAMES.has(name) ? name : 'unknown',
    codes: [...codes],
    category,
  };
}

function hostnameClass(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host)) return 'loopback';
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)
    || /^(f[cd][\da-f]{2}:|fe[89ab][\da-f]:)/.test(host)
    || host.endsWith('.internal') || host.endsWith('.local')
    || (host.length > 0 && !host.includes('.') && !host.includes(':'))) return 'internal';
  if (host.includes('.') || host.includes(':')) return 'public';
  return 'other';
}

export function formatMenuFetchDiagnostic(input: {
  pathname: string;
  target?: URL;
  attempt: number;
  elapsedMs: number;
  status?: number;
  error?: unknown;
  outcome: 'transport_error' | 'http_error' | 'response_error';
}) {
  return {
    route: /^\/(customs|master|settings)(\/|$)/.exec(input.pathname)?.[1] || 'other',
    attempt: input.attempt,
    elapsedMs: input.elapsedMs,
    protocol: input.target?.protocol === 'https:' ? 'https' : input.target?.protocol === 'http:' ? 'http' : 'unknown',
    hostClass: input.target ? hostnameClass(input.target.hostname) : 'other',
    port: input.target?.port || (input.target?.protocol === 'https:' ? '443' : input.target?.protocol === 'http:' ? '80' : 'unknown'),
    outcome: input.outcome,
    status: input.status ?? null,
    ...(input.outcome === 'http_error'
      ? { exception: null, codes: [], category: 'http' }
      : errorDetails(input.error)),
  };
}
