import { SnapshotRecalcRepository } from './snapshot-recalc.repository';
import { isBackdated } from '../utils/date.util';
import { logger } from '../utils/logger';

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
    transaction_type: string
  ): Promise<void> {
    try {
      // Check if backdated
      if (!isBackdated(transaction_date)) {
        logger.debug(
          {
            wmsId: wms_id,
            transactionDate: transaction_date,
            transactionType: transaction_type,
          },
          'Transaction is not backdated, no recalc needed'
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
          {
            wmsId: wms_id,
            companyCode: company_code,
            transactionDate: transaction_date,
          },
          'Recalculation already queued for this date'
        );
        return;
      }

      // Queue recalculation
      await this.snapshotRecalcRepo.queueRecalculation({
        company_code,
        recalc_date: transaction_date,
        reason: `Backdated ${transaction_type}: ${wms_id}`,
        priority: 0,
      });

      logger.info(
        {
          wmsId: wms_id,
          companyCode: company_code,
          transactionDate: transaction_date,
          transactionType: transaction_type,
        },
        'Backdated transaction detected, recalculation queued'
      );
    } catch (error) {
      // Log error but don't fail the transaction
      logger.error(
        {
          error,
          wmsId: wms_id,
          companyCode: company_code,
          transactionDate: transaction_date,
        },
        'Failed to queue snapshot recalculation'
      );
    }
  }
}