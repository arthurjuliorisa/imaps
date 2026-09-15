import { Prisma } from '@prisma/client';

export type ScrapInswStatus = 'NOT_SENT' | 'PENDING' | 'FAILED' | 'SUCCESS';
export type ScrapInswDirection = 'IN' | 'OUT';

type DbClient = Prisma.TransactionClient;

export class ScrapInswLockedError extends Error {
  constructor(public readonly status: 'PENDING' | 'SUCCESS') {
    super(
      status === 'SUCCESS'
        ? 'This Scrap transaction was successfully sent to INSW and can no longer be changed.'
        : 'This Scrap transaction has a pending INSW transmission and cannot be changed until it is resolved.'
    );
  }
}

export function trackingType(direction: ScrapInswDirection): 'scrap_in' | 'scrap_out' {
  return direction === 'IN' ? 'scrap_in' : 'scrap_out';
}

/** Serializes send/edit/delete decisions for one Scrap header. */
export async function acquireScrapInswLock(
  tx: DbClient,
  companyCode: number,
  transactionId: number
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'scrap-insw:' + companyCode + ':' + transactionId}, 0))`;
}

export async function getEffectiveScrapInswStatus(
  client: DbClient,
  companyCode: number,
  transactionId: number,
  direction: ScrapInswDirection
): Promise<ScrapInswStatus> {
  const [row] = await client.$queryRaw<Array<{ has_success: boolean; latest_status: string | null }>>`
    SELECT
      COALESCE(bool_or(insw_status = 'SUCCESS'), false) AS has_success,
      (array_agg(insw_status ORDER BY created_at DESC, id DESC))[1] AS latest_status
    FROM insw_tracking_log
    WHERE company_code = ${companyCode}
      AND transaction_type = ${trackingType(direction)}
      AND transaction_id = ${transactionId}
  `;

  if (row?.has_success) return 'SUCCESS';
  if (!row?.latest_status) return 'NOT_SENT';
  if (row.latest_status === 'FAILED') return 'FAILED';
  return 'PENDING';
}

export async function assertScrapMutable(
  tx: DbClient,
  companyCode: number,
  transactionId: number,
  direction: ScrapInswDirection
): Promise<void> {
  const status = await getEffectiveScrapInswStatus(tx, companyCode, transactionId, direction);
  if (status === 'PENDING' || status === 'SUCCESS') throw new ScrapInswLockedError(status);
}
