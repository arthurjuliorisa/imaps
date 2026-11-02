import { Prisma, PrismaClient } from '@prisma/client';
import { boundedText, integer } from './contracts';
export type QueueDb = PrismaClient | Prisma.TransactionClient;
export type PolicyValues = { min_processing_interval_ms: number; max_auto_retry: number };

export function validatePolicy(value: PolicyValues) {
  integer(value.min_processing_interval_ms, 'processing interval', 1);
  integer(value.max_auto_retry, 'maximum retries', 0, 2147483646);
  return value;
}
// Migration installs defaults. Reads never repair missing/corrupt operational state.
export async function readPolicy(db: QueueDb) {
  const row = await db.insw_transmission_policy.findUnique({ where: { id: 1 } });
  if (!row) throw new Error('INSW transmission policy missing; dispatch forbidden');
  validatePolicy(row);
  integer(row.version, 'policy version', 1);
  return row;
}

// Backend only. Caller must supply an operational actor/reason and a reviewed version.
// Both writes must commit together; never expose this as a generic settings endpoint.
export async function updatePolicy(db: PrismaClient, expectedVersion: number, values: PolicyValues, actor: string, reason: string) {
  validatePolicy(values);
  integer(expectedVersion, 'expected version', 1, 2147483646);
  boundedText(actor, 'policy actor', 100);
  boundedText(reason, 'policy reason', 500);
  return db.$transaction(async tx => {
    const result = await tx.insw_transmission_policy.updateMany({
      where: { id: 1, version: expectedVersion },
      data: { min_processing_interval_ms: values.min_processing_interval_ms, max_auto_retry: values.max_auto_retry,
        version: expectedVersion + 1, updated_at: new Date(), updated_by: actor, change_reason: reason },
    });
    if (result.count !== 1) throw new Error('Missing policy or stale policy version');
    await tx.insw_policy_change.create({ data: { version: expectedVersion + 1,
      min_processing_interval_ms: values.min_processing_interval_ms, max_auto_retry: values.max_auto_retry, changed_by: actor, reason } });
    return readPolicy(tx);
  });
}
