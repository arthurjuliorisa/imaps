import dayjs from 'dayjs';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';

// Deliberately not wired to a route. DB, spool and client gates remain pending.
export const CSV_ROW_LIMIT = 100_000;
export const CSV_TRIAL_BATCH_SIZE = 2_000;
export const CSV_HEADER = 'No,Sent At,Type,WMS ID,Activity,Status,Retries\r\n';

export class InswCsvError extends Error {
  constructor(public readonly code: 'UNSAFE_VALUE' | 'ROW_LIMIT' | 'BYTE_LIMIT' | 'ABORTED' | 'TIMEOUT' | 'SOURCE' | 'WRITE') {
    super({
      UNSAFE_VALUE: 'CSV export refused because a value may be changed or interpreted by spreadsheet software. Use Excel export or review the source data.',
      ROW_LIMIT: 'More than 100,000 logs match. Narrow the active filters and try again.',
      BYTE_LIMIT: 'CSV export exceeds the approved output size. Narrow the active filters and try again.',
      ABORTED: 'CSV export canceled.',
      TIMEOUT: 'CSV export exceeded the allowed generation time.',
      SOURCE: 'Unable to read CSV export data.',
      WRITE: 'Unable to write CSV export data.',
    }[code]);
    this.name = 'InswCsvError';
  }
}

export interface InswCsvRow {
  sent_at: Date | null;
  transaction_type: string;
  wms_id: string | null;
  insw_activity_code: string | null;
  insw_status: string;
  retry_count: number;
}

/** Syntax escaping only; spreadsheet policy is applied separately below. */
export function quoteCsv(value: string): string {
  return /[,"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function text(value: string | null, maxCharacters: number): string {
  if (value === null) return '';
  if (typeof value !== 'string' || value.length > maxCharacters * 2 ||
      Array.from(value).length > maxCharacters ||
      /^\s*[=+\-@]/u.test(value) || /^\s*[\t\r\n]/u.test(value)) {
    throw new InswCsvError('UNSAFE_VALUE');
  }
  // Detect known identifier-loss cases without transforming any value. Locale
  // date/number inference is not exhaustively detectable; Excel gate stays shut.
  const candidate = value.trim();
  if (/^\d+$/.test(candidate) && (candidate.length > 15 || /^0\d/.test(candidate))) {
    throw new InswCsvError('UNSAFE_VALUE');
  }
  return value;
}

export function encodeInswCsvRow(row: InswCsvRow, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > CSV_ROW_LIMIT ||
      !Number.isInteger(row.retry_count) || row.retry_count < -2147483648 || row.retry_count > 2147483647 ||
      (row.sent_at !== null && (!(row.sent_at instanceof Date) || !Number.isFinite(row.sent_at.getTime())))) {
    throw new InswCsvError('SOURCE');
  }
  return [String(ordinal), row.sent_at ? dayjs(row.sent_at).format('DD/MM/YYYY HH:mm:ss') : '',
    text(row.transaction_type, 20), text(row.wms_id, 100), text(row.insw_activity_code, 10),
    text(row.insw_status, 20), String(row.retry_count)].map(quoteCsv).join(',') + '\r\n';
}

/**
 * Isolated generation primitive, NOT an HTTP response or production spool.
 * Caller owns source cursor/filter/auth semantics and must discard all output
 * on failure. No operational defaults: budgets must be approved by the caller.
 * Each read settles honestly before returning on abort (no claimed DB cancel).
 */
export async function generateInswCsv(options: {
  nextBatch: (take: number) => Promise<readonly InswCsvRow[]>;
  destination: Writable;
  maxBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ rows: number; bytes: number }> {
  const { destination, maxBytes, timeoutMs, signal } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < Buffer.byteLength('\uFEFF' + CSV_HEADER) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
    throw new RangeError('Explicit positive output and deadline budgets are required.');
  }
  let failure: InswCsvError | undefined;
  const controller = new AbortController();
  const fail = (error: InswCsvError) => {
    failure ??= error;
    controller.abort();
    destination.destroy(failure);
  };
  const onError = () => { failure ??= new InswCsvError('WRITE'); };
  destination.on('error', onError);
  // Install immediately, including while the source read is pending.
  const completion = finished(destination, { cleanup: true }).then(() => undefined, () => {
    failure ??= new InswCsvError('WRITE');
  });
  const onAbort = () => fail(new InswCsvError('ABORTED'));
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => fail(new InswCsvError('TIMEOUT')), timeoutMs);
  let rows = 0;
  let bytes = 0;
  const check = () => {
    if (failure) throw failure;
    if (destination.destroyed || destination.writableEnded) throw new InswCsvError('WRITE');
  };
  const write = async (chunk: string) => {
    check();
    const size = Buffer.byteLength(chunk);
    if (bytes + size > maxBytes) throw new InswCsvError('BYTE_LIMIT');
    // Await both callback completion and drain when write returns false. Event
    // listeners are installed before write; no subsequent row/read can advance.
    await new Promise<void>((resolve, reject) => {
      let callbackDone = false;
      let drained = false;
      let returned = false;
      const cleanup = () => {
        destination.off('drain', onDrain);
        destination.off('error', onFailure);
        destination.off('close', onClose);
        controller.signal.removeEventListener('abort', onClose);
      };
      const settle = () => { if (returned && callbackDone && drained) { cleanup(); resolve(); } };
      const onFailure = () => { cleanup(); reject(failure ?? new InswCsvError('WRITE')); };
      const onClose = () => onFailure();
      const onDrain = () => { drained = true; settle(); };
      destination.once('drain', onDrain);
      destination.once('error', onFailure);
      destination.once('close', onClose);
      controller.signal.addEventListener('abort', onClose, { once: true });
      try {
        const accepted = destination.write(chunk, 'utf8', error => {
          if (error) { onFailure(); return; }
          callbackDone = true;
          settle();
        });
        drained ||= accepted;
        returned = true;
        settle();
      } catch { onFailure(); }
    });
    bytes += size;
  };
  try {
    if (signal?.aborted) onAbort();
    await write('\uFEFF' + CSV_HEADER);
    for (;;) {
      check();
      const take = Math.min(CSV_TRIAL_BATCH_SIZE, CSV_ROW_LIMIT + 1 - rows);
      let batch: readonly InswCsvRow[];
      try { batch = await options.nextBatch(take); }
      catch { throw failure ?? new InswCsvError('SOURCE'); }
      check();
      if (!Array.isArray(batch) || batch.length > take) throw new InswCsvError('SOURCE');
      if (batch.length === 0) break;
      for (const row of batch) {
        if (rows === CSV_ROW_LIMIT) throw new InswCsvError('ROW_LIMIT');
        await write(encodeInswCsvRow(row, rows + 1));
        rows++;
      }
      // Even short batches are followed to EOF: live-read adapters decide EOF.
    }
    check();
    destination.end();
    await completion;
    if (failure) throw failure;
    return { rows, bytes };
  } catch (error) {
    fail(error instanceof InswCsvError ? error : new InswCsvError('WRITE'));
    await completion;
    throw failure;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    destination.off('error', onError);
  }
}
