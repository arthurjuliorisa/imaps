import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { readPolicy } from '../insw-queue/policy.repository';

// Persistent denial boundary only, NOT dispatch admission. Acquisition must occur
// once per process startup, before claims. Never resume with a stored/reused token.
// No expiry, release, heartbeat takeover, or operational reset API is provided.
// Maintenance requires prior process/host fencing and review of uncertain remote
// attempts with attributable evidence; a DB token cannot establish either fact.
export async function acquireStickyOwnership(db: PrismaClient): Promise<string> {
  const token = randomUUID();
  return db.$transaction(async tx => {
    await readPolicy(tx);
    const rows = await tx.$queryRaw<{ owner_token: string }[]>`
      UPDATE insw_dispatch_gate SET owner_token = ${token}::uuid,
        lease_until = clock_timestamp()
      WHERE id = 1 AND owner_token IS NULL AND lease_until IS NULL
        AND last_started_at IS NULL
      RETURNING owner_token`;
    // Existing schema requires owner/lease to be paired. The stored timestamp is
    // informational only here: even an already expired value NEVER permits takeover.
    // Dirty/missing state is never repaired, including an orphaned prior start.
    if (rows.length !== 1) throw new Error('INSW_STREAM_BLOCKED_MAINTENANCE_REQUIRED');
    return rows[0].owner_token;
  });
}
