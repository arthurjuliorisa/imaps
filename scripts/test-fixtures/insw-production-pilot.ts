import { PrismaClient } from '@prisma/client';
import { isolatedProductionPilot } from '../../lib/insw-worker/production-pilot';

// IPC fixture only. Never loads .env, deployed configuration or real credentials.
const url = new URL(process.env.INSW_OUTCOME_TEST_DATABASE_URL ?? 'invalid:');
if (process.env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || url.hostname !== '127.0.0.1' || !/^\/[a-z0-9_]+_phase_c2b_test$/.test(url.pathname)
  || url.search || url.hash) throw new Error('UNSAFE_TEST_DATABASE');
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
process.once('message', async (message: { materialUsageSourceIds: number[]; productionOutputSourceIds: number[];
  incomingSourceIds?: number[]; outgoingSourceIds?: number[]; endpoint: string; company?: number; captureId?: number;
  operation?: 'MATERIAL_USAGE' | 'PRODUCTION_OUTPUT'; maxJobs?: number; stopBeforeSend?: boolean }) => {
  try {
    const pilot = await isolatedProductionPilot(db, { ...message, authorization: 'DISPOSABLE_MU_PO_FIXTURES_ONLY' });
    if (message.captureId !== undefined) {
      const capture = message.operation === 'MATERIAL_USAGE' ? pilot.captureMaterialUsage : pilot.captureProductionOutput;
      await capture(message.company!, message.captureId);
      process.send?.({ event: 'captured' });
    } else await pilot.run({ maxJobs: message.maxJobs ?? 1, signal: new AbortController().signal,
      onEvent: event => { process.send?.({ event });
        if (event === 'admitted' && message.stopBeforeSend) process.kill(process.pid, 'SIGSTOP');
      } });
  } catch (error) { process.send?.({ event: 'blocked', reason: (error as Error).message }); process.exitCode = 78; }
  finally { await db.$disconnect(); process.disconnect?.(); }
});
