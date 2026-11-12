// Private child entry point. No production CLI imports this file. No injected
// provider responses, direct sender, bypass adapter or NODE_ENV override.
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { runProductionDispatcher } from '../../lib/insw-worker/production-dispatcher';
import { processIdentity } from '../../lib/insw-worker/process-identity';
import { environment, options, requireSafe, type Start } from './core';
const stop = new AbortController();
process.once('SIGINT', () => stop.abort()); process.once('SIGTERM', () => stop.abort());
let started = false;
const emit = (message: Record<string, unknown>) => { if (process.connected) process.send?.(message); };
process.on('disconnect', () => stop.abort());
process.on('message', async (msg: { type: string; ids: string[]; posts: number; retries: number }) => {
  if (msg.type === 'stop') { stop.abort(); return; }
  if (started) return;
  started = true;
  let db: PrismaClient | undefined;
  try {
    requireSafe(process.send && process.connected && process.env.INSW_SANDBOX_CHILD === String(process.ppid), 'RUNNER_PARENT_IPC_REQUIRED');
    const target = environment(process.env, options([]));
    requireSafe(msg.type === 'start' && Array.isArray(msg.ids) && msg.ids.length > 0 && msg.ids.every(s => typeof s === 'string')
      && Number.isSafeInteger(msg.posts) && msg.posts > 0, 'CHILD_CONFIG_INVALID');
    const ids = new Set(msg.ids);
    db = new PrismaClient();
    const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    emit({ type: 'identity', identity: processIdentity() });
    await new Promise<void>(resolve => {
      const ready = (m: { type: string }) => { if (m.type === 'identity-saved') { process.off('message', ready); resolve(); } };
      process.on('message', ready);
      const cancelled = () => { process.off('message', ready); resolve(); };
      stop.signal.addEventListener('abort', cancelled, { once: true });
      if (stop.signal.aborted) cancelled();
    });
    requireSafe(!stop.signal.aborted, 'CHILD_START_CANCELLED');
    let active = 0; let posts = 0; let pending: Start | undefined;
    await runProductionDispatcher({ db, signal: stop.signal, allowedCompanies: [1370],
      beforePost: (endpoint, job) => {
        try {
          requireSafe(endpoint === target.destination && job.company_code === 1370 && ids.has(job.wms_reference ?? '')
            && job.retry_index <= msg.retries && job.max_auto_retry_snapshot <= msg.retries
            && posts < msg.posts && !stop.signal.aborted, 'UNSAFE_OR_BUDGETED_POST_REFUSED');
        } catch (e) { stop.abort(); emit({ type: 'unsafe-exit' }); throw e; }
        posts++; active++;
        // Timestamp at actual fetch entry, after proxy setup, before network.
        pending = { queue_id: job.id, attempt_id: job.attemptId, wms_id: job.wms_reference!,
          boot_id: boot, active, wall_time: new Date().toISOString(), monotonic_ns: String(process.hrtime.bigint()) };
      },
      onEvent: (event, data) => {
        if (event === 'owned') emit({ type: 'owned', data });
        if (event === 'recorded') {
          if (pending) { emit({ type: 'post', start: pending }); pending = undefined; active--; }
          emit({ type: 'recorded', data });
          if (posts >= msg.posts) stop.abort();
        }
      },
    });
    requireSafe(!pending, 'INCOMPLETE_SENDER_OBSERVATION');
    emit({ type: 'drained', posts });
  } catch { emit({ type: 'unsafe-exit' }); process.exitCode = 1; }
  finally { await db?.$disconnect(); if (process.connected) process.disconnect?.(); }
});
