import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Legacy Scrap finalization claims were separate from their transmission row.
 * New claims carry `attempt_lifecycle: true` and are the user-facing attempt,
 * including while genuinely PENDING. Only the narrow legacy duplicate shape
 * is hidden; finalized rows are never hidden merely because claim metadata
 * remains on historical data.
 */
export async function excludeTechnicalScrapClaims(
  companyCode: number
): Promise<Prisma.insw_tracking_logWhereInput> {
  const rows = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT claim.id
    FROM insw_tracking_log claim
    WHERE claim.company_code = ${companyCode}
      AND claim.transaction_type IN ('scrap_in', 'scrap_out')
      AND claim.insw_status = 'PENDING'
      AND claim.insw_request_payload IS NULL
      AND claim.metadata ->> 'claim' = 'true'
      AND COALESCE(claim.metadata ->> 'attempt_lifecycle', 'false') <> 'true'
      AND EXISTS (
        SELECT 1
        FROM insw_tracking_log actual
        WHERE actual.id <> claim.id
          AND actual.company_code = claim.company_code
          AND actual.transaction_type = claim.transaction_type
          AND actual.transaction_id IS NOT DISTINCT FROM claim.transaction_id
          AND actual.wms_id IS NOT DISTINCT FROM claim.wms_id
          AND actual.insw_activity_code IS NOT DISTINCT FROM claim.insw_activity_code
          AND actual.created_at >= claim.created_at
          AND (
            actual.insw_status IN ('SUCCESS', 'FAILED')
            OR actual.insw_request_payload IS NOT NULL
          )
      )
  `;

  return rows.length > 0 ? { id: { notIn: rows.map(row => row.id) } } : {};
}
