/**
 * Hourly Batch Processor
 * Processes transactions from the last hour and updates stock snapshots
 *
 * Job Schedule: Runs every hour at minute 5 (e.g., 01:05, 02:05, 03:05, etc.)
 * Purpose: Incremental processing to reduce EOD load
 */

import { prisma } from '@/lib/prisma';
import { JobType, JobStatus } from '@prisma/client';

interface ProcessResult {
  success: boolean;
  processedRecords: number;
  failedRecords: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Main hourly batch processor function
 * Processes new transactions from the last hour
 */
export async function processHourlyBatch(triggeredBy?: string): Promise<ProcessResult> {
  const jobId = await createJobLog(triggeredBy);
  const startTime = new Date();

  try {
    console.log('[Hourly Batch] Starting hourly batch processing...');

    // Calculate time window (last hour)
    const endTime = new Date();
    const startTimeWindow = new Date(endTime.getTime() - 60 * 60 * 1000); // 1 hour ago

    console.log(`[Hourly Batch] Processing transactions from ${startTimeWindow.toISOString()} to ${endTime.toISOString()}`);

    // Update job status to RUNNING
    await updateJobStatus(jobId, JobStatus.RUNNING, {
      startTimeWindow: startTimeWindow.toISOString(),
      endTimeWindow: endTime.toISOString(),
    });

    let processedRecords = 0;
    let failedRecords = 0;

    // Process transactions by company and date
    const companies = await getActiveCompanies();

    for (const company of companies) {
      try {
        console.log(`[Hourly Batch] Processing company: ${company.company_code}`);

        // Get affected dates (transactions within the hour)
        const affectedDates = await getAffectedDates(
          company.company_code,
          startTimeWindow,
          endTime
        );

        for (const date of affectedDates) {
          try {
            // Process each date - this will recalculate stock snapshots
            await processCompanyDate(company.company_code, date);
            processedRecords++;
          } catch (error) {
            console.error(`[Hourly Batch] Error processing ${company.company_code} on ${date}:`, error);
            failedRecords++;
          }
        }
      } catch (error) {
        console.error(`[Hourly Batch] Error processing company ${company.company_code}:`, error);
        failedRecords++;
      }
    }

    // Complete job successfully
    const duration = Date.now() - startTime.getTime();
    await completeJobLog(jobId, processedRecords, failedRecords, {
      duration,
      companiesProcessed: companies.length,
    });

    console.log(`[Hourly Batch] Completed successfully. Processed: ${processedRecords}, Failed: ${failedRecords}`);

    return {
      success: true,
      processedRecords,
      failedRecords,
      metadata: {
        duration,
        companiesProcessed: companies.length,
      },
    };
  } catch (error) {
    console.error('[Hourly Batch] Fatal error:', error);
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
 * Get list of active companies
 */
async function getActiveCompanies() {
  return await prisma.companies.findMany({
    select: {
      company_code: true,
      company_name: true,
    },
  });
}

/**
 * Get affected dates within time window
 * Returns dates that have transactions in the specified time range
 */
async function getAffectedDates(
  companyCode: string,
  startTime: Date,
  endTime: Date
): Promise<Date[]> {
  const dates = new Set<string>();

  // Check IncomingHeader
  const incomingDates = await prisma.incoming_headers.findMany({
    where: {
      company_code: companyCode,
      created_at: {
        gte: startTime,
        lt: endTime,
      },
    },
    select: { trx_date: true },
    distinct: ['trx_date'],
  });
  incomingDates.forEach(item => dates.add(item.trx_date.toISOString().split('T')[0]));

  // Check OutgoingHeader
  const outgoingDates = await prisma.outgoing_headers.findMany({
    where: {
      company_code: companyCode,
      created_at: {
        gte: startTime,
        lt: endTime,
      },
    },
    select: { trx_date: true },
    distinct: ['trx_date'],
  });
  outgoingDates.forEach(item => dates.add(item.trx_date.toISOString().split('T')[0]));

  // Check MaterialUsageHeader
  const materialUsageDates = await prisma.material_usage_headers.findMany({
    where: {
      company_code: companyCode,
      created_at: {
        gte: startTime,
        lt: endTime,
      },
    },
    select: { trx_date: true },
    distinct: ['trx_date'],
  });
  materialUsageDates.forEach(item => dates.add(item.trx_date.toISOString().split('T')[0]));

  // Check FinishedGoodsProductionHeader
  const productionDates = await prisma.finished_goods_production_headers.findMany({
    where: {
      company_code: companyCode,
      created_at: {
        gte: startTime,
        lt: endTime,
      },
    },
    select: { trx_date: true },
    distinct: ['trx_date'],
  });
  productionDates.forEach(item => dates.add(item.trx_date.toISOString().split('T')[0]));

  // Check Adjustment
  const adjustmentDates = await prisma.adjustments.findMany({
    where: {
      company_code: companyCode,
      created_at: {
        gte: startTime,
        lt: endTime,
      },
    },
    select: { trx_date: true },
    distinct: ['trx_date'],
  });
  adjustmentDates.forEach(item => dates.add(item.trx_date.toISOString().split('T')[0]));

  // Convert to Date objects
  return Array.from(dates).map(dateStr => new Date(dateStr));
}

/**
 * Process stock snapshots for a specific company and date
 * This will recalculate all affected items for the given date
 */
async function processCompanyDate(companyCode: string, date: Date): Promise<void> {
  console.log(`[Hourly Batch] Calculating snapshots for ${companyCode} on ${date.toISOString().split('T')[0]}`);

  // Get all items affected on this date
  const affectedItems = await getAffectedItems(companyCode, date);

  for (const item of affectedItems) {
    await calculateStockSnapshot(companyCode, item.itemCode, item.itemTypeCode, date);
  }
}

/**
 * Get all items affected on a specific date
 */
async function getAffectedItems(companyCode: string, date: Date) {
  const items = new Map<string, { itemCode: string; itemTypeCode: string }>();

  // From IncomingDetail
  const incomingItems = await prisma.incoming_details.findMany({
    where: { company_code: companyCode, trx_date: date },
    select: { item_code: true, item_type_code: true },
    distinct: ['item_code'],
  });
  incomingItems.forEach(item => items.set(item.item_code, { itemCode: item.item_code, itemTypeCode: item.item_type_code }));

  // From OutgoingDetail
  const outgoingItems = await prisma.outgoing_details.findMany({
    where: { company_code: companyCode, trx_date: date },
    select: { item_code: true, item_type_code: true },
    distinct: ['item_code'],
  });
  outgoingItems.forEach(item => items.set(item.item_code, { itemCode: item.item_code, itemTypeCode: item.item_type_code }));

  // From MaterialUsageDetail
  const materialUsageItems = await prisma.material_usage_details.findMany({
    where: { company_code: companyCode, trx_date: date },
    select: { item_code: true, item_type_code: true },
    distinct: ['item_code'],
  });
  materialUsageItems.forEach(item => items.set(item.item_code, { itemCode: item.item_code, itemTypeCode: item.item_type_code }));

  // From FinishedGoodsProductionDetail (FERT type)
  const productionItems = await prisma.finished_goods_production_details.findMany({
    where: { company_code: companyCode, trx_date: date },
    select: { item_code: true },
    distinct: ['item_code'],
  });
  productionItems.forEach(item => items.set(item.item_code, { itemCode: item.item_code, itemTypeCode: 'FERT' }));

  // From Adjustment
  const adjustmentItems = await prisma.adjustment_details.findMany({
    where: { company_code: companyCode, trx_date: date },
    select: { item_code: true, item_type_code: true },
    distinct: ['item_code'],
  });
  adjustmentItems.forEach(item => items.set(item.item_code, { itemCode: item.item_code, itemTypeCode: item.item_type_code }));

  return Array.from(items.values());
}

/**
 * Calculate and update stock snapshot for a specific item on a specific date
 */
async function calculateStockSnapshot(
  companyCode: string,
  itemCode: string,
  itemTypeCode: string,
  date: Date
): Promise<void> {
  // Get opening balance (previous day's closing or beginning balance)
  const previousDate = new Date(date);
  previousDate.setDate(previousDate.getDate() - 1);

  let openingBalance = 0;

  // Try to get previous day's snapshot
  const previousSnapshot = await prisma.stock_daily_snapshot.findUnique({
    where: {
      company_code_item_type_code_item_code_snapshot_date: {
        company_code: companyCode,
        item_type_code: itemTypeCode,
        item_code: itemCode,
        snapshot_date: previousDate,
      },
    },
  });

  if (previousSnapshot) {
    openingBalance = Number(previousSnapshot.closing_balance);
  } else {
    // Try to get beginning balance
    const beginningBalance = await prisma.beginning_balances.findFirst({
      where: {
        company_code: companyCode,
        item_code: itemCode,
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
  const incoming = await calculateIncoming(companyCode, itemCode, date);
  const outgoing = await calculateOutgoing(companyCode, itemCode, date);
  const materialUsage = await calculateMaterialUsage(companyCode, itemCode, date);
  const production = await calculateProduction(companyCode, itemCode, date);
  const adjustment = await calculateAdjustment(companyCode, itemCode, date);

  // Calculate closing balance
  const closingBalance = openingBalance + incoming - outgoing - materialUsage + production + adjustment;

  // Upsert snapshot
  await prisma.stock_daily_snapshot.upsert({
    where: {
      company_code_item_type_code_item_code_snapshot_date: {
        company_code: companyCode,
        item_type_code: itemTypeCode,
        item_code: itemCode,
        snapshot_date: date,
      },
    },
    create: {
      company_code: companyCode,
      item_code: itemCode,
      item_type_code: itemTypeCode as any,
      item_name: '', // Will be updated by full calculation
      snapshot_date: date,
      opening_balance: openingBalance,
      incoming_qty: incoming,
      outgoing_qty: outgoing,
      material_usage_qty: materialUsage,
      production_qty: production,
      adjustment_qty: adjustment,
      closing_balance: closingBalance,
      calculation_method: 'TRANSACTION' as any,
      calculated_at: new Date(),
      updated_at: new Date(),
    },
    update: {
      opening_balance: openingBalance,
      incoming_qty: incoming,
      outgoing_qty: outgoing,
      material_usage_qty: materialUsage,
      production_qty: production,
      adjustment_qty: adjustment,
      closing_balance: closingBalance,
      calculation_method: 'TRANSACTION' as any,
      calculated_at: new Date(),
      updated_at: new Date(),
    },
  });
}

async function calculateIncoming(companyCode: string, itemCode: string, date: Date): Promise<number> {
  const result = await prisma.incoming_details.aggregate({
    where: { company_code: companyCode, item_code: itemCode, trx_date: date },
    _sum: { qty: true },
  });
  return Number(result._sum.qty || 0);
}

async function calculateOutgoing(companyCode: string, itemCode: string, date: Date): Promise<number> {
  const result = await prisma.outgoing_details.aggregate({
    where: { company_code: companyCode, item_code: itemCode, trx_date: date },
    _sum: { qty: true },
  });
  return Number(result._sum.qty || 0);
}

async function calculateMaterialUsage(companyCode: string, itemCode: string, date: Date): Promise<number> {
  const result = await prisma.material_usage_details.aggregate({
    where: { company_code: companyCode, item_code: itemCode, trx_date: date },
    _sum: { qty: true },
  });
  return Number(result._sum.qty || 0);
}

async function calculateProduction(companyCode: string, itemCode: string, date: Date): Promise<number> {
  const result = await prisma.finished_goods_production_details.aggregate({
    where: { company_code: companyCode, item_code: itemCode, trx_date: date },
    _sum: { qty: true },
  });
  return Number(result._sum.qty || 0);
}

async function calculateAdjustment(companyCode: string, itemCode: string, date: Date): Promise<number> {
  const result = await prisma.adjustment_details.aggregate({
    where: { company_code: companyCode, item_code: itemCode, trx_date: date },
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
      job_type: JobType.HOURLY_BATCH,
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
  processedRecords: number,
  failedRecords: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.batch_processing_logs.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      completed_at: new Date(),
      total_records: processedRecords + failedRecords,
      successful_records: processedRecords,
      failed_records: failedRecords,
      updated_at: new Date(),
    },
  });
}

/**
 * Mark job as failed
 */
async function failJobLog(
  jobId: string,
  errorMessage: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.batch_processing_logs.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      completed_at: new Date(),
      error_message: errorMessage,
      updated_at: new Date(),
    },
  });
}
