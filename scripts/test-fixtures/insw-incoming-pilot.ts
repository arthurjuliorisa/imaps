import { PrismaClient } from '@prisma/client';
import { isolatedIncomingPilot } from '../../lib/insw-worker/incoming-pilot';

// IPC fixture, not a production runner. No .env, config, discovery or credentials.
const url = new URL(process.env.INSW_OUTCOME_TEST_DATABASE_URL ?? 'invalid:');
if (process.env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || url.hostname !== '127.0.0.1' || !/^\/[a-z0-9_]+_phase_c2b_test$/.test(url.pathname)
  || url.search || url.hash) throw new Error('UNSAFE_TEST_DATABASE');
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
process.once('message', async (message: { sourceIds: number[]; endpoint: string; company?: number; captureId?: number; maxJobs?: number }) => {
  try {
    const pilot = await isolatedIncomingPilot(db, { authorization: 'DISPOSABLE_INCOMING_FIXTURES_ONLY',
      sourceIds: message.sourceIds, endpoint: message.endpoint });
    if (message.captureId !== undefined) {
      await pilot.capture(message.company!, message.captureId);
      process.send?.({ event: 'captured' });
    } else await pilot.run({ maxJobs: message.maxJobs ?? 1, signal: new AbortController().signal,
      onEvent: event => process.send?.({ event }) });
  } catch (error) { process.send?.({ event: 'blocked', reason: (error as Error).message }); process.exitCode = 78; }
  finally { await db.$disconnect(); process.disconnect?.(); }
});
