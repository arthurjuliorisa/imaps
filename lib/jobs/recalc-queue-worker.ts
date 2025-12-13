/**
 * Recalculation Queue Worker
 * Processes pending recalculation requests from the queue
 *
 * Job Schedule: Runs every 5 minutes
 * Purpose: Handle backdated transactions and manual recalculation requests
 */

import { prisma } from '@/lib/prisma';
import { JobType, JobStatus, RecalcStatus, CalculationMethod } from '@prisma/client';

interface RecalcResult {
  success: boolean;
  processedRecords: number;
  failedRecords: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

const MAX_RETRIES = 3;
const BATCH_SIZE = 10; // Process up to 10 queue items per run

/**
 * Main recalculation queue worker function
 * Processes pending items from the SnapshotRecalcQueue
 */
export async function processRecalcQueue(triggeredBy?: string): Promise<RecalcResult> {
  const jobId = await createJobLog(triggeredBy);
  const startTime = new Date();

  try {
    console.log('[Recalc Queue] Starting recalculation queue processing...');

    // Update job status to RUNNING
    await updateJobStatus(jobId, JobStatus.RUNNING);

    let processedRecords = 0;
    let failedRecords = 0;

    // Get pending queue items (highest priority first, FIFO for same priority)
    const queueItems = await prisma.snapshot_recalc_queue.findMany({
      where: {
        status: RecalcStatus.PENDING,
      },
      orderBy: [
        { priority: 'desc' },
        { queued_at: 'asc' },
      ],
      take: BATCH_SIZE,
    });

    console.log(`[Recalc Queue] Found ${queueItems.length} items to process`);

    for (const item of queueItems) {
      try {
        console.log(
          `[Recalc Queue] Processing recalc for company ${item.company_code}, date ${item.recalc_date.toISOString().split('T')[0]}`
        );

        // Mark as processing
        await prisma.snapshot_recalc_queue.update({
          where: { id: item.id },
          data: {
            status: RecalcStatus.PROCESSING,
            started_at: new Date(),
          },
        });

        // Process the recalculation
        await recalculateCompanyDate(item.company_code, item.recalc_date);

        // Mark as completed
        await prisma.snapshot_recalc_queue.update({
          where: { id: item.id },
          data: {
            status: RecalcStatus.COMPLETED,
            completed_at: new Date(),
          },
        });

        processedRecords++;
        console.log(`[Recalc Queue] Successfully processed queue item ${item.id}`);
      } catch (error) {
        console.error(`[Recalc Queue] Error processing queue item ${item.id}:`, error);

        const error_message = error instanceof Error ? error.message : 'Unknown error';

        // Check retry count
        if (item.priority < MAX_RETRIES) {
          // Increment retry count and reset to pending
          await prisma.snapshot_recalc_queue.update({
            where: { id: item.id },
            data: {
              status: RecalcStatus.PENDING,
              priority: item.priority + 1,
              error_message,
            },
          });
          console.log(`[Recalc Queue] Queue item ${item.id} will be retried (attempt ${item.priority + 1})`);
        } else {
          // Max retries reached, mark as failed
          await prisma.snapshot_recalc_queue.update({
            where: { id: item.id },
            data: {
              status: RecalcStatus.FAILED,
              completed_at: new Date(),
              error_message,
            },
          });
          console.log(`[Recalc Queue] Queue item ${item.id} failed after max retries`);
        }

        failedRecords++;
      }
    }

    // Complete job successfully
    const duration = Date.now() - startTime.getTime();
    await completeJobLog(jobId, processedRecords, failedRecords, {
      duration,
      queueItemsProcessed: queueItems.length,
    });

    console.log(
      `[Recalc Queue] Completed successfully. Processed: ${processedRecords}, Failed: ${failedRecords}`
    );

    return {
      success: true,
      processedRecords,
      failedRecords,
      metadata: {
        duration,
        queueItemsProcessed: queueItems.length,
      },
    };
  } catch (error) {
    console.error('[Recalc Queue] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await failJobLog(jobId, errorMessage, {
      error: error instanceof Error ? error.stack : String(error),
    });

    return {
      success: false,
      processedRecords: 0,
      failedRecords: 0,
      errorMessage,
    };
  }
}

/**
 * Recalculate all snapshots for a specific company and date
 * This will also trigger recalculation of all subsequent dates
 */
async function recalculateCompanyDate(company_code: string, date: Date): Promise<void> {
  console.log(
    `[Recalc Queue] Recalculating snapshots for ${company_code} starting from ${date.toISOString().split('T')[0]}`
  );

  // Get all items for this company
  const items = await getAllItemsForCompany(company_code, date);
  console.log(`[Recalc Queue] Found ${items.length} items to recalculate`);

  // Recalculate each item for the target date
  for (const item of items) {
    try {
      // Check if this is a WIP (HALB) item
      if (item.item_type_code === 'HALB') {
        await calculateWIPSnapshot(company_code, item, date);
      } else {
        await calculateTransactionSnapshot(company_code, item, date);
      }
    } catch (error) {
      console.error(
        `[Recalc Queue] Error recalculating item ${item.item_code} for ${company_code}:`,
        error
      );
      throw error; // Propagate error to mark queue item as failed
    }
  }

  // Recalculate all subsequent dates (cascade effect)
  await recalculateSubsequentDates(company_code, date, items);
}

/**
 * Recalculate all dates after the target date (cascade effect)
 * When a past date changes, all future dates must be recalculated
 */
async function recalculateSubsequentDates(
  company_code: string,
  startDate: Date,
  items: Array<{ item_code: string; item_name: string; item_type_code: string }>
): Promise<void> {
  // Get all snapshot dates after the start date
  const subsequentSnapshots = await prisma.stock_daily_snapshot.findMany({
    where: {
      company_code,
      snapshot_date: {
        gt: startDate,
      },
    },
    select: {
      snapshot_date: true,
    },
    distinct: ['snapshot_date'],
    orderBy: {
      snapshot_date: 'asc',
    },
  });

  console.log(
    `[Recalc Queue] Recalculating ${subsequentSnapshots.length} subsequent dates for ${company_code}`
  );

  // Recalculate each subsequent date
  for (const snapshot of subsequentSnapshots) {
    for (const item of items) {
      try {
        if (item.item_type_code === 'HALB') {
          await calculateWIPSnapshot(company_code, item, snapshot.snapshot_date);
        } else {
          await calculateTransactionSnapshot(company_code, item, snapshot.snapshot_date);
        }
      } catch (error) {
        console.error(
          `[Recalc Queue] Error recalculating subsequent date ${snapshot.snapshot_date.toISOString()} for item ${item.item_code}:`,
          error
        );
        // Continue with other items even if one fails
      }
    }
  }
}

/**
 * Get all items for a company
 */
async function getAllItemsForCompany(company_code: string, fromDate: Date) {
  const itemsMap = new Map<
    string,
    { item_code: string; item_name: string; item_type_code: string }
  >();

  // Get items from existing snapshots
  const snapshotItems = await prisma.stock_daily_snapshot.findMany({
    where: {
      company_code: company_code,
      snapshot_date: {
        gte: fromDate,
      },
    },
    select: {
      item_code: true,
      item_name: true,
      item_type_code: true,
    },
    distinct: ['item_code'],
  });
  snapshotItems.forEach(item =>
    itemsMap.set(item.item_code, {
      item_code: item.item_code,
      item_name: item.item_name,
      item_type_code: item.item_type_code,
    })
  );

  // Get items from beginning balance
  const beginningBalanceItems = await prisma.beginning_balances.findMany({
    where: {
      company_code: company_code,
      balance_date: {
        lte: fromDate,
      },
    },
    select: {
      item_code: true,
      item_name: true,
      item_type_code: true,
    },
  });
  beginningBalanceItems.forEach(item =>
    itemsMap.set(item.item_code, {
      item_code: item.item_code,
      item_name: item.item_name,
      item_type_code: item.item_type_code,
    })
  );

  // Get items from transactions on or after the date
  const incomingItems = await prisma.incoming_details.findMany({
    where: {
      company_code: company_code,
      trx_date: {
        gte: fromDate,
      },
    },
    select: {
      item_code: true,
      item_name: true,
      item_type_code: true,
    },
    distinct: ['item_code'],
  });
  incomingItems.forEach(item =>
    itemsMap.set(item.item_code, {
      item_code: item.item_code,
      item_name: item.item_name,
      item_type_code: item.item_type_code,
    })
  );

  return Array.from(itemsMap.values());
}

/**
 * Calculate WIP snapshot (for HALB items)
 */
async function calculateWIPSnapshot(
  company_code: string,
  item: { item_code: string; item_name: string; item_type_code: string },
  date: Date
): Promise<void> {
  const wipBalance = await prisma.wip_balance.findUnique({
    where: {
      company_code_item_code_snapshot_date: {
        company_code: company_code,
        snapshot_date: date,
        item_code: item.item_code,
      },
    },
  });

  if (!wipBalance) {
    // No WIP balance, use previous day's closing
    const previousDate = new Date(date);
    previousDate.setDate(previousDate.getDate() - 1);

    const previousSnapshot = await prisma.stock_daily_snapshot.findUnique({
      where: {
        company_code_item_type_code_item_code_snapshot_date: {
          company_code: company_code,
          item_type_code: item.item_type_code,
          item_code: item.item_code,
          snapshot_date: previousDate,
        },
      },
    });

    const closingBalance = previousSnapshot ? Number(previousSnapshot.closing_balance) : 0;

    await prisma.stock_daily_snapshot.upsert({
      where: {
        company_code_item_type_code_item_code_snapshot_date: {
          company_code: company_code,
          item_type_code: item.item_type_code,
          item_code: item.item_code,
          snapshot_date: date,
        },
      },
      create: {
        company_code: company_code,
        item_code: item.item_code,
        item_type_code: item.item_type_code as any,
        item_name: item.item_name,
        snapshot_date: date,
        opening_balance: closingBalance,
        wip_balance_qty: closingBalance,
        closing_balance: closingBalance,
        calculation_method: CalculationMethod.WIP_SNAPSHOT,
        calculated_at: new Date(),
        updated_at: new Date(),
      },
      update: {
        opening_balance: closingBalance,
        wip_balance_qty: closingBalance,
        closing_balance: closingBalance,
        calculation_method: CalculationMethod.WIP_SNAPSHOT,
        calculated_at: new Date(),
        updated_at: new Date(),
      },
    });

    return;
  }

  const wipQty = Number(wipBalance.qty);

  await prisma.stock_daily_snapshot.upsert({
    where: {
      company_code_item_type_code_item_code_snapshot_date: {
        company_code: company_code,
          item_type_code: item.item_type_code,
        item_code: item.item_code,
        snapshot_date: date,
      },
    },
    create: {
      company_code: company_code,
      item_code: item.item_code,
      item_type_code: item.item_type_code as any,
      item_name: item.item_name,
      snapshot_date: date,
      opening_balance: wipQty,
      wip_balance_qty: wipQty,
      closing_balance: wipQty,
      calculation_method: CalculationMethod.WIP_SNAPSHOT,
      calculated_at: new Date(),
      updated_at: new Date(),
    },
    update: {
      opening_balance: wipQty,
      wip_balance_qty: wipQty,
      closing_balance: wipQty,
      calculation_method: CalculationMethod.WIP_SNAPSHOT,
      calculated_at: new Date(),
      updated_at: new Date(),
    },
  });
}

/**
 * Calculate transaction-based snapshot
 */
async function calculateTransactionSnapshot(
  company_code: string,
  item: { item_code: string; item_name: string; item_type_code: string },
  date: Date
): Promise<void> {
  // Get opening balance
  const previousDate = new Date(date);
  previousDate.setDate(previousDate.getDate() - 1);

  let openingBalance = 0;

  const previousSnapshot = await prisma.stock_daily_snapshot.findUnique({
    where: {
      company_code_item_type_code_item_code_snapshot_date: {
        company_code: company_code,
          item_type_code: item.item_type_code,
        item_code: item.item_code,
        snapshot_date: previousDate,
      },
    },
  });

  if (previousSnapshot) {
    openingBalance = Number(previousSnapshot.closing_balance);
  } else {
    const beginningBalance = await prisma.beginning_balances.findFirst({
      where: {
        company_code: company_code,
        item_code: item.item_code,
        balance_date: {
          lte: date,
        },
      },
      orderBy: {
        balance_date: 'desc',
      },
    });

    if (beginningBalance) {
      openingBalance = Number(beginningBalance.balance_qty);
    }
  }

  // Calculate transaction quantities
  const incoming = await calculateIncoming(company_code, item.item_code, date);
  const outgoing = await calculateOutgoing(company_code, item.item_code, date);
  const materialUsage = await calculateMaterialUsage(company_code, item.item_code, date);
  const production = await calculateProduction(company_code, item.item_code, date);
  const adjustment = await calculateAdjustment(company_code, item.item_code, date);

  const closingBalance = openingBalance + incoming - outgoing - materialUsage + production + adjustment;

  await prisma.stock_daily_snapshot.upsert({
    where: {
      company_code_item_type_code_item_code_snapshot_date: {
        company_code: company_code,
          item_type_code: item.item_type_code,
        item_code: item.item_code,
        snapshot_date: date,
      },
    },
    create: {
      company_code: company_code,
      item_code: item.item_code,
      item_type_code: item.item_type_code as any,
      item_name: item.item_name,
      snapshot_date: date,
      opening_balance: openingBalance,
      incoming_qty: incoming,
      outgoing_qty: outgoing,
      material_usage_qty: materialUsage,
      production_qty: production,
      adjustment_qty: adjustment,
      closing_balance: closingBalance,
      calculation_method: CalculationMethod.TRANSACTION,
      calculated_at: new Date(),
      updated_at: new Date(),
    },
    update: {
      item_name: item.item_name,
      opening_balance: openingBalance,
      incoming_qty: incoming,
      outgoing_qty: outgoing,
      material_usage_qty: materialUsage,
      production_qty: production,
      adjustment_qty: adjustment,
      closing_balance: closingBalance,
      calculation_method: CalculationMethod.TRANSACTION,
      calculated_at: new Date(),
      updated_at: new Date(),
    },
  });
}

async function calculateIncoming(company_code: string, item_code: string, date: Date): Promise<number> {
  const result = await prisma.incoming_details.aggregate({
    where: { company_code, item_code, trx_date: date },
    _sum: { qty: true },
  });
  return Number(result._sum.qty || 0);
}

async function calculateOutgoing(company_code: string, item_code: string, date: Date): Promise<number> {
  const result = await prisma.outgoing_details.aggregate({
    where: { company_code, item_code, trx_date: date },
    _sum: { qty: true },
  });
  return Number(result._sum.qty || 0);
}

async function calculateMaterialUsage(company_code: string, item_code: string, date: Date): Promise<number> {
  const result = await prisma.material_usage_details.aggregate({
    where: { company_code, item_code, trx_date: date },
    _sum: { qty: true },
  });
  return Number(result._sum.qty || 0);
}

async function calculateProduction(company_code: string, item_code: string, date: Date): Promise<number> {
  const result = await prisma.finished_goods_production_details.aggregate({
    where: { company_code, item_code, trx_date: date },
    _sum: { qty: true },
  });
  return Number(result._sum.qty || 0);
}

async function calculateAdjustment(company_code: string, item_code: string, date: Date): Promise<number> {
  const result = await prisma.adjustment_details.aggregate({
    where: { company_code, item_code, trx_date: date },
    _sum: { qty: true },
  });
  return Number(result._sum.qty || 0);
}

/**
 * Create a new job log entry
 */
async function createJobLog(triggeredBy?: string): Promise<string> {
  const log = await prisma.batch_processing_logs.create({
    data: {
      job_type: JobType.RECALC_QUEUE,
      status: JobStatus.PENDING,
      updated_at: new Date(),
    },
  });
  return log.id;
}

/**
 * Update job status
 */
async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.batch_processing_logs.update({
    where: { id: jobId },
    data: {
      status,
      updated_at: new Date(),
    },
  });
}

/**
 * Complete job successfully
 */
async function completeJobLog(
  jobId: string,
  successful_records: number,
  failed_records: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.batch_processing_logs.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      completed_at: new Date(),
      total_records: successful_records + failed_records,
      successful_records,
      failed_records,
      updated_at: new Date(),
    },
  });
}

/**
 * Mark job as failed
 */
async function failJobLog(
  jobId: string,
  error_message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.batch_processing_logs.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      completed_at: new Date(),
      error_message,
      updated_at: new Date(),
    },
  });
}
