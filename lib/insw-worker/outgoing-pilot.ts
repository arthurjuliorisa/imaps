import type { PrismaClient } from '@prisma/client';
import { isolatedIncomingPilot } from './incoming-pilot';

/** Explicit single-source captures, one shared dispatcher. No production caller. */
export async function isolatedOutgoingPilot(db: PrismaClient, config: {
  authorization: 'DISPOSABLE_OUTGOING_FIXTURES_ONLY'; sourceIds: readonly number[];
  incomingSourceIds?: readonly number[]; endpoint: string;
}) {
  if (config.authorization !== 'DISPOSABLE_OUTGOING_FIXTURES_ONLY') {
    throw new Error('EXPLICIT_ISOLATED_PILOT_AUTHORIZATION_REQUIRED');
  }
  const pilot = await isolatedIncomingPilot(db, {
    authorization: 'DISPOSABLE_INCOMING_FIXTURES_ONLY', sourceIds: config.incomingSourceIds ?? [],
    outgoingSourceIds: config.sourceIds, endpoint: config.endpoint,
  });
  return { capture: pilot.captureOutgoing, captureIncoming: pilot.capture, run: pilot.run };
}
