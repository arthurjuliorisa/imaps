import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export interface QueueRecalcParams {
  company_code: number;
  recalc_date: Date;
  reason: string;
  priority?: number;
  item_type?: string | null;
  item_code?: string | null;
}

export class SnapshotRecalcRepository {
  /**
   * Queue a snapshot recalculation
   */
  async queueRecalculation(params: QueueRecalcParams): Promise<bigint> {
    try {
      const queue = await prisma.snapshot_recalc_queue.create({
        data: {
          company_code: params.company_code,
          recalc_date: params.recalc_date,
          status: 'PENDING',
          priority: params.priority || 0,
          reason: params.reason,
          item_type: params.item_type || null,
          item_code: params.item_code || null,
          queued_at: new Date(),
        },
      });

      logger.info(
        {
          queueId: queue.id.toString(),
          companyCode: params.company_code,
          recalcDate: params.recalc_date,
          priority: params.priority,
        },
        'Snapshot recalculation queued'
      );

      return queue.id;
    } catch (error) {
      logger.error({ error, params }, 'Failed to queue snapshot recalculation');
      throw error;
    }
  }

  /**
   * Check if recalc already queued for this date
   */
  async isAlreadyQueued(company_code: number, recalc_date: Date): Promise<boolean> {
    const existing = await prisma.snapshot_recalc_queue.findFirst({
      where: {
        company_code,
        recalc_date,
        status: {
          in: ['PENDING', 'IN_PROGRESS'],
        },
      },
    });

    return existing !== null;
  }

  /**
   * Get pending queue items
   */
  async getPendingQueue(limit: number = 10) {
    return await prisma.snapshot_recalc_queue.findMany({
      where: {
        status: 'PENDING',
      },
      orderBy: [
        { priority: 'desc' },
        { queued_at: 'asc' },
      ],
      take: limit,
    });
  }

  /**
   * Mark queue item as in progress
   */
  async markAsInProgress(id: bigint): Promise<void> {
    await prisma.snapshot_recalc_queue.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        started_at: new Date(),
      },
    });
  }

  /**
   * Mark queue item as completed
   */
  async markAsCompleted(id: bigint): Promise<void> {
    await prisma.snapshot_recalc_queue.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completed_at: new Date(),
        error_message: null,
      },
    });
  }

  /**
   * Mark queue item as failed
   */
  async markAsFailed(id: bigint, errorMessage: string): Promise<void> {
    await prisma.snapshot_recalc_queue.update({
      where: { id },
      data: {
        status: 'FAILED',
        completed_at: new Date(),
        error_message: errorMessage,
      },
    });
  }
}