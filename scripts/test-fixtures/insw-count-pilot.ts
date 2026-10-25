import { PrismaClient } from '@prisma/client';
import { isolatedIncomingPilot } from '../../lib/insw-worker/incoming-pilot';
// IPC-only disposable harness, no dotenv, no global swapping, no production caller.
const url = new URL(process.env.INSW_OUTCOME_TEST_DATABASE_URL ?? 'invalid:');
if (process.env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || url.hostname !== '127.0.0.1' || !/^\/[a-z0-9_]+_phase_c2b_test$/.test(url.pathname)
  || url.search || url.hash) throw new Error('UNSAFE_TEST_DATABASE');
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
process.once('message', async (message: Omit<Parameters<typeof isolatedIncomingPilot>[1], 'confirmedStockOpnameSourceIds'> & {
  confirmedStockOpnameSourceIds: string[]; maxJobs: number; stopBeforeSend: boolean;
}) => {
  try {
    const p = await isolatedIncomingPilot(db, { ...message,
      confirmedStockOpnameSourceIds: message.confirmedStockOpnameSourceIds.map(BigInt) });
    await p.run({ maxJobs: message.maxJobs, signal: new AbortController().signal,
      onEvent: event => { process.send?.({ event });
        if (event === 'admitted' && message.stopBeforeSend) process.kill(process.pid, 'SIGSTOP'); } });
  } catch (error) { process.send?.({ event: 'blocked', reason: (error as Error).message }); process.exitCode = 78; }
  finally { await db.$disconnect(); process.disconnect?.(); }
});
