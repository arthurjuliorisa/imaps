/**
 * End-of-Day (EOD) Snapshot Calculator
 * Calculates comprehensive stock snapshots for today at 23:55
 *
 * Job Schedule: Runs daily at 23:55
 * Purpose: Generate complete end-of-day stock positions for all companies and items
 */

import { prisma } from '@/lib/prisma';
import { JobType, JobStatus, CalculationMethod } from '@prisma/client';

interface EODResult {
  success: boolean;
  processedRecords: number;
  failedRecords: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Main EOD snapshot calculator function
 * Calculates today's snapshots for all companies and items
 */
export async function calculateEODSnapshot(triggeredBy?: string): Promise<EODResult> {
  const jobId = await createJobLog(triggeredBy);
  const startTime = new Date();

  try {
    console.log('[EOD Calculator] Starting end-of-day snapshot calculation...');

    // Get today's date (normalized to midnight UTC)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    console.log(`[EOD Calculator] Calculating snapshots for date: ${today.toISOString().split('T')[0]}`);

    // Update job status to RUNNING
    await updateJobStatus(jobId, JobStatus.RUNNING, {
      snapshot_date: today.toISOString(),
    });

    let processedRecords = 0;
    let failedRecords = 0;

    // Get all active companies
    const companies = await getActiveCompanies();
    console.log(`[EOD Calculator] Found ${companies.length} companies to process`);

    for (const company of companies) {
      try {
        console.log(`[EOD Calculator] Processing company: ${company.company_code}`);

        // Get all items that exist in the system or have transactions
        const items = await getAllItemsForCompany(company.company_code, today);
        console.log(`[EOD Calculator] Found ${items.length} items for ${company.company_code}`);

        for (const item of items) {
          try {
            // Check if this is a WIP (HALB) item - use snapshot method
            if (item.itemTypeCode === 'HALB') {
              await calculateWIPSnapshot(company.company_code, item, today);
            } else {
              // Use transaction-based calculation
              await calculateTransactionSnapshot(company.company_code, item, today);
            }
            processedRecords++;
          } catch (error) {
            console.error(
              `[EOD Calculator] Error processing item ${item.itemCode} for ${company.company_code}:`,
              error
            );
            failedRecords++;
          }
        }
      } catch (error) {
        console.error(`[EOD Calculator] Error processing company ${company.company_code}:`, error);
        failedRecords++;
      }
    }

    // Complete job successfully
    const duration = Date.now() - startTime.getTime();
    await completeJobLog(jobId, processedRecords, failedRecords, {
      duration,
      snapshot_date: today.toISOString(),
      companiesProcessed: companies.length,
    });

    console.log(
      `[EOD Calculator] Completed successfully. Processed: ${processedRecords}, Failed: ${failedRecords}`
    );

    return {
      success: true,
      processedRecords,
      failedRecords,
      metadata: {
        duration,
        snapshot_date: today.toISOString(),
        companiesProcessed: companies.length,
      },
    };
  } catch (error) {
    console.error('[EOD Calculator] Fatal error:', error);
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
 * Get all items for a company that have transactions or beginning balances
 */
async function getAllItemsForCompany(companyCode: string, date: Date) {
  const itemsMap = new Map<
    string,
    { itemCode: string; itemName: string; itemTypeCode: string; uom: string }
  >();

  // Get items from beginning balance
  const beginningBalanceItems = await prisma.beginning_balances.findMany({
    where: {
      company_code: companyCode,
      balance_date: {
        lte: date,
      },
    },
    select: {
      item_code: true,
      item_name: true,
      item_type_code: true,
      uom: true,
    },
  });
  beginningBalanceItems.forEach(item =>
    itemsMap.set(item.item_code, {
      itemCode: item.item_code,
      itemName: item.item_name,
      itemTypeCode: item.item_type_code,
      uom: item.uom,
    })
  );

  // Get items from IncomingDetail
  const incomingItems = await prisma.incoming_details.findMany({
    where: {
      company_code: companyCode,
      trx_date: {
        lte: date,
      },
    },
    select: {
      item_code: true,
      item_name: true,
      item_type_code: true,
      uom: true,
    },
    distinct: ['item_code'],
  });
  incomingItems.forEach(item =>
    itemsMap.set(item.item_code, {
      itemCode: item.item_code,
      itemName: item.item_name,
      itemTypeCode: item.item_type_code,
      uom: item.uom,
    })
  );

  // Get items from OutgoingDetail
  const outgoingItems = await prisma.outgoing_details.findMany({
    where: {
      company_code: companyCode,
      trx_date: {
        lte: date,
      },
    },
    select: {
      item_code: true,
      item_name: true,
      item_type_code: true,
      uom: true,
    },
    distinct: ['item_code'],
  });
  outgoingItems.forEach(item =>
    itemsMap.set(item.item_code, {
      itemCode: item.item_code,
      itemName: item.item_name,
      itemTypeCode: item.item_type_code,
      uom: item.uom,
    })
  );

  // Get items from MaterialUsageDetail
  const materialUsageItems = await prisma.material_usage_details.findMany({
    where: {
      company_code: companyCode,
      trx_date: {
        lte: date,
      },
    },
    select: {
      item_code: true,
      item_name: true,
      item_type_code: true,
      uom: true,
    },
    distinct: ['item_code'],
  });
  materialUsageItems.forEach(item =>
    itemsMap.set(item.item_code, {
      itemCode: item.item_code,
      itemName: item.item_name,
      itemTypeCode: item.item_type_code,
      uom: item.uom,
    })
  );

  // Get items from FinishedGoodsProductionDetail
  const productionItems = await prisma.finished_goods_production_details.findMany({
    where: {
      company_code: companyCode,
      trx_date: {
        lte: date,
      },
    },
    select: {
      item_code: true,
      item_name: true,
      uom: true,
    },
    distinct: ['item_code'],
  });
  productionItems.forEach(item =>
    itemsMap.set(item.item_code, {
      itemCode: item.item_code,
      itemName: item.item_name,
      itemTypeCode: 'FERT',
      uom: item.uom,
    })
  );

  // Get items from Adjustment
  const adjustmentItems = await prisma.adjustment_details.findMany({
    where: {
      company_code: companyCode,
      trx_date: {
        lte: date,
      },
    },
    select: {
      item_code: true,
      item_name: true,
      item_type_code: true,
      uom: true,
    },
    distinct: ['item_code'],
  });
  adjustmentItems.forEach(item =>
    itemsMap.set(item.item_code, {
      itemCode: item.item_code,
      itemName: item.item_name,
      itemTypeCode: item.item_type_code,
      uom: item.uom,
    })
  );

  return Array.from(itemsMap.values());
}

/**
 * Calculate WIP snapshot using direct WIP balance (for HALB items)
 */
async function calculateWIPSnapshot(
  companyCode: string,
  item: { itemCode: string; itemName: string; itemTypeCode: string; uom: string },
  date: Date
): Promise<void> {
  // Get WIP balance for today
  const wipBalance = await prisma.wip_balance.findUnique({
    where: {
      company_code_item_code_snapshot_date: {
        company_code: companyCode,
        item_code: item.itemCode,
        snapshot_date: date,
      },
    },
  });

  if (!wipBalance) {
    // No WIP balance recorded for today, skip or use previous day's closing
    const previousDate = new Date(date);
    previousDate.setDate(previousDate.getDate() - 1);

    const previousSnapshot = await prisma.stock_daily_snapshot.findUnique({
      where: {
        company_code_item_type_code_item_code_snapshot_date: {
          company_code: companyCode,
          item_type_code: item.itemTypeCode,
          item_code: item.itemCode,
          snapshot_date: previousDate,
        },
      },
    });

    const closingBalance = previousSnapshot ? Number(previousSnapshot.closing_balance) : 0;

    await prisma.stock_daily_snapshot.upsert({
      where: {
        company_code_item_type_code_item_code_snapshot_date: {
          company_code: companyCode,
          item_type_code: item.itemTypeCode,
          item_code: item.itemCode,
          snapshot_date: date,
        },
      },
      create: {
        company_code: companyCode,
        item_code: item.itemCode,
        item_type_code: item.itemTypeCode as any,
        item_name: item.itemName,
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

  // Use WIP balance as both opening and closing
  const wipQty = Number(wipBalance.qty);

  await prisma.stock_daily_snapshot.upsert({
    where: {
      company_code_item_type_code_item_code_snapshot_date: {
        company_code: companyCode,
        item_type_code: item.itemTypeCode,
        item_code: item.itemCode,
        snapshot_date: date,
      },
    },
    create: {
      company_code: companyCode,
      item_code: item.itemCode,
      item_type_code: item.itemTypeCode as any,
      item_name: item.itemName,
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
 * Calculate transaction-based snapshot (for non-HALB items)
 */
async function calculateTransactionSnapshot(
  companyCode: string,
  item: { itemCode: string; itemName: string; itemTypeCode: string; uom: string },
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
        item_type_code: item.itemTypeCode,
        item_code: item.itemCode,
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
        item_code: item.itemCode,
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

  // Calculate transaction quantities for today
  const incoming = await calculateIncoming(companyCode, item.itemCode, date);
  const outgoing = await calculateOutgoing(companyCode, item.itemCode, date);
  const materialUsage = await calculateMaterialUsage(companyCode, item.itemCode, date);
  const production = await calculateProduction(companyCode, item.itemCode, date);
  const adjustment = await calculateAdjustment(companyCode, item.itemCode, date);

  // Calculate closing balance
  const closingBalance = openingBalance + incoming - outgoing - materialUsage + production + adjustment;

  // Upsert snapshot
  await prisma.stock_daily_snapshot.upsert({
    where: {
      company_code_item_type_code_item_code_snapshot_date: {
        company_code: companyCode,
        item_type_code: item.itemTypeCode,
        item_code: item.itemCode,
        snapshot_date: date,
      },
    },
    create: {
      company_code: companyCode,
      item_code: item.itemCode,
      item_type_code: item.itemTypeCode as any,
      item_name: item.itemName,
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
      item_name: item.itemName,
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
      job_type: JobType.EOD_SNAPSHOT,
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
    },
  });
}
