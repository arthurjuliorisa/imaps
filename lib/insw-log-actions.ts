import { Prisma, type PrismaClient } from '@prisma/client';
import { wmsLogResendEligibility, wmsLogTypes } from './insw-queue/wms-coordination';

/** Batched projections of existing WMS eligibility and legacy DIRECT
 * prerequisites. The action route repeats source/lock checks before admission.
 * Legacy Scrap SUCCESS or conflicting pending delivery must stay unavailable. */
export async function logResendEligibility(db: PrismaClient, companyCode: number, logs: {
  id: string | bigint; transaction_type: string;
}[]) {
  const history = logs.filter(log => !String(log.id).startsWith('queue:'));
  const wmsIds = history.filter(log => wmsLogTypes.some(t => t === log.transaction_type)).map(log => BigInt(log.id));
  const legacyIds = history.filter(log => ['scrap_in', 'scrap_out', 'capital_goods_out'].includes(log.transaction_type)).map(log => BigInt(log.id));
  const [wms, legacy] = await Promise.all([
    wmsLogResendEligibility(db, companyCode, wmsIds),
    legacyIds.length ? db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT l.id FROM insw_tracking_log l WHERE l.company_code = ${companyCode}
        AND l.id IN (${Prisma.join(legacyIds)}) AND l.insw_status IN ('FAILED', 'PENDING')
        AND ((l.transaction_type = 'capital_goods_out' AND l.wms_id IS NOT NULL AND l.wms_id <> '')
          OR (l.transaction_type IN ('scrap_in', 'scrap_out') AND l.transaction_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM insw_tracking_log prior WHERE prior.company_code = l.company_code
              AND prior.transaction_type = l.transaction_type AND prior.transaction_id = l.transaction_id AND prior.insw_status = 'SUCCESS')
            AND (l.insw_status = 'PENDING' OR (SELECT latest.insw_status FROM insw_tracking_log latest
              WHERE latest.company_code = l.company_code AND latest.transaction_type = l.transaction_type
                AND latest.transaction_id = l.transaction_id ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1) = 'FAILED')))
    `) : Promise.resolve([]),
  ]);
  return new Set([...wms, ...legacy.map(log => log.id.toString())]);
}
