import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstatSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { recoveryInstallation } from './recovery-installation';

export type WorkerSupervisorStatus = {
  status: 'online' | 'stopped' | 'starting' | 'errored' | 'unknown';
  reason: 'observed' | 'unavailable' | 'missing-target' | 'query-failed' | 'unrecognized';
};
const execute = promisify(execFile);

// Use only PM2's RPC transport, never its API/CLI startup path. Even if the
// daemon disappears after validation, connecting to its socket cannot spawn it.
const query = `
let phase = 'RPC_MODULE_LOAD';
const fail = () => process.stderr.write('INSW_STATUS_' + phase + '\\n', () => process.exit(1));
try {
  const { createRequire } = require('node:module');
  const fromPM2 = createRequire(process.argv[1]);
  const load = name => { try { return fromPM2('./../modules/' + name); } catch { return fromPM2(name); } };
  const socket = load('pm2-axon').socket('req');
  const client = new (load('pm2-axon-rpc').Client)(socket);
  setTimeout(() => { phase = 'RPC_TIMEOUT'; fail(); }, 4000);
  socket.once('error', () => { phase = 'RPC_SOCKET_ERROR'; fail(); });
  socket.once('connect', () => {
    phase = 'RPC_METHOD';
    try {
      client.call('getMonitorData', {}, (error, list) => {
        if (error) return fail();
        phase = 'RPC_SERIALIZE';
        try { process.stdout.write(JSON.stringify(list), () => process.exit(0)); } catch { fail(); }
      });
    } catch { fail(); }
  });
  phase = 'RPC_CONNECT';
  socket.connect(process.argv[2]);
} catch { fail(); }
`;

export async function workerSupervisorStatus(): Promise<WorkerSupervisorStatus> {
  let config: ReturnType<typeof recoveryInstallation>;
  let stage = 'INSTALLATION';
  try {
    config = recoveryInstallation({ readOnly: true });
    stage = 'DAEMON_PID_READ';
    const pid = Number(readFileSync(join(config.pm2Home, 'pm2.pid'), 'utf8').trim());
    stage = 'DAEMON_SOCKET_READ';
    const socket = lstatSync(join(config.pm2Home, 'rpc.sock'));
    stage = 'DAEMON_PID_INVALID';
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('UNAVAILABLE');
    stage = 'DAEMON_OWNER';
    if (statSync(`/proc/${pid}`).uid !== config.uid) throw new Error('UNAVAILABLE');
    stage = 'DAEMON_NAMESPACE';
    if (readlinkSync(`/proc/${pid}/ns/pid`) !== readlinkSync('/proc/self/ns/pid')) throw new Error('UNAVAILABLE');
    stage = 'DAEMON_COMMAND';
    if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('God Daemon')) throw new Error('UNAVAILABLE');
    stage = 'DAEMON_SOCKET_IDENTITY';
    if (!socket.isSocket() || socket.uid !== config.uid) throw new Error('UNAVAILABLE');
  } catch {
    console.error('[INSW worker status]', stage);
    return { status: 'unknown', reason: 'unavailable' };
  }
  try {
    stage = 'RPC_QUERY';
    const { stdout } = await execute(config.node, ['-e', query, config.pm2, join(config.pm2Home, 'rpc.sock')], {
      cwd: config.root, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', HOME: config.home, PM2_HOME: config.pm2Home },
      timeout: 5000, maxBuffer: 1024 * 1024,
    });
    stage = 'RPC_RESPONSE_PARSE';
    const list = JSON.parse(stdout);
    stage = 'RPC_RESPONSE_SHAPE';
    if (!Array.isArray(list)) throw new Error('INVALID_RESPONSE');
    const matches = list.filter(app => app?.name === 'imaps-insw-worker');
    if (!matches.length) {
      console.error('[INSW worker status]', 'TARGET_MISSING');
      return { status: 'unknown', reason: 'missing-target' };
    }
    stage = 'TARGET_AMBIGUOUS';
    if (matches.length !== 1) throw new Error('AMBIGUOUS_TARGET');
    stage = 'TARGET_IDENTITY';
    const env = matches[0].pm2_env;
    if (!env || env.pm_cwd !== config.root || env.pm_exec_path !== join(config.root, 'scripts/insw-worker.ts')) throw new Error('TARGET_MISMATCH');
    switch (env.status) {
      case 'online': case 'stopped': case 'errored': return { status: env.status, reason: 'observed' };
      case 'launching': return { status: 'starting', reason: 'observed' };
      default:
        console.error('[INSW worker status]', 'STATE_UNRECOGNIZED');
        return { status: 'unknown', reason: 'unrecognized' };
    }
  } catch (error) {
    // The child emits only fixed failure markers. Never forward its raw stderr.
    const stderr = (error as { stderr?: unknown })?.stderr;
    const rpc = ['RPC_MODULE_LOAD', 'RPC_TIMEOUT', 'RPC_SOCKET_ERROR', 'RPC_METHOD', 'RPC_SERIALIZE', 'RPC_CONNECT']
      .find(code => stderr === `INSW_STATUS_${code}\n`);
    console.error('[INSW worker status]', stage === 'RPC_QUERY' && rpc ? rpc : stage);
    return { status: 'unknown', reason: 'query-failed' };
  }
}
