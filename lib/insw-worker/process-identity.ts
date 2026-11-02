import { readFileSync, existsSync, readlinkSync } from 'node:fs';
import { hostname } from 'node:os';

export type ProcessIdentity = { host: string; machine: string; boot: string; pid: number; start: string; pidNamespace: string; uid: number };
export function processIdentity(): ProcessIdentity {
  if (process.platform !== 'linux') throw new Error('LINUX_SINGLE_HOST_REQUIRED');
  const stat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  return { host: hostname(), machine: readFileSync('/etc/machine-id', 'utf8').trim(),
    boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), pid: process.pid,
    pidNamespace: readlinkSync('/proc/self/ns/pid'), uid: process.getuid!(),
    start: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] };
}
// No lease, heartbeat, socket abort or DB session can substitute for this test.
// PID reuse deliberately denies recovery too. Reap the supervisor child first.
export function verifyReaped(old: ProcessIdentity): void {
  const local = processIdentity();
  if (!old || old.host !== local.host || old.machine !== local.machine || !old.boot || !old.start
    || !Number.isSafeInteger(old.pid) || old.pid <= 0) throw new Error('UNVERIFIABLE_OWNER_HOST');
  if (old.uid !== local.uid || (old.boot === local.boot && old.pidNamespace !== local.pidNamespace)) throw new Error('UNVERIFIABLE_PROCESS_NAMESPACE');
  if (old.boot === local.boot && existsSync(`/proc/${old.pid}`)) throw new Error('OWNER_PROCESS_NOT_REAPED');
}
