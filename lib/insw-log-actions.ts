import { type PrismaClient } from '@prisma/client';
import { wmsLogResendEligibility, wmsLogTypes } from './insw-queue/wms-coordination';

/** One batched queue eligibility decision for list and detail. Legacy DIRECT
 * history has no frozen queue/budget safety evidence for ordinary resend. */
export async function logResendEligibility(db: PrismaClient, companyCode: number, logs: {
  id: string | bigint; transaction_type: string;
}[]) {
  const history = logs.filter(log => !String(log.id).startsWith('queue:'));
  const wmsIds = history.filter(log => wmsLogTypes.some(t => t === log.transaction_type)).map(log => BigInt(log.id));
  return wmsLogResendEligibility(db, companyCode, wmsIds);
}
