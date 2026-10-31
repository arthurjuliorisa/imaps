import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, rename, rmdir, statfs, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { CSV_HEADER, encodeInswCsvRow, InswCsvError, type InswCsvRow } from './insw-logs-csv';
import { CSV_ROW_LIMIT, generateCsv } from './logs-csv';

export interface CsvSpoolConfig {
  root: string;
  maxBytes: number;
  quotaBytes: number;
  reserveBytes: number;
  generationMs: number;
  deliveryMs: number;
}

export function csvSpoolConfig(env = process.env): CsvSpoolConfig {
  const production = env.NODE_ENV === 'production';
  const number = (key: string, fallback: number) => {
    const raw = env[`INSW_CSV_${key}`];
    if (production && !raw) throw new Error('CSV production configuration missing');
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('CSV configuration invalid');
    return value;
  };
  if (production && (env.INSW_CSV_OPERATIONS_VERIFIED !== 'yes' || !env.INSW_CSV_SPOOL_DIR)) {
    throw new Error('CSV production operations not verified');
  }
  const root = env.INSW_CSV_SPOOL_DIR || join(tmpdir(), `imaps-insw-csv-${process.getuid?.() ?? 'local'}`);
  const config = { root, maxBytes: number('MAX_BYTES', 64 * 1024 * 1024),
    quotaBytes: number('QUOTA_BYTES', 128 * 1024 * 1024), reserveBytes: number('RESERVE_BYTES', 128 * 1024 * 1024),
    generationMs: number('GENERATION_MS', 120_000), deliveryMs: number('DELIVERY_MS', 120_000) };
  if (!isAbsolute(root) || config.quotaBytes < config.maxBytes ||
      !Number.isSafeInteger(config.maxBytes + config.reserveBytes) ||
      config.generationMs > 2147483647 || config.deliveryMs > 2147483647) throw new Error('CSV configuration invalid');
  // Never allow a spool inside Next's public tree.
  if (resolve(root) === resolve('public') || resolve(root).startsWith(resolve('public') + '/')) throw new Error('CSV spool must be private');
  return config;
}

// Shared by INSW and WMS across development module reloads. PER-PROCESS only.
// Keep the existing global key so an INSW reservation survives hot reloads.
const state = globalThis as typeof globalThis & { __inswCsvActive?: boolean };
export function reserveCsvExport(): (() => void) | undefined {
  if (state.__inswCsvActive) return;
  state.__inswCsvActive = true;
  return () => { state.__inswCsvActive = false; };
}

async function privateDirectory(path: string) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())) throw new Error('CSV spool is not owner-private');
}

const ownerPattern = /^owner-([1-9][0-9]*)-[0-9a-f-]{36}$/;
const artifactPattern = /^[0-9a-f-]{36}\.(part|csv)$/;
/** Only aged, same-uid owner directories whose PID provably no longer exists.
 * PID reuse/permission uncertainty leaves artifacts untouched. No recursive rm. */
async function reapOrphans(root: string) {
  let inspected = 0;
  const entries = await opendir(root);
  for await (const entry of entries) {
    if (++inspected > 256) throw new Error('CSV spool requires operator cleanup');
    const match = ownerPattern.exec(entry.name);
    if (!match) continue;
    const directory = join(root, entry.name);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) ||
        (process.getuid && info.uid !== process.getuid()) || Date.now() - info.mtimeMs < 86_400_000) continue;
    try { process.kill(Number(match[1]), 0); continue; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
    let inspectedFiles = 0;
    for await (const fileEntry of await opendir(directory)) {
      if (++inspectedFiles > 256) throw new Error('CSV spool requires operator cleanup');
      const file = fileEntry.name;
      if (!artifactPattern.test(file)) continue;
      const path = join(directory, file);
      const stat = await lstat(path);
      if (stat.isFile() && !stat.isSymbolicLink() && (!process.getuid || stat.uid === process.getuid()) &&
          Date.now() - stat.mtimeMs >= 86_400_000) await unlink(path);
    }
    await rmdir(directory).catch(error => { if (error.code !== 'ENOTEMPTY') throw error; });
  }
}

/** Account for retained crash artifacts before reserving the full byte budget.
 * This check is conservative, per-process admission is not a cross-worker lock.
 * A shared/multi-host spool requires externally enforced quotas/coordination. */
async function spoolUsage(root: string): Promise<number> {
  let bytes = 0, directories = 0;
  for await (const entry of await opendir(root)) {
    if (++directories > 256 || !ownerPattern.test(entry.name)) throw new Error('CSV spool requires operator inspection');
    const directory = join(root, entry.name);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) ||
        (process.getuid && info.uid !== process.getuid())) throw new Error('CSV spool ownership invalid');
    let files = 0;
    for await (const file of await opendir(directory)) {
      if (++files > 256 || !artifactPattern.test(file.name)) throw new Error('CSV spool requires operator inspection');
      const stat = await lstat(join(directory, file.name));
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) ||
          (process.getuid && stat.uid !== process.getuid())) throw new Error('CSV artifact ownership invalid');
      bytes += stat.size;
      if (!Number.isSafeInteger(bytes)) throw new Error('CSV spool quota exceeded');
    }
  }
  return bytes;
}

/** Owns admission through completed delivery AND filesystem cleanup. The source
 * is sequential and checks this signal/deadline; an in-flight DB query still
 * settles before generation cleanup and admission release. */
export async function stageLogsCsvDownload<Row>(options: {
  header: string;
  encodeRow: (row: Row, ordinal: number) => string;
  config: CsvSpoolConfig;
  signal: AbortSignal;
  release: () => void;
  source: (controls: { signal: AbortSignal; checkDeadline: () => void }) => (take: number) => Promise<readonly Row[]>;
  filename: string;
}): Promise<Response> {
  const { config, signal } = options;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const deadline = Date.now() + config.generationMs;
  const checkDeadline = () => {
    if (controller.signal.aborted) throw new InswCsvError('ABORTED');
    if (Date.now() >= deadline) throw new InswCsvError('TIMEOUT');
  };
  let directory: string | undefined;
  let path: string | undefined;
  let reader: Awaited<ReturnType<typeof open>> | undefined;
  let deliveryTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let stopped = false;
  // Serialize cleanup behind an in-flight file read (including cancellation).
  let reading: Promise<unknown> = Promise.resolve();
  const cleanup = () => cleanupPromise ??= (async () => {
    stopped = true;
    clearTimeout(deliveryTimer);
    signal.removeEventListener('abort', abort);
    signal.removeEventListener('abort', abortDelivery);
    await reading.catch(() => undefined);
    await reader?.close();
    if (path) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (directory) await rmdir(directory);
    // Fail closed: a failed cleanup retains admission, requiring operator repair.
    options.release();
  })();
  let webController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const abortDelivery = () => {
    if (stopped) return;
    webController?.error(new Error('CSV delivery interrupted'));
    void cleanup().catch(() => { console.error('CSV cleanup failed; admission retained'); });
  };
  try {
    checkDeadline();
    await privateDirectory(config.root);
    const actualRoot = await realpath(config.root);
    const publicRoot = await realpath('public');
    if (actualRoot === publicRoot || actualRoot.startsWith(publicRoot + '/')) throw new Error('CSV spool must be private');
    await reapOrphans(config.root);
    const usedBytes = await spoolUsage(config.root);
    if (usedBytes > config.quotaBytes - config.maxBytes) throw new Error('CSV spool quota unavailable');
    const disk = await statfs(config.root);
    if (disk.bavail * disk.bsize < config.maxBytes + config.reserveBytes) throw new Error('CSV disk headroom unavailable');
    directory = join(config.root, `owner-${process.pid}-${randomUUID()}`);
    await privateDirectory(directory);
    const artifact = randomUUID();
    path = join(directory, artifact + '.part');
    const nextBatch = options.source({ signal: controller.signal, checkDeadline });
    const destination = createWriteStream(path, { flags: 'wx', mode: 0o600 });
    // Observe close before generation starts; finished() alone need not prove close.
    const closed = new Promise<void>(resolve => destination.once('close', resolve));
    let result: { rows: number; bytes: number };
    try {
      result = await generateCsv({ nextBatch, header: options.header, encodeRow: options.encodeRow,
        destination, maxBytes: Math.min(config.maxBytes, config.quotaBytes), timeoutMs: config.generationMs,
        signal: controller.signal });
    } finally {
      destination.destroy();
      await closed;
    }
    checkDeadline();
    reader = await open(path, 'r');
    const stat = await reader.stat();
    const header = Buffer.from('\uFEFF' + options.header);
    const head = Buffer.alloc(header.length);
    const tail = Buffer.alloc(2);
    await reader.read(head, 0, head.length, 0);
    await reader.read(tail, 0, 2, stat.size - 2);
    if (!stat.isFile() || stat.size !== result.bytes || stat.size < header.length ||
        stat.size > config.maxBytes || !head.equals(header) || tail.toString() !== '\r\n' ||
        !Number.isInteger(result.rows) || result.rows < 0 || result.rows > CSV_ROW_LIMIT ||
        (result.rows === 0) !== (stat.size === header.length)) throw new Error('CSV verification failed');
    await reader.close(); reader = undefined;
    const completed = join(directory, artifact + '.csv');
    await rename(path, completed); path = completed;
    reader = await open(path, 'r');
    checkDeadline();
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      start(value) { webController = value; },
      async pull(value) {
        if (stopped) return;
        try {
          const bytes = Buffer.alloc(Math.min(64 * 1024, stat.size - offset));
          const read = reader!.read(bytes, 0, bytes.length, offset);
          reading = read;
          const { bytesRead } = await read;
          if (stopped) return;
          if (!bytesRead) throw new Error('CSV artifact ended early');
          offset += bytesRead;
          value.enqueue(bytes.subarray(0, bytesRead));
          if (offset === stat.size) { await cleanup(); value.close(); }
        } catch {
          try { value.error(new Error('CSV delivery failed')); } catch { /* Already canceled. */ }
          await cleanup().catch(() => { console.error('CSV cleanup failed; admission retained'); });
        }
      },
      async cancel() { await cleanup(); },
    }, { highWaterMark: 0 });
    signal.addEventListener('abort', abortDelivery, { once: true });
    deliveryTimer = setTimeout(abortDelivery, config.deliveryMs);
    if (signal.aborted) { abortDelivery(); throw new InswCsvError('ABORTED'); }
    return new Response(body, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${options.filename}"`,
      'Content-Length': String(stat.size), 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    await cleanup().catch(() => { console.error('CSV cleanup failed; admission retained'); });
    throw error;
  }
}

/** Original INSW policy adapter; both domains use the same lifecycle and reservation. */
export function stageCsvDownload(options: Omit<Parameters<typeof stageLogsCsvDownload<InswCsvRow>>[0], 'header' | 'encodeRow'>) {
  return stageLogsCsvDownload({ ...options, header: CSV_HEADER, encodeRow: encodeInswCsvRow });
}
