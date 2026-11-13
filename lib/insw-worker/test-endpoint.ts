type Env = Readonly<Record<string, string | undefined>>;

// Worker-only seam. Shared application transport never reads these settings.
export function resolveWorkerTestEndpoint(env: Env = process.env): string | undefined {
  const raw = env.INSW_TEST_ENDPOINT_OVERRIDE;
  const enabled = env.INSW_WORKER_TEST_MODE === 'true';
  if (!raw && !enabled) return undefined;
  const reject = () => { throw new Error('INSW_WORKER_TEST_ENDPOINT_REJECTED'); };
  if (!enabled || !['test', 'development'].includes(env.NODE_ENV ?? '') || !raw) return reject();
  let url: URL;
  try { url = new URL(raw); } catch { return reject(); }
  if (raw !== url.href || url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || !url.port || Number(url.port) < 1024 || url.username || url.password || url.search || url.hash
    || url.pathname !== '/api-prod/inventory/temp/transaksi') return reject();
  return url.href;
}

export function workerDispatchTransport(endpoint: string | undefined,
  transport?: (endpoint: string, init: RequestInit) => Promise<Response>) {
  // Preserve the service's existing proxy-aware transport when unset.
  if (!endpoint) return transport;
  return (_providerEndpoint: string, init: RequestInit) => (transport ?? fetch)(endpoint, init);
}
