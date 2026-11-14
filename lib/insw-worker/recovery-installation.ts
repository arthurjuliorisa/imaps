import { constants, closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';

export type RecoveryInstallation = { uid: number; root: string; home: string; pm2Home: string; pm2: string;
  node: string; runtime: string };
// Never log raw OS errors, paths, environment, or exception stacks.
function diagnosticCode(error: unknown): string {
  const { message, code } = (error ?? {}) as { message?: unknown; code?: unknown };
  const validation = ['CALLER_UID_DENIED', 'DEPLOYMENT_PATH_INVALID', 'DEPLOYMENT_PATH_UNTRUSTED',
    'PM2_ACCOUNT_MISMATCH', 'PM2_CLI_UNAVAILABLE', 'RUNTIME_UNTRUSTED', 'LOCK_UNTRUSTED'];
  const filesystem = ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'ELOOP', 'EROFS', 'ENOSPC', 'EMFILE', 'ENFILE'];
  return validation.includes(message as string) ? message as string
    : filesystem.includes(code as string) ? code as string : 'VALIDATION_FAILED';
}
// Server deployment configuration only. Never accepts HTTP parameters. No root
// installation, extra PM2 daemon or authority beyond the application's account.
export function recoveryInstallation({ readOnly = false } = {}): RecoveryInstallation {
  let stage = 'CALLER';
  try {
    const uid = process.getuid?.();
    if (process.platform !== 'linux' || uid === undefined || uid === 0) throw new Error('CALLER_UID_DENIED');
    const checked = (path: string, pm2Directory = false) => {
      if (!isAbsolute(path) || realpathSync(path) !== path) throw new Error('DEPLOYMENT_PATH_INVALID');
      const stat = statSync(path);
      // Allow an account-owned PM2 home with 775. Only that directory
      // may be writable by the caller's effective group; code stays non-writable
      // by any group, and world/foreign-group writes remain untrusted.
      const trustedGroup = pm2Directory && stat.isDirectory() && stat.uid === uid
        && stat.gid === process.getgid?.();
      if (![0, uid].includes(stat.uid) || (stat.mode & (trustedGroup ? 0o002 : 0o022))) throw new Error('DEPLOYMENT_PATH_UNTRUSTED');
      return path;
    };
    stage = 'APPLICATION_ROOT';
    const root = checked(realpathSync(process.cwd()));
    stage = 'RECOVERY_SCRIPT';
    checked(join(root, 'scripts/host/insw-worker-recovery.ts'));
    stage = 'WORKER_SCRIPT';
    checked(join(root, 'scripts/insw-worker.ts'));
    stage = 'ECOSYSTEM';
    checked(join(root, 'ecosystem.insw-worker.config.js'));
    stage = 'HOME';
    const home = checked(realpathSync(homedir()));
    stage = 'PM2_HOME';
    const pm2Home = checked(process.env.PM2_HOME || join(home, '.pm2'), true);
    stage = 'PM2_HOME_ACCOUNT';
    if (statSync(pm2Home).uid !== uid) throw new Error('PM2_ACCOUNT_MISMATCH');
    // Explicit absolute CLI path is useful when the deployment PATH omits PM2.
    stage = 'PM2_DISCOVERY';
    const candidates = process.env.INSW_RECOVERY_PM2_CLI ? [process.env.INSW_RECOVERY_PM2_CLI]
      : (process.env.PATH || '').split(delimiter).filter(isAbsolute).map(dir => join(dir, 'pm2'));
    let pm2 = '';
    for (const path of candidates) {
      try {
        stage = 'PM2_CLI';
        const cli = checked(realpathSync(path));
        stage = 'PM2_MANIFEST';
        const manifest = checked(realpathSync(join(dirname(cli), '..', 'package.json')));
        stage = 'PM2_MANIFEST_READ';
        if (basename(cli) !== 'pm2' || JSON.parse(readFileSync(manifest, 'utf8')).name !== 'pm2') {
          console.error('[INSW deployment]', 'PM2_IDENTITY', 'MISMATCH');
          continue;
        }
        pm2 = cli; break;
      } catch (error) {
        // Missing PATH candidates are routine; final discovery failure is logged below.
        const code = diagnosticCode(error);
        if (code !== 'ENOENT') console.error('[INSW deployment]', stage, code);
      }
    }
    stage = 'PM2_DISCOVERY';
    if (!pm2) throw new Error('PM2_CLI_UNAVAILABLE');
    stage = 'NODE_INTERPRETER';
    const node = checked(realpathSync(process.execPath));
    const runtime = join(pm2Home, 'imaps-worker-recovery');
    if (readOnly) return { uid, root, home, pm2Home, pm2, node, runtime };
    stage = 'RUNTIME_CREATE';
    mkdirSync(runtime, { mode: 0o700, recursive: true });
    stage = 'RUNTIME_VALIDATE';
    const directory = lstatSync(runtime);
    if (!directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o077)) throw new Error('RUNTIME_UNTRUSTED');
    // Never unlink/recreate the lock inode: all web processes and operators share it.
    const lock = join(runtime, 'recovery.lock');
    stage = 'LOCK_OPEN';
    const fd = openSync(lock, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    stage = 'LOCK_CLOSE';
    closeSync(fd);
    stage = 'LOCK_VALIDATE';
    const file = lstatSync(lock);
    if (!file.isFile() || file.nlink !== 1 || file.uid !== uid || (file.mode & 0o077)) throw new Error('LOCK_UNTRUSTED');
    return { uid, root, home, pm2Home, pm2, node, runtime };
  } catch (error) {
    console.error('[INSW deployment]', stage, diagnosticCode(error));
    throw error;
  }
}
