import { config as loadEnv } from 'dotenv';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { options, inventory, select, environment, databaseEnvironment, dispatchBlockers, policyBudgets, credentialKeys, hash, requireSafe, type Entry, type Start, spacing } from './insw-sandbox-e2e/core';
import { submitOne } from './insw-sandbox-e2e/submission';
import { Evidence } from './insw-sandbox-e2e/evidence';
import { inspect, collisionIds, observe, preservation, type Observation } from './insw-sandbox-e2e/database';
import { verifyLocalApp, discoverLocalApp, inspectProcesses, ListenerError, type ProcessInspection } from './insw-sandbox-e2e/local-app';
import { reports, readinessRows, readinessTable } from './insw-sandbox-e2e/report';
import { type ProcessIdentity } from '../lib/insw-worker/process-identity';

type RecordState = { state: string; http?: number };
type Manifest = { version: 1; run: string; inputHash: string; selected: Entry[]; records: Record<string, RecordState>;
  posts: number; retries: number; max: number; profile: string; child?: ProcessIdentity; token?: string;
  target?: ReturnType<typeof environment>; before?: Record<string, unknown>; starts: Start[];
  workerDrained: boolean; finished: boolean; recovery?: string; lastError?: string };
const help = `INSW Sandbox E2E — no network/database access by default.
Defaults: ~/.local/share/imaps-insw-sandbox/{payloads.json,evidence} (missing evidence root is created privately, mode 0700).
Overrides: --payload-file <JSON> --evidence-root <private external directory>
Modes: --preflight-only (default, offline) | --verify-local-state (read-only DB) | --allow-real-sandbox
Target: --db imaps_db_vps --company 1370
Selection: --profile smoke|core|full (default smoke:3, core:10, full:363)
Budgets: --max-transmissions N --max-sandbox-posts N --max-retries 0..10 --timeout-minutes N
App listener: discovered automatically; optional --app-pid <actual listener PID>
Recovery: --resume <run-id> (same input and evidence root, original budgets retained)
Safety: --stop-on-unsafe (always enabled). No attach to an unowned worker; no Sandbox DELETE.
Configuration: repository .env is loaded once; explicit process variables take precedence.
INSW_SANDBOX_{PAYLOAD_FILE,EVIDENCE_ROOT,APP_URL,APP_PID} supply local defaults. See docs/insw-sandbox-e2e.md for verification and examples.
`;
let envLoaded = false;
export function loadRepositoryEnv(path = join(process.cwd(), '.env'), env: NodeJS.ProcessEnv = process.env) {
  loadEnv({ path, override: false, quiet: true, processEnv: env });
}
export async function main(args = process.argv.slice(2), local = {
  database: () => new PrismaClient(), processes: inspectProcesses as () => ProcessInspection | string[], app: discoverLocalApp,
}) {
  if (!envLoaded) { loadRepositoryEnv(); envLoaded = true; }
  const opts = options(args);
  if (opts.help) { process.stdout.write(help); return; }
  if (!existsSync(opts['payload-file'])) {
    process.stderr.write(`Missing payload file: ${opts['payload-file']}\n`); process.exitCode = 2; return;
  }
  requireSafe(statSync(opts['payload-file']).size <= 16 * 1024 * 1024, 'PAYLOAD_FILE_TOO_LARGE');
  const raw = readFileSync(opts['payload-file'], 'utf8');
  const input: unknown = JSON.parse(raw);
  const entries = await inventory(input);
  const tally = () => ({ objects: entries.length, uniqueIds: new Set(entries.map(e => e.id)).size,
    itemRows: entries.reduce((n,e) => n+e.items,0),
    byFamily: Object.fromEntries(Object.keys(domains).map(f => [f, entries.filter(e => e.family === f).length])),
    byState: Object.fromEntries(['ELIGIBLE','INVALID','UNSUPPORTED','PRE_EXISTING'].map(s => [s, entries.filter(e => e.state === s).length])) });
  const run = opts.resume ?? `sandbox-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
  const evidence = new Evidence(opts['evidence-root'], run, !!opts.resume);
  let m: Manifest = { version: 1, run, inputHash: hash(raw), selected: [], records: Object.create(null), starts: [], posts: opts.posts,
    retries: opts.retries, max: opts.max, profile: opts.profile!, workerDrained: false, finished: false };
  let db: PrismaClient | undefined; let worker: ChildProcess | undefined;
  let observation: Observation | undefined; let preserved: boolean | undefined; let duplicate: boolean | undefined;
  let blocker: string | undefined; let drained = false; let workerExited = false; let childError = false; let batchDone = false;
  const stop = new AbortController();
  let terminationReason: string | undefined;
  const cancel = () => { terminationReason = 'OPERATOR_INTERRUPTED'; stop.abort(); };
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const deadline = Date.now() + opts.timeoutMs;
  const timer = setTimeout(() => { terminationReason = 'RUN_TIMEOUT'; stop.abort(); }, opts.timeoutMs);
  const save = () => evidence.write('run-manifest.json', m);
  const progress = (message: string) => process.stdout.write(`${message}\n`);
  try {
    if (opts.resume) {
      m = evidence.read<Manifest>('run-manifest.json');
      m.records = Object.assign(Object.create(null), m.records);
      requireSafe(m.version === 1 && m.run === run && m.inputHash === hash(raw) && !m.finished, 'RESUME_INPUT_OR_RUN_MISMATCH_OR_FINISHED');
      requireSafe((!opts.explicitPosts || m.posts === opts.posts) && (!opts.explicitRetries || m.retries === opts.retries)
        && m.max === opts.max && m.profile === opts.profile, 'RESUME_BUDGETS_MUST_MATCH');
      opts.posts = m.posts; opts.retries = m.retries; opts.explicitPosts = true; opts.explicitRetries = true;
    }
    evidence.write('input-inventory.json', { ...tally(), contentHash: hash(raw), collisionsChecked: false, entries, validation: 'Current Zod schema; DB/business validation occurs only at real WMS API.' });
    const config = databaseEnvironment(process.env, opts);
    const target = config.target;
    const blockers = [...config.blockers, ...dispatchBlockers(process.env)];
    const preflight: Record<string, unknown> = {
      mode: opts.real ? 'REAL_SANDBOX' : opts['verify-local-state'] ? 'READ_ONLY_DATABASE' : 'SOURCE_ONLY',
      target, blockers, credentials: Object.fromEntries(credentialKeys.map(k => [k, process.env[k]?.trim() ? 'SET' : 'MISSING'])),
      stateVerification: 'NOT QUERIED: source-only mode', collisions: 'NOT VERIFIED', physicalSandbox: 'NOT RUN AT PREFLIGHT; physical results belong to assertions.json',
    };
    const writePreflight = () => {
      preflight.readiness = readinessRows(blockers, { state: preflight.state, processes: preflight.processes,
        app: preflight.app, budgets: preflight.budgets, appUrl: opts['app-url']! });
      evidence.write('preflight.json', preflight);
    };
    const printReadiness = () => { writePreflight(); progress(readinessTable(preflight.readiness as ReturnType<typeof readinessRows>)); };
    writePreflight();
    if (!opts.real && !opts['verify-local-state']) {
      printReadiness();
      progress(`Configuration blockers (DB/processes not inspected): ${blockers.join(', ') || 'none'}`);
      if (!opts.resume) m.selected = select(entries, opts.max, opts.profile!);
      m.target = target; save();
      progress(`Run ${run}: SOURCE_ONLY; ${entries.length} inputs, ${entries.filter(e => e.state === 'ELIGIBLE').length} schema eligible; collision state NOT VERIFIED.`);
      progress(`Inventory: ${JSON.stringify(tally())}`);
      progress(`Selected IDs: ${JSON.stringify(m.selected.map(e => e.id))}`);
      return;
    }
    try {
      const result = local.processes();
      preflight.processes = Array.isArray(result) ? { blockers: result, processes: [] } : result;
      blockers.push(...(Array.isArray(result) ? result : result.blockers));
    }
    catch { blockers.push('PROCESS_OWNERSHIP_UNREADABLE'); }
    try {
      if (config.blockers.length || !target) {
        preflight.stateVerification = `NOT QUERIED: ${config.blockers.join(', ')}`;
      } else {
        db = local.database();
        // Recovery is a write operation: read-only mode never enters it.
        if (opts.real && opts.resume && m.child && !blockers.length) { await recoverOwned(db, m); save(); }
        const state = await inspect(db, opts.explicitRetries ? opts.retries : undefined, opts.resume ? m.selected.map(e => e.id) : [], Number(target.port), target.role);
        preflight.stateVerification = 'QUERIED'; preflight.state = state;
        blockers.push(...state.blockers);
      }
    } catch (e) {
      preflight.stateVerification = `QUERY FAILED: ${safeCode(e)}`;
      blockers.push(safeCode(e));
    }
    // A proven live gate owner already blocks the same sender. Keep its PID
    // evidence, but avoid reporting that identical process as a second remedy.
    const inspected = preflight.state as Awaited<ReturnType<typeof inspect>> | undefined;
    const proc = preflight.processes as ProcessInspection | undefined;
    if (inspected?.gate?.owner && inspected.gate.identity.state === 'VERIFIED_LOCAL_OWNER_LIVE') {
      const senders = proc?.processes.filter(p => p.blocker === 'COMPETING_INSW_PROCESS_ACTIVE') ?? [];
      if (senders.length && senders.every(p => p.pid === inspected.gate!.identity.pid)) {
        const index = blockers.indexOf('COMPETING_INSW_PROCESS_ACTIVE');
        if (index !== -1) blockers.splice(index, 1);
        preflight.competingProcessCoveredByGate = true;
      }
    }
    let app: ReturnType<typeof verifyLocalApp> | undefined;
    try { app = local.app(opts['app-pid'], opts['app-url'], process.env); preflight.app = app; }
    catch (e) { const reason = safeCode(e); blockers.push(reason); preflight.app = { reason, candidates: e instanceof ListenerError ? e.candidates : [], requestedPid: /^[1-9]\d*$/.test(opts['app-pid'] ?? '') ? opts['app-pid'] : null }; }
    writePreflight();
    // Collision reads need a verified observed identity, but dispatch blockers
    // (credentials, competing worker, policy/backlog) must not hide collisions.
    const state = preflight.state as Awaited<ReturnType<typeof inspect>> | undefined;
    if (!db || !target || !state || state.blockers.some(b => b.startsWith('OBSERVED_'))) {
      printReadiness();
      progress(`DB: ${preflight.stateVerification}; blockers: ${blockers.join(', ')}`);
      if (blockers.includes('COMPETING_INSW_PROCESS_ACTIVE')) progress('Competing worker active: verify no in-flight/busy/unfinished attempt before pm2 stop imaps-insw-worker; confirm stopped with pm2 status, then rerun.');
      requireSafe(false, blockers[0] ?? 'DATABASE_NOT_VERIFIED');
    }
    progress(`Gate/counts: ${JSON.stringify({ gate: state.gate, counts: state.counts })}`);
    progress(`Observed DB identity: ${JSON.stringify(state.identity)}`);
    const collisions = await collisionIds(db, entries.map(e => e.id).filter(Boolean));
    for (const entry of entries) if (entry.state === 'ELIGIBLE' && collisions.has(entry.id)) entry.state = 'PRE_EXISTING';
    if (!opts.resume) m.selected = select(entries, opts.max, opts.profile!);
    else {
      requireSafe(m.selected.every(e => entries.some(x => x.id === e.id && x.index === e.index)), 'RESUME_SELECTION_MISMATCH');
      // Existing IDs are expected only where an intent was durably recorded.
      requireSafe(m.selected.every(e => !collisions.has(e.id) || m.records[e.id]), 'RESUME_UNOWNED_COLLISION');
    }
    if (!m.selected.length) blockers.push('NO_ELIGIBLE_COLLISION_FREE_INPUTS');
    const budgets = policyBudgets(opts, m.selected.length, state.policy);
    preflight.budgets = budgets; blockers.push(...budgets.blockers.filter(b => !blockers.includes(b)));
    m.retries = budgets.retries; m.posts = budgets.posts;
    opts.retries = m.retries; opts.posts = m.posts;
    m.target = target;
    evidence.write('input-inventory.json', { ...tally(), entries, selectedIds: m.selected.map(e => e.id), collisionsChecked: true });
    preflight.collisions = 'CHECKED'; preflight.inventory = tally(); writePreflight();
    save();
    progress(`Run ${run}: company 1370; DB ${target.host}:${target.port}/${target.database}; Sandbox ${target.destination}`);
    progress(`Inventory: ${JSON.stringify(tally())}`);
    progress(`Maximum WMS submissions ${m.selected.length}; maximum Sandbox POSTs ${m.posts}; retries <= ${m.retries}.`);
    progress(`Selected IDs: ${JSON.stringify(m.selected.map(e => e.id))}`);
    printReadiness();
    progress(`DB: ${preflight.stateVerification}; dispatch: ${blockers.length ? 'BLOCKED: ' + blockers.join(', ') : 'READY (real opt-in required)'}`);
    if (blockers.includes('COMPETING_INSW_PROCESS_ACTIVE')) progress('Verify no in-flight request or busy/unfinished DB attempt, then pm2 stop imaps-insw-worker; confirm stopped with pm2 status and rerun. Never stop a busy sender.');
    requireSafe(!blockers.length, blockers[0]);
    if (!opts.real) return;
    requireSafe(!entries.some(e => e.issues.includes('WRONG_COMPANY_OR_OWNER')), 'INPUT_COMPANY_MISMATCH');
    requireSafe(app, 'APP_NOT_VERIFIED');
    opts['app-pid'] = String(app.pid);
    evidence.write('app-verification.json', app);
    const ids = m.selected.map(e => e.id);
    if (!m.before) { m.before = await preservation(db, ids); save(); }
    const priorObservation = await observe(db, ids);
    // An unobserved/crashed attempt must consume budget conservatively, even
    // when a sender timestamp was lost. Never replenish the cap on resume.
    const usedPostBudget = Math.max(m.starts.length, priorObservation.attempts.length);
    requireSafe(usedPostBudget < m.posts, 'SANDBOX_POST_BUDGET_EXHAUSTED');
    m.token = undefined; m.workerDrained = false; save();
    worker = fork(join(__dirname, 'insw-sandbox-e2e/worker.ts'), [], {
      execArgv: ['--import', 'tsx'], env: { ...process.env, INSW_SANDBOX_CHILD: String(process.pid) },
      // App/service loggers may contain provider payloads; never capture or echo them.
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    worker.once('exit', (code, signal) => { workerExited = true; if (code !== 0 || signal) { childError = true; stop.abort(); } });
    worker.once('error', () => { childError = true; stop.abort(); });
    worker.on('message', (msg: { type: string; identity?: ProcessIdentity; data?: { token?: string }; start?: Start }) => {
      if (msg.type === 'identity') {
        if (!msg.identity || msg.identity.pid !== worker?.pid) { childError = true; stop.abort(); return; }
        m.child = msg.identity; save(); if (worker?.connected) worker.send({ type: 'identity-saved' });
      }
      if (msg.type === 'owned') { m.token = msg.data?.token; save(); }
      if (msg.type === 'post' && msg.start) {
        m.starts.push(msg.start); save();
        progress(`Sandbox POST #${m.starts.length}; queue ${msg.start.queue_id}`);
        if (m.starts.length > 1) { const timing = spacing(m.starts, true);
          progress(`minimum observed gap ${timing.min_ns}ns; violations ${timing.violations} (partial observation)`); }
      }
      if (msg.type === 'drained') drained = true;
      if (msg.type === 'unsafe-exit') { childError = true; stop.abort(); }
    });
    worker.send({ type: 'start', ids, posts: m.posts - usedPostBudget, retries: m.retries });
    // Wait for sticky ownership before admitting any WMS writes.
    while (!m.token && !workerExited && !stop.signal.aborted) await delay(100);
    requireSafe(m.token && !childError && !workerExited && !stop.signal.aborted, 'WORKER_STARTUP_NOT_VERIFIED');
    for (const entry of m.selected) {
      if (stop.signal.aborted || workerExited || childError) break;
      if (m.records[entry.id]) continue; // Includes ambiguous submission: never silently replay.
      verifyLocalApp(opts['app-pid'], opts['app-url'], process.env);
      await submitOne({ signal: stop.signal, deadline,
        record: record => { m.records[entry.id] = record; save(); },
        collision: async () => (await collisionIds(db!, [entry.id])).has(entry.id),
        pause: async ms => { await delay(ms, undefined, { signal: stop.signal }).catch(() => undefined); },
        request: () => fetch(`${app.url}/api/v1/${route(entry)}`, { method: 'POST', redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.API_KEY! },
          body: JSON.stringify((input as unknown[])[entry.index]),
          signal: AbortSignal.any([stop.signal, AbortSignal.timeout(30000)]) }),
      });
      progress(`submitted ${Object.keys(m.records).length}/${m.selected.length}`);
      // Sequential API pacing is independent of the worker's global POST gate.
      await delay(250, undefined, { signal: stop.signal }).catch(() => undefined);
    }
    while (!stop.signal.aborted && !childError) {
      observation = await observe(db, ids);
      evidence.write('observations.json', observation);
      const foreign = await db.insw_queue_cycle.count({ where: { status: { in: ['READY','CLAIMED','REMOTE_SUCCEEDED'] },
        NOT: { company_code: 1370, wms_reference: { in: ids } } } });
      requireSafe(foreign === 0, 'UNEXPECTED_OTHER_PRODUCER');
      const done = m.selected.every(e => m.records[e.id]?.state === 'WMS_REJECTED' || observation!.queue.some(q =>
        q.wms_reference === e.id && ['HELD','SUCCEEDED','FAILED'].includes(q.status)));
      if (done) batchDone = true;
      if (done || workerExited) break;
      await delay(1500, undefined, { signal: stop.signal }).catch(() => undefined);
    }
    requireSafe(!childError, 'WORKER_UNEXPECTED_EXIT');
  } catch (error) { blocker = safeCode(error); m.lastError = blocker; process.exitCode = 2; }
  finally {
    const cancelled = stop.signal.aborted;
    if (opts.real && terminationReason && !batchDone) blocker ??= terminationReason;
    stop.abort(); clearTimeout(timer);
    if (worker && !workerExited && worker.connected) worker.send({ type: 'stop' });
    // Graceful request/body drain only; never kill a post-start child.
    const drainDeadline = Date.now()+90000;
    while (worker && !workerExited && Date.now() < drainDeadline) await delay(200);
    if (worker && !workerExited) { blocker ??= 'OWNED_CHILD_DRAIN_NOT_VERIFIED'; worker.disconnect(); process.exitCode = 2; }
    m.workerDrained = drained && workerExited && !childError;
    if (worker && !m.workerDrained) { blocker ??= 'OWNED_WORKER_DRAIN_NOT_VERIFIED'; process.exitCode = 2; }
    if (db && opts.real && m.selected.length) {
      try {
        observation = await observe(db, m.selected.map(e => e.id));
        evidence.write('observations.json', observation);
        if (m.workerDrained) { await recoverOwned(db, m); }
        // Core duplicate probe is API-only after the sender child has exited.
        if (!cancelled && batchDone && m.workerDrained && !blocker && m.profile !== 'smoke' && !opts.resume) {
          const candidate = m.selected.find(e => observation!.queue.some(q => q.wms_reference === e.id && q.status === 'SUCCEEDED'));
          if (candidate) {
            const app = verifyLocalApp(opts['app-pid'], opts['app-url'], process.env);
            const response = await fetch(`${app.url}/api/v1/${route(candidate)}`, { method: 'POST', redirect: 'error',
              headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.API_KEY! },
              body: JSON.stringify((input as unknown[])[candidate.index]), signal: AbortSignal.timeout(30000) });
            await response.body?.cancel();
            const after = await observe(db, m.selected.map(e => e.id));
            duplicate = response.status === 409 && after.queue.length === observation.queue.length
              && after.attempts.length === observation.attempts.length && after.sources.length === observation.sources.length;
            evidence.write('duplicate-check.json', { wms_id: candidate.id, http: response.status, before: { queue: observation.queue.length,
              attempts: observation.attempts.length, sources: observation.sources.length }, after: { queue: after.queue.length,
              attempts: after.attempts.length, sources: after.sources.length }, pass: duplicate });
            observation = after;
          }
        }
        if (m.before) {
          const after = await preservation(db, m.selected.map(e => e.id));
          preserved = JSON.stringify(m.before) === JSON.stringify(after);
          evidence.write('preservation.json', { before: m.before, after, preserved,
            scope: 'All five WMS source header/item tables excluding run company+WMS IDs; aggregate fingerprints, not a cryptographic audit of all database tables.' });
        }
      } catch (e) { blocker ??= safeCode(e); process.exitCode = 2; }
    }
    if (!opts.real) m.workerDrained = false;
    if (blocker) progress(`BLOCKED: ${blocker}`);
    m.lastError = blocker;
    const assertions = reports(evidence, m.selected, m.records, observation, m.starts, m.workerDrained, opts.real, preserved, duplicate, blocker);
    m.finished = opts.real && m.workerDrained && !!observation && m.selected.every(e =>
      m.records[e.id]?.state === 'WMS_REJECTED' || observation!.queue.some(q => q.wms_reference === e.id && ['SUCCEEDED','FAILED','HELD'].includes(q.status)));
    save();
    if (assertions.some(a => a.status === 'FAIL' || a.status === 'BLOCKED')) process.exitCode = 2;
    progress(`Evidence: ${evidence.dir}; physical acceptance ${opts.real ? 'see assertions.json (partial coverage is explicit)' : 'NOT RUN'}`);
    await db?.$disconnect(); evidence.close();
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}
import { domains } from './insw-sandbox-e2e/core';
function route(entry: Entry) { requireSafe(entry.family, 'UNSUPPORTED_ROUTE'); return domains[entry.family].route; }
function safeCode(error: unknown) {
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (typeof prismaCode === 'string' && /^P[0-9]{4}$/.test(prismaCode)) return `DATABASE_QUERY_FAILED_${prismaCode}`;
  const code = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]{1,150}$/.test(code) ? code : 'RUNNER_ERROR_DETAILS_WITHHELD';
}
async function recoverOwned(db: PrismaClient, m: Manifest) {
  const gate = await db.insw_dispatch_gate.findUnique({ where: { id: 1 } });
  if (!gate?.owner_token) return;
  const { sameIdentity } = await import('../lib/insw-worker/clone-fence');
  requireSafe(m.child && sameIdentity(gate.process_identity as unknown as ProcessIdentity, m.child)
    && (!m.token || gate.owner_token === m.token) && !gate.busy_attempt_id, 'OWNED_RECOVERY_NOT_PROVEN_OR_BUSY');
  const { recoverOperationalOwnership } = await import('../lib/insw-worker/operational.repository');
  await recoverOperationalOwnership(db, { expectedToken: gate.owner_token, operator: 'sandbox-e2e-runner',
    evidence: `Runner ${m.run}; exact child identity persisted before dispatch; child reaped; no background HTTP or busy attempt.`, shutdownAcknowledged: true });
  m.recovery = 'EXISTING_RECOVERY_API_EXACT_REAPED_CHILD'; m.token = undefined;
}
if (require.main === module) main().catch(error => { process.stderr.write(`SANDBOX_RUNNER_REFUSED: ${safeCode(error)} (see --help)\n`); process.exitCode = 2; });
