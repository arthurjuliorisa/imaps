import type { PrismaClient } from '@prisma/client';
import { isolatedIncomingPilot } from './incoming-pilot';

/** Explicit committed MU/PO fixtures; delegates the single shared dispatcher. */
export async function isolatedProductionPilot(db: PrismaClient, config: {
  authorization: 'DISPOSABLE_MU_PO_FIXTURES_ONLY';
  materialUsageSourceIds: readonly number[]; productionOutputSourceIds: readonly number[];
  incomingSourceIds?: readonly number[]; outgoingSourceIds?: readonly number[]; endpoint: string;
}) {
  if (config.authorization !== 'DISPOSABLE_MU_PO_FIXTURES_ONLY') {
    throw new Error('EXPLICIT_ISOLATED_PILOT_AUTHORIZATION_REQUIRED');
  }
  const pilot = await isolatedIncomingPilot(db, { ...config,
    authorization: 'DISPOSABLE_INCOMING_FIXTURES_ONLY', sourceIds: config.incomingSourceIds ?? [] });
  return { captureMaterialUsage: pilot.captureMaterialUsage, captureProductionOutput: pilot.captureProductionOutput,
    captureIncoming: pilot.capture, captureOutgoing: pilot.captureOutgoing, run: pilot.run };
}
