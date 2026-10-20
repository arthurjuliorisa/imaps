import { Prisma } from '@prisma/client';

export interface BeginningBalanceSnapshotItem {
  item_type: string;
  item_code: string;
  item_name: string;
  uom: string;
  snapshot_date: Date;
}

interface BatchSnapshotResult {
  item_code: string;
  status: 'SUCCESS' | 'ERROR';
  message: string;
}

const SNAPSHOT_BATCH_SIZE = 1000;

type SnapshotClient = Prisma.TransactionClient;

export class BeginningBalanceSnapshotError extends Error {
  constructor(
    public readonly failedIdentities: Array<Pick<BeginningBalanceSnapshotItem, 'item_type' | 'item_code' | 'uom' | 'snapshot_date'>>,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'BeginningBalanceSnapshotError';
  }
}

function identity(item: BeginningBalanceSnapshotItem): string {
  return `${item.item_type}|${item.item_code}|${item.uom}|${item.snapshot_date.toISOString()}`;
}

/**
 * Creates and verifies required beginning-balance snapshots in the caller's
 * transaction.  The database batch function reports per-item failures instead
 * of raising them, so its result and the persisted baseline rows are both
 * checked before the transaction is allowed to commit.
 */
export async function createRequiredBeginningBalanceSnapshots(
  tx: SnapshotClient,
  companyCode: number,
  items: BeginningBalanceSnapshotItem[]
): Promise<void> {
  const uniqueItems = Array.from(
    new Map(items.map((item) => [identity(item), item])).values()
  );

  const itemsByDate = new Map<number, BeginningBalanceSnapshotItem[]>();
  for (const item of uniqueItems) {
    const dateKey = item.snapshot_date.getTime();
    const group = itemsByDate.get(dateKey) ?? [];
    group.push(item);
    itemsByDate.set(dateKey, group);
  }

  for (const dateItems of itemsByDate.values()) {
    for (let index = 0; index < dateItems.length; index += SNAPSHOT_BATCH_SIZE) {
      const batch = dateItems.slice(index, index + SNAPSHOT_BATCH_SIZE);
      const snapshotDate = batch[0].snapshot_date;
      let results: BatchSnapshotResult[];
      try {
        results = await tx.$queryRawUnsafe<BatchSnapshotResult[]>(
          'SELECT * FROM upsert_items_stock_snapshot($1::int, $2::jsonb, $3::date)',
          companyCode,
          JSON.stringify(batch.map(({ snapshot_date, ...item }) => item)),
          snapshotDate
        );
      } catch (error) {
        throw new BeginningBalanceSnapshotError(
          batch,
          'Required beginning balance snapshot processing failed',
          error
        );
      }

      const failedIdentities = results.length === batch.length
        ? batch.filter((item, resultIndex) => {
            const result = results[resultIndex];
            return result.status !== 'SUCCESS' || result.item_code !== item.item_code;
          })
        : batch;
      if (failedIdentities.length > 0) {
        throw new BeginningBalanceSnapshotError(
          failedIdentities,
          'Required beginning balance snapshot processing did not complete'
        );
      }

      let snapshots;
      try {
        snapshots = await tx.stock_daily_snapshot.findMany({
          where: {
            company_code: companyCode,
            snapshot_date: snapshotDate,
            OR: batch.map((item) => ({
              item_type: item.item_type,
              item_code: item.item_code,
              uom: item.uom,
            })),
          },
          select: { item_type: true, item_code: true, uom: true, snapshot_date: true },
        });
      } catch (error) {
        throw new BeginningBalanceSnapshotError(
          batch,
          'Required beginning balance snapshot verification failed',
          error
        );
      }
      const snapshotIdentities = new Set(
        snapshots.map((snapshot) => identity({ ...snapshot, item_name: '' }))
      );
      const missing = batch.filter((item) => !snapshotIdentities.has(identity(item)));

      if (missing.length > 0) {
        throw new BeginningBalanceSnapshotError(
          missing,
          'Required beginning balance baseline snapshots are missing after processing'
        );
      }
    }
  }
}
