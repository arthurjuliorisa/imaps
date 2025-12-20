import { SnapshotRecalcRepository } from './snapshot-recalc.repository';
import { isBackdated } from '../utils/date.util';
import { logger } from '../utils/logger';
import { prisma } from '../db/prisma';

/**
 * Base repository for transaction tables
 * Handles backdated transaction checking and queue management
 */
export abstract class BaseTransactionRepository {
  protected snapshotRecalcRepo: SnapshotRecalcRepository;

  constructor() {
    this.snapshotRecalcRepo = new SnapshotRecalcRepository();
  }

  /**
   * Check if transaction is backdated and queue recalculation if needed
   */
  protected async handleBackdatedTransaction(
    company_code: number,
    transaction_date: Date,
    wms_id: string,
    transaction_type: 'incoming_goods' | 'material_usage' | 'outgoing_goods' | 'production_output' | 'adjustments'
  ): Promise<void> {
    try {
      // Check if backdated
      const isBackdatedTx = isBackdated(transaction_date);

      if (!isBackdatedTx) {
        // Same-day transaction: queue for end-of-day processing if not already queued
        const alreadyQueuedToday = await this.snapshotRecalcRepo.isAlreadyQueued(
          company_code,
          transaction_date
        );

        if (alreadyQueuedToday) {
          logger.debug(
            'Same-day recalculation already queued',
            {
              wmsId: wms_id,
              companyCode: company_code,
              transactionDate: transaction_date,
              transactionType: transaction_type,
            },
          );
          return;
        }

        await this.snapshotRecalcRepo.queueRecalculation({
          company_code,
          recalc_date: transaction_date,
          reason: `Same-day ${transaction_type}: ${wms_id}`,
          priority: -1, // lower priority, processed at end-of-day by worker
        });

        logger.info(
          'Same-day transaction queued for end-of-day recalculation',
          {
            wmsId: wms_id,
            companyCode: company_code,
            transactionDate: transaction_date,
            transactionType: transaction_type,
          },
        );
        return;
      }

      // Check if already queued
      const alreadyQueued = await this.snapshotRecalcRepo.isAlreadyQueued(
        company_code,
        transaction_date
      );

      if (alreadyQueued) {
        logger.debug(
          'Recalculation already queued for this date',
          {
            wmsId: wms_id,
            companyCode: company_code,
            transactionDate: transaction_date,
          },
        );
        // Optionally still ensure partitions
        await this.ensureBackdatedMaintenance(company_code, transaction_date, wms_id, transaction_type);
        return;
      }

      // Queue recalculation
      const queueId = await this.snapshotRecalcRepo.queueRecalculation({
        company_code,
        recalc_date: transaction_date,
        reason: `Backdated ${transaction_type}: ${wms_id}`,
        priority: 0,
      });

      logger.info(
        'Backdated transaction detected, recalculation queued',
        {
          wmsId: wms_id,
          companyCode: company_code,
          transactionDate: transaction_date,
          transactionType: transaction_type,
        },
      );

      // Run snapshot recalculation immediately for backdated changes (non-blocking)
      try {
        await this.snapshotRecalcRepo.processImmediately(
          queueId,
          company_code,
          transaction_date,
        );
      } catch (processError: any) {
        // Log error but don't fail - recalculation will be processed by background worker
        logger.warn(
          'Immediate snapshot recalculation failed (will retry via background worker)',
          {
            wmsId: wms_id,
            companyCode: company_code,
            transactionDate: transaction_date,
            queueId: queueId.toString(),
            errorName: processError?.name,
            errorMessage: processError?.message,
            errorCode: processError?.code,
          },
        );
      }

      // Ensure partition/maintenance for backdated data (non-blocking)
      await this.ensureBackdatedMaintenance(company_code, transaction_date, wms_id, transaction_type);
    } catch (error: any) {
      // Log error but don't fail the transaction
      logger.error(
        'Failed to queue snapshot recalculation',
        {
          errorName: error?.name,
          errorMessage: error?.message,
          errorCode: error?.code,
          errorMeta: error?.meta,
          errorStack: error?.stack,
          wmsId: wms_id,
          companyCode: company_code,
          transactionDate: transaction_date,
        },
      );
    }
  }

  /**
   * Ensure any backdated maintenance (partitions, summaries, etc).
   * Non-blocking: never throws, only logs.
   */
  protected async ensureBackdatedMaintenance(
    companyCode: number,
    transactionDate: Date,
    wmsId: string,
    tableName: 'incoming_goods' | 'material_usage' | 'outgoing_goods' | 'production_output' | 'adjustments'
  ): Promise<void> {
    const log = logger.child({
      scope: 'BaseTransactionRepository.ensureBackdatedMaintenance',
      wmsId,
      companyCode,
      transactionDate,
      tableName,
    });

    // Map table names to function names
    const funcNameMap: Record<string, string> = {
      'incoming_goods': 'ensure_incoming_goods_partition',
      'material_usage': 'ensure_material_usages_partition',
      'outgoing_goods': 'ensure_outgoing_goods_partition',
      'production_output': 'ensure_production_output_partition',
      'adjustments': 'ensure_adjustments_partition',
    };

    const funcName = funcNameMap[tableName];

    try {
      await prisma.$executeRawUnsafe(
        `SELECT ${funcName}($1::integer, $2::date)`,
        companyCode,
        transactionDate,
      );

      log.info('Backdated maintenance executed');
    } catch (err: any) {
      const pgCode = err?.meta?.code ?? err?.code;
      if (pgCode === '42883') { // function does not exist; skip quietly
        log.warn('Backdated maintenance function not found (skipped)', { funcName });
        return;
      }
      log.warn(
        'Backdated maintenance failed (non-blocking)',
        {
          errName: err?.name,
          errMessage: err?.message,
          errCode: err?.code,
          errMeta: err?.meta,
          errStack: err?.stack,
          clientVersion: err?.clientVersion,
        },
      );
    }
  }
}