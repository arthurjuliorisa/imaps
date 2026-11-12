import { readFileSync, readlinkSync, readdirSync, realpathSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { requireSafe, databaseEnvironment, dispatchBlockers, options } from './core';

const keys = ['DATABASE_URL', 'DATABASE_PHASE', 'NEXT_PUBLIC_ENVIRONMENT_PHASE', 'API_KEY', 'INSW_1370_USE_TEST_MODE',
  'INSW_1370_API_KEY', 'INSW_1370_UNIQUE_KEY_TEST', 'INSW_1370_UNIQUE_KEY_REAL', 'HTTP_PROXY', 'HTTPS_PROXY',
  'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
const readEnv = (base: string): NodeJS.ProcessEnv => Object.fromEntries(readFileSync(`${base}/environ`, 'utf8').split('\0').filter(Boolean).map(s => {
  const n = s.indexOf('='); return [s.slice(0, n), s.slice(n + 1)];
})) as NodeJS.ProcessEnv;
const code = (e: unknown) => e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : 'PROCESS_DETAILS_UNREADABLE';
const parentPid = (base: string) => { const s = readFileSync(`${base}/stat`, 'utf8'); return Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]); };
export type ProcessEvidence = { pid: number; cwd: string | null; kind: string; executable: string | null; reason?: string; blocker?: string };
export type ProcessInspection = { blockers: string[]; processes: ProcessEvidence[]; pm2: { name: string; recordedPid: number | null; recordedStatus: string; live: boolean }[] };

// Never expose arbitrary argv or environments: either may contain credentials.
export function inspectProcesses(root = '/proc', pm2Home = process.env.PM2_HOME || join(process.env.HOME || '', '.pm2')): ProcessInspection {
  const processes: ProcessEvidence[] = [];
  const ancestors = new Set<number>([process.pid]);
  if (root === '/proc') {
    let parent = process.ppid;
    while (parent > 0 && !ancestors.has(parent)) {
      ancestors.add(parent);
      try { parent = parentPid(`${root}/${parent}`); } catch { break; }
    }
  }
  const checkout = realpathSync(process.cwd());
  const pids = readdirSync(root).filter(p => /^[1-9]\d*$/.test(p));
  // Match launch purpose, independently of Node's location or the process cwd.
  const senderLaunch = /(?:^|[\s/])(?:insw-worker|insw-isolated-worker|insw-sandbox-e2e)(?:\.[cm]?[jt]s|[\s/]|$)/;
  for (const pid of pids) {
    if (ancestors.has(Number(pid))) continue;
    const base = `${root}/${pid}`;
    let command = ''; let penv: Partial<NodeJS.ProcessEnv> = {}; let unreadable = false;
    // Read each identity source once: a PM2 label can identify a sender even
    // when argv is unavailable, and argv must survive an unreadable environ.
    try { command = readFileSync(`${base}/cmdline`, 'utf8').replaceAll('\0', ' '); } catch { unreadable = true; }
    try { penv = readEnv(base); } catch { unreadable = true; }
    const labels = `${penv.name || ''} ${penv.pm_exec_path || ''} ${penv.npm_lifecycle_script || ''}`;
    const reason = penv.name === 'imaps-insw-worker' ? 'PM2_INSW_WORKER'
      : senderLaunch.test(`${command} ${labels}`) ? 'INSW_SENDER_LAUNCH'
      : /^[1-9]\d*$/.test(penv.INSW_SANDBOX_CHILD ?? '') ? 'RUNNER_DISPATCHER_CHILD' : undefined;
    let cwd: string | null = null; let executable: string | null = null;
    // Unrelated Node tools are not candidates, even in the checkout. An
    // unreadable process is fail-closed only with concrete sender evidence.
    if (!reason && !/next-server|(?:^|[ /])next(?:[ /]|$)/.test(command + labels)) continue;
    try { cwd = realpathSync(`${base}/cwd`); } catch { /* Named foreign workers still block. */ }
    try { executable = readlinkSync(`${base}/exe`); } catch { /* Sender evidence still blocks. */ }
    if (reason) {
      processes.push({ pid: Number(pid), cwd, executable, reason, kind: unreadable ? 'UNREADABLE' : 'INSW_SENDER',
        blocker: unreadable ? 'PROCESS_OWNERSHIP_UNREADABLE' : 'COMPETING_INSW_PROCESS_ACTIVE' });
    } else if (cwd === checkout) {
      processes.push({ pid: Number(pid), cwd, executable, kind: 'NEXT_APP' });
    }
  }
  // Saved PM2 state is context only, never proof of liveness (or of isolation).
  const pm2: ProcessInspection['pm2'] = [];
  try {
    const file = join(pm2Home, 'dump.pm2');
    if (statSync(file).size <= 4 * 1024 * 1024) {
      const saved: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(saved)) for (const item of saved) {
        if (item?.name !== 'imaps-insw-worker') continue;
        const pid = Number.isSafeInteger(item.pid) && item.pid > 0 ? item.pid : null;
        pm2.push({ name: 'imaps-insw-worker', recordedPid: pid,
          recordedStatus: ['online','stopped','errored','stopping'].includes(item.status) ? item.status : 'unknown',
          live: pid !== null && pids.includes(String(pid)) });
      }
    }
  } catch { /* Stale/missing metadata is never used as process evidence. */ }
  return { blockers: [...new Set(processes.flatMap(p => p.blocker ? [p.blocker] : []))], processes, pm2 };
}
export function processBlockers(root = '/proc') { return inspectProcesses(root).blockers; }

function appUrl(value: string | undefined) {
  const url = new URL(value ?? 'invalid:');
  requireSafe(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && Number(url.port) > 0
    && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password, 'EXPLICIT_LOOPBACK_APP_URL_REQUIRED');
  return url;
}
function listenerInodes(base: string, port: string) {
  const hex = Number(port).toString(16).toUpperCase().padStart(4, '0');
  const addresses = new Set(['00000000', '0100007F', '00000000000000000000000000000000', '00000000000000000000000001000000']);
  return ['tcp', 'tcp6'].flatMap(file => readFileSync(`${base}/net/${file}`, 'utf8').split('\n').slice(1))
    .map(line => line.trim().split(/\s+/)).filter(r => r[3] === '0A' && r[1]?.endsWith(`:${hex}`)
      && addresses.has(r[1].split(':')[0])).map(r => r[9]);
}
function socketInodes(base: string) {
  return new Set(readdirSync(`${base}/fd`).flatMap(fd => {
    try { return [readlinkSync(`${base}/fd/${fd}`).match(/^socket:\[(\d+)\]$/)?.[1] ?? '']; } catch { return []; }
  }));
}
function ownsListener(base: string, port: string) {
  const sockets = socketInodes(base);
  return listenerInodes(base, port).some(inode => sockets.has(inode));
}
function nextProcess(base: string, root: string) {
  const command = readFileSync(`${base}/cmdline`, 'utf8').replaceAll('\0', ' ');
  const initial = readEnv(base);
  const executable = readlinkSync(`${base}/exe`);
  requireSafe(/(?:^|\/)node(?:js)?$/.test(executable), 'APP_NODE_EXECUTABLE_NOT_VERIFIED');
  let launch = `${command} ${initial.pm_exec_path || ''}`;
  // Next/PM2 fork wrappers can hold the socket in a child; the socket owner
  // itself must still have Next identity, same checkout and validated config.
  if (!/next-server|(?:^|[ /])next(?:[ /]|$)/.test(launch)) {
    const parent = `${root}/${parentPid(base)}`;
    requireSafe(realpathSync(`${parent}/cwd`) === realpathSync(process.cwd()), 'APP_NEXT_PROCESS_NOT_VERIFIED');
    launch += ` ${readFileSync(`${parent}/cmdline`, 'utf8').replaceAll('\0', ' ')} ${readEnv(parent).pm_exec_path || ''}`;
  }
  requireSafe(/next-server|(?:^|[ /])next(?:[ /]|$)/.test(launch), 'APP_NEXT_PROCESS_NOT_VERIFIED');
  const lifecycle = initial.npm_lifecycle_script || '';
  const mode = initial.NODE_ENV || (/\bnext\b.*\bdev\b/.test(launch) || /^next dev(?: |$)/.test(lifecycle) ? 'development'
    : /\bnext\b.*\bstart\b/.test(launch) || /^next start(?: |$)/.test(lifecycle) ? 'production' : undefined);
  return { initial, mode };
}
// /proc holds exec-time env only. For Next-loaded keys, reconstruct its literal
// env-file precedence only when files predate the listener. Changed files,
// expansion and unknown build modes fail closed; never guess runtime values.
export function serverEnvironment(base: string, initial: NodeJS.ProcessEnv, mode: string | undefined, expected: NodeJS.ProcessEnv, root: string, checkout = process.cwd()) {
  if (keys.every(k => (initial[k] ?? '') === (expected[k] ?? ''))) return { values: initial, source: 'INITIAL_PROCESS_ENVIRONMENT' };
  requireSafe(keys.every(k => initial[k] === undefined || initial[k] === (expected[k] ?? '')), 'APP_SERVER_ENVIRONMENT_MISMATCH');
  requireSafe(['production','development','test'].includes(mode ?? ''), 'APP_ENV_MODE_NOT_VERIFIED');
  const stat = readFileSync(`${base}/stat`, 'utf8');
  const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
  // Linux USER_HZ for /proc stat is 100 (not CONFIG_HZ).
  const boot = Number(readFileSync(`${root}/stat`, 'utf8').match(/^btime (\d+)$/m)?.[1]);
  const started = (boot + ticks / 100) * 1000;
  requireSafe(Number.isFinite(started), 'APP_START_TIME_NOT_VERIFIED');
  const result = { ...initial };
  for (const name of [`.env.${mode}.local`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}`, '.env']) {
    const file = join(checkout, name);
    if (!existsSync(file)) continue;
    requireSafe(statSync(file).mtimeMs <= started, 'APP_ENV_FILE_CHANGED_RESTART_APP');
    const values = parse(readFileSync(file));
    for (const [key, value] of Object.entries(values)) if (result[key] === undefined) {
      requireSafe(!keys.includes(key) || !value.includes('$'), 'APP_ENV_EXPANSION_NOT_VERIFIED');
      result[key] = value;
    }
  }
  return { values: result, source: 'NEXT_ENV_FILES_PREDATING_PROCESS' };
}
export function verifyLocalApp(pidValue: string | undefined, urlValue: string | undefined, env: NodeJS.ProcessEnv, root = '/proc') {
  requireSafe(pidValue && /^[1-9]\d*$/.test(pidValue), 'APP_LISTENER_PID_REQUIRED');
  const url = appUrl(urlValue); const base = `${root}/${pidValue}`;
  requireSafe(realpathSync(`${base}/cwd`) === realpathSync(process.cwd()), 'APP_CHECKOUT_MISMATCH');
  requireSafe(ownsListener(base, url.port), 'APP_PID_DOES_NOT_OWN_LISTENER');
  const next = nextProcess(base, root);
  const effective = serverEnvironment(base, next.initial, next.mode, env, root);
  requireSafe(keys.every(k => (effective.values[k] ?? '') === (env[k] ?? '')), 'APP_SERVER_ENVIRONMENT_MISMATCH');
  // The operator ACK belongs to the runner, not the app. All actual target and
  // credential/proxy checks still apply to the independently reconstructed app.
  const blockers = [...databaseEnvironment(effective.values, options([])).blockers,
    ...dispatchBlockers(effective.values).filter(b => b !== 'OPERATOR_ISOLATION_AND_CREDENTIAL_ACK_REQUIRED')];
  requireSafe(!blockers.length, blockers[0]);
  return { pid: Number(pidValue), url: url.origin, verified: true, environmentSource: effective.source };
}
export type ListenerCandidate = { pid: number; cwd: string | null; port: number; verified: boolean; reason?: string };
export class ListenerError extends Error {
  constructor(message: string, readonly candidates: ListenerCandidate[]) { super(message); }
}
export function discoverLocalApp(pid: string | undefined, urlValue: string | undefined, env: NodeJS.ProcessEnv, root = '/proc') {
  const url = appUrl(urlValue);
  if (pid) {
    try { return verifyLocalApp(pid, urlValue, env, root); }
    catch (e) {
      let cwd: string | null = null;
      try { cwd = realpathSync(`${root}/${pid}/cwd`); } catch { /* Preserve PID-specific refusal. */ }
      const reason = code(e);
      throw new ListenerError(reason, [{ pid: Number(pid), cwd, port: Number(url.port), verified: false, reason }]);
    }
  }
  const matches: ReturnType<typeof verifyLocalApp>[] = []; const candidates: ListenerCandidate[] = [];
  const listeners = new Set(listenerInodes(root, url.port));
  const accounted = new Set<string>();
  for (const p of readdirSync(root).filter(p => /^[1-9]\d*$/.test(p))) {
    const base = `${root}/${p}`; let cwd: string | null = null;
    try {
      const sockets = socketInodes(base);
      const owned = [...listeners].filter(inode => sockets.has(inode));
      if (!owned.length) continue;
      owned.forEach(inode => accounted.add(inode));
      try { cwd = realpathSync(`${base}/cwd`); } catch { /* Diagnostic below. */ }
      const candidate: ListenerCandidate = { pid: Number(p), cwd, port: Number(url.port), verified: false };
      candidates.push(candidate);
      try { const app = verifyLocalApp(p, urlValue, env, root); candidate.verified = true; matches.push(app); }
      catch (e) { candidate.reason = code(e); }
    } catch { /* Unreadable FDs cannot account for a listener; every inode must be proven below. */ }
  }
  // Multiple socket owners remain ambiguous, even if only one passes env checks.
  if (matches.length !== 1 || candidates.length !== 1 || accounted.size !== listeners.size) throw new ListenerError(
    'APP_LISTENER_NOT_UNIQUELY_VERIFIED_SET_INSW_SANDBOX_APP_PID', candidates);
  return matches[0];
}
