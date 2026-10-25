import { integer } from '../insw-queue/contracts';
import { verifiedPayload } from './safety';
import { Classification, classifyResponse, classifyTransportFailure, classifyLocalFailure } from './classification';

export type Delivery = 'NOT_STARTED' | 'POSSIBLY_STARTED' | 'KNOWN_SUCCESS';
export type Outcome = {
  phase: 'PREFLIGHT' | 'REQUEST' | 'BODY' | 'RESPONSE';
  errorClass: 'INVALID_PAYLOAD' | 'TIMEOUT' | 'CANCELLED' | 'DNS' | 'CONNECTION' | 'NETWORK' | 'HTTP_ERROR' | 'INVALID_JSON' | 'INVALID_RESPONSE' | 'BUSINESS_REJECTION' | null;
  delivery: Delivery;
  httpCode: number | null;
  businessCode: string | null;
  retryAfter: string | null;
  // Invocation timestamps, not proof of bytes on the wire or remote execution.
  requestInvokedAt: number | null;
  endedAt: number;
  autoRetry: false;
  classification: Classification;
  // Opt-in authorized domain evidence. Never emit this in diagnostics/events.
  responseEvidence?: { state: 'COMPLETE' | 'UNAVAILABLE' | 'TOO_LARGE'; raw: string | null; bytes: number;
    contentType?: string; statusText?: string };
};
export const MAX_RESPONSE_BYTES = 1024 * 1024;

async function boundedBody(response: Response, signal: AbortSignal, evidence: NonNullable<Outcome['responseEvidence']>) {
  if (!response.body) { evidence.state = 'COMPLETE'; evidence.raw = ''; return ''; }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let cancellation: Promise<void> | undefined;
  const cancel = () => { cancellation ??= reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('INTERRUPTED');
      if (done) break;
      evidence.bytes += value.byteLength;
      if (evidence.bytes > MAX_RESPONSE_BYTES) {
        evidence.state = 'TOO_LARGE';
        cancel(); await cancellation;
        throw new Error('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
    // Decode once; legacy JSON fields retain the actual response, not a digest.
    const raw = Buffer.concat(chunks).toString('utf8');
    evidence.state = 'COMPLETE'; evidence.raw = raw;
    return raw;
  } finally {
    signal.removeEventListener('abort', cancel);
    // reader.read() can settle before an asynchronous underlying cancel hook.
    // The worker's body promise must cover that hook too, retaining the stream.
    await cancellation;
    reader.releaseLock();
  }
}
// Deliberately injected: no default fetch, URL, headers, credentials, proxy or sender.
// A future reviewed adapter must preserve company mode/proxy/toggles and persist
// POSSIBLY_STARTED under proven global ownership BEFORE invoking this primitive.
export type RequestPrimitive = (body: string, signal: AbortSignal, onInvoked?: () => void) => Promise<Response>;

export async function executeFrozenRequest(input: {
  payload: unknown; sha256: string; timeoutMs: number; request: RequestPrimitive;
  signal?: AbortSignal; now?: () => number;
  captureResponse?: boolean; onBodyRead?: (body: Promise<string>) => void;
}): Promise<Outcome> {
  integer(input.timeoutMs, 'request timeout', 1, 300000);
  const now = input.now ?? Date.now;
  const base: Outcome = { phase: 'PREFLIGHT', errorClass: null, delivery: 'NOT_STARTED', httpCode: null,
    businessCode: null, retryAfter: null, requestInvokedAt: null, endedAt: now(), autoRetry: false,
    classification: { kind: 'UNKNOWN', reasonCode: 'NOT_STARTED', retryCandidate: false } };
  if (input.captureResponse) base.responseEvidence = { state: 'UNAVAILABLE', raw: null, bytes: 0 };
  let body: string;
  try { body = verifiedPayload(input.payload, input.sha256); }
  catch { return { ...base, errorClass: 'INVALID_PAYLOAD', classification: classifyLocalFailure('DATA'), endedAt: now() }; }
  if (input.signal?.aborted) return { ...base, errorClass: 'CANCELLED', endedAt: now() };
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => { controller.abort(); reject(new Error('INTERRUPTED')); };
    timer = setTimeout(() => { timedOut = true; cancel(); }, input.timeoutMs);
  });
  // Consume rejection even when cancellation wins before invocation.
  void interrupted.catch(() => undefined);
  input.signal?.addEventListener('abort', cancel, { once: true });
  // Close the race between the initial check and listener installation.
  if (input.signal?.aborted) cancel();
  try {
    if (controller.signal.aborted) return { ...base, errorClass: 'CANCELLED', endedAt: now() };
    base.phase = 'REQUEST';
    base.delivery = 'POSSIBLY_STARTED';
    base.requestInvokedAt = now();
    const response = await Promise.race([input.request(body, controller.signal), interrupted]);
    base.httpCode = response.status;
    if (base.responseEvidence) {
      base.responseEvidence.contentType = (response.headers.get('content-type') ?? '').slice(0, 200);
      base.responseEvidence.statusText = response.statusText.slice(0, 200);
    }
    const retryAfter = response.headers.get('retry-after');
    // No arbitrary headers, response bodies, exception messages or secrets returned.
    base.retryAfter = retryAfter && /^[\x20-\x7e]{1,100}$/.test(retryAfter) ? retryAfter : null;
    base.phase = 'BODY';
    const reading = input.captureResponse ? boundedBody(response, controller.signal, base.responseEvidence!) : response.text();
    input.onBodyRead?.(reading);
    const raw = await Promise.race([reading, interrupted]);
    base.phase = 'RESPONSE';
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return { ...base, errorClass: response.ok ? 'INVALID_JSON' : 'HTTP_ERROR', classification: classifyResponse(response.status, undefined, input.payload), endedAt: now() }; }
    // Use the exact verified request JSON, never rebuild from mutable sources.
    base.classification = classifyResponse(response.status, parsed, JSON.parse(body));
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    const code = record?.code;
    base.businessCode = typeof code === 'number' && Number.isFinite(code) ? String(code)
      : typeof code === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(code) ? code : null;
    // HTTP status takes precedence over a contradictory {status:true} body.
    if (!response.ok) return { ...base, errorClass: 'HTTP_ERROR', endedAt: now() };
    if (!record || typeof record.status !== 'boolean') return { ...base, errorClass: 'INVALID_RESPONSE', endedAt: now() };
    if (!record.status) return { ...base, errorClass: 'BUSINESS_REJECTION', endedAt: now() };
    return { ...base, delivery: 'KNOWN_SUCCESS', endedAt: now() };
  } catch (error) {
    if (base.responseEvidence?.state === 'TOO_LARGE') return { ...base, errorClass: 'INVALID_RESPONSE',
      classification: { kind: 'UNKNOWN', reasonCode: 'RESPONSE_TOO_LARGE', retryCandidate: false }, endedAt: now() };
    const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
    const errorClass = timedOut ? 'TIMEOUT' : input.signal?.aborted ? 'CANCELLED'
      : base.phase === 'REQUEST' && ['ENOTFOUND', 'EAI_AGAIN'].includes(code ?? '') ? 'DNS'
      : base.phase === 'REQUEST' && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code ?? '') ? 'CONNECTION' : 'NETWORK';
    return { ...base, errorClass, classification: classifyTransportFailure(errorClass, code), endedAt: now() };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', cancel);
    // Abort cannot prove delivery failure. Never release a global stream lease
    // merely because this bounded local wait ended: the primitive may still run.
    controller.abort();
  }
}
