import { lstatSync, realpathSync, mkdirSync, openSync, writeFileSync, renameSync, closeSync, fsyncSync, constants, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute, relative } from 'node:path';
import { processIdentity, verifyReaped } from '../../lib/insw-worker/process-identity';
import { requireSafe } from './core';
// Walk without following symlinks; create missing owned directories privately.
// Existing shared ancestors (e.g. /tmp) are allowed, but a foreign writable
// non-sticky ancestor could replace our directory and is refused.
export function prepareEvidenceRoot(root: string) {
  requireSafe(isAbsolute(root) && root === resolve(root), 'CANONICAL_EXTERNAL_EVIDENCE_ROOT_REQUIRED');
  const repo = realpathSync(process.cwd());
  requireSafe(root !== repo && relative(repo, root).startsWith('..'), 'EVIDENCE_INSIDE_REPOSITORY');
  let current = '/';
  for (const part of root.split('/').filter(Boolean)) {
    current = join(current, part);
    try { mkdirSync(current, { mode: 0o700 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const st = lstatSync(current);
    requireSafe(st.isDirectory() && !st.isSymbolicLink(), 'EVIDENCE_SYMLINK_OR_NON_DIRECTORY');
    requireSafe(!(st.mode & 0o022) || !!(st.mode & 0o1000), 'EVIDENCE_UNSAFE_ANCESTOR');
    if (existsSync(join(current, '.git'))) {
      const git = lstatSync(join(current, '.git'));
      requireSafe(git.isDirectory() && !existsSync(join(current, '.git', 'HEAD')), 'EVIDENCE_INSIDE_GIT');
    }
  }
}
export class Evidence {
  readonly dir: string;
  private lock: number;
  constructor(root: string, run: string, resume: boolean) {
    prepareEvidenceRoot(root);
    requireSafe(isAbsolute(root) && realpathSync(root) === resolve(root), 'EXISTING_CANONICAL_EXTERNAL_EVIDENCE_ROOT_REQUIRED');
    const repo = realpathSync(process.cwd());
    requireSafe(root !== repo && relative(repo, root).startsWith('..'), 'EVIDENCE_INSIDE_REPOSITORY');
    // Also reject an enclosing Git tree (operator evidence must remain outside Git).
    for (let p = root; p !== '/'; p = resolve(p, '..')) {
      try { const git = lstatSync(join(p, '.git'));
        if (!git.isDirectory() || existsSync(join(p, '.git', 'HEAD'))) throw new Error('EVIDENCE_INSIDE_GIT'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    const st = lstatSync(root);
    requireSafe(st.isDirectory() && st.uid === process.getuid!() && (st.mode & 0o777) === 0o700, 'EVIDENCE_ROOT_MUST_BE_OWNED_MODE_0700');
    this.dir = join(root, run);
    if (!resume) mkdirSync(this.dir, { mode: 0o700 });
    const ds = lstatSync(this.dir);
    requireSafe(ds.isDirectory() && !ds.isSymbolicLink() && ds.uid === process.getuid!() && (ds.mode & 0o077) === 0, 'UNSAFE_RUN_DIRECTORY');
    const lockPath = join(this.dir, '.runner-lock');
    if (resume && existsSync(lockPath)) {
      const old = this.read<{ identity: ReturnType<typeof processIdentity> }>('.runner-lock');
      verifyReaped(old.identity); // Live/reused/unverifiable PID refuses resume.
      rmSync(lockPath);
    }
    this.lock = openSync(join(this.dir, '.runner-lock'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    writeFileSync(this.lock, JSON.stringify({ identity: processIdentity() })); fsyncSync(this.lock);
  }
  write(name: string, data: unknown) {
    const temp = join(this.dir, `${name}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
    const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, typeof data === 'string' ? data : JSON.stringify(data, (_k,v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temp, join(this.dir, name));
    const directory = openSync(this.dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
  read<T>(name: string): T {
    const fd = openSync(join(this.dir, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return JSON.parse(readFileSync(fd, 'utf8')) as T; } finally { closeSync(fd); }
  }
  close() { closeSync(this.lock); rmSync(join(this.dir, '.runner-lock')); }
}
