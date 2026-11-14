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
const { createRequire } = require('node:module');
const fromPM2 = createRequire(process.argv[1]);
const load = name => { try { return fromPM2('./../modules/' + name); } catch { return fromPM2(name); } };
const socket = load('pm2-axon').socket('req');
const client = new (load('pm2-axon-rpc').Client)(socket);
const fail = () => process.exit(1);
setTimeout(fail, 4000);
socket.once('error', fail);
socket.once('connect', () => client.call('getMonitorData', {}, (error, list) => {
  if (error) return fail();
  process.stdout.write(JSON.stringify(list), () => process.exit(0));
}));
socket.connect(process.argv[2]);
`;

export async function workerSupervisorStatus(): Promise<WorkerSupervisorStatus> {
  let config: ReturnType<typeof recoveryInstallation>;
  try {
    config = recoveryInstallation({ readOnly: true });
    const pid = Number(readFileSync(join(config.pm2Home, 'pm2.pid'), 'utf8').trim());
    const socket = lstatSync(join(config.pm2Home, 'rpc.sock'));
    if (!Number.isSafeInteger(pid) || pid <= 0 || statSync(`/proc/${pid}`).uid !== config.uid
      || readlinkSync(`/proc/${pid}/ns/pid`) !== readlinkSync('/proc/self/ns/pid')
      || !readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('God Daemon')
      || !socket.isSocket() || socket.uid !== config.uid) throw new Error('UNAVAILABLE');
  } catch { return { status: 'unknown', reason: 'unavailable' }; }
  try {
    const { stdout } = await execute(config.node, ['-e', query, config.pm2, join(config.pm2Home, 'rpc.sock')], {
      cwd: config.root, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', HOME: config.home, PM2_HOME: config.pm2Home },
      timeout: 5000, maxBuffer: 1024 * 1024,
    });
    const list = JSON.parse(stdout);
    if (!Array.isArray(list)) throw new Error('INVALID_RESPONSE');
    const matches = list.filter(app => app?.name === 'imaps-insw-worker');
    if (!matches.length) return { status: 'unknown', reason: 'missing-target' };
    if (matches.length !== 1) throw new Error('AMBIGUOUS_TARGET');
    const env = matches[0].pm2_env;
    if (!env || env.pm_cwd !== config.root || env.pm_exec_path !== join(config.root, 'scripts/insw-worker.ts')) throw new Error('TARGET_MISMATCH');
    switch (env.status) {
      case 'online': case 'stopped': case 'errored': return { status: env.status, reason: 'observed' };
      case 'launching': return { status: 'starting', reason: 'observed' };
      default: return { status: 'unknown', reason: 'unrecognized' };
    }
  } catch { return { status: 'unknown', reason: 'query-failed' }; }
}
