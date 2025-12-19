import { RecalcStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { logger } from '@/lib/utils/logger';

export interface QueueRecalcParams {
  company_code: number;
  recalc_date: Date;
  reason: string;
  priority?: number;
  item_type?: string | null;
  item_code?: string | null;
}

function toDateOnlyUTC(d: Date): Date {
  const dt = new Date(d);
  // force to yyyy-mm-dd UTC
  dt.setUTCHours(0, 0, 0, 0);
  return dt;
}

export class SnapshotRecalcRepository {
  /**
   * Queue a snapshot recalculation (idempotent, no createMany)
   */
  async queueRecalculation(params: QueueRecalcParams): Promise<bigint> {
    const recalcDate = toDateOnlyUTC(params.recalc_date);

    try {
      // 1) Check if already exists (any status)
      const existing = await prisma.snapshot_recalc_queue.findFirst({
        where: {
          company_code: params.company_code,
          recalc_date: recalcDate,
          item_type: params.item_type ?? null,
          item_code: params.item_code ?? null,
        },
        select: { id: true },
      });

      if (existing?.id) {
        logger.info(
          'Snapshot recalculation already queued',
          {
            queueId: existing.id.toString(),
            companyCode: params.company_code,
            recalcDate,
          }
        );
        return existing.id;
      }

      // 2) Create one row (not createMany)
      const created = await prisma.snapshot_recalc_queue.create({
        data: {
          company_code: params.company_code,
          recalc_date: recalcDate,
          status: RecalcStatus.PENDING,
          priority: params.priority ?? 0,
          reason: params.reason,
          item_type: params.item_type ?? null,
          item_code: params.item_code ?? null,
          // queued_at: default by DB
        },
        select: { id: true },
      });

      logger.info(
        'Snapshot recalculation queued',
        {
          queueId: created.id.toString(),
          companyCode: params.company_code,
          recalcDate,
        }
      );

      return created.id;
    } catch (error: any) {
      // 3) Race-safe retry: if unique violation occurs after check, fetch and return
      if (error?.code === 'P2002') {
        const fallback = await prisma.snapshot_recalc_queue.findFirst({
          where: {
            company_code: params.company_code,
            recalc_date: recalcDate,
            item_type: params.item_type ?? null,
            item_code: params.item_code ?? null,
          },
          select: { id: true },
        });
        if (fallback?.id) {
          logger.info(
            'Snapshot recalculation queued (race-safe fallback)',
            {
              queueId: fallback.id.toString(),
              companyCode: params.company_code,
              recalcDate,
            }
          );
          return fallback.id;
        }
      }

      logger.error(
        'Failed to queue snapshot recalculation',
        {
          errorName: error?.name,
          errorMessage: error?.message,
          errorCode: error?.code,
          errorMeta: error?.meta,
          errorStack: error?.stack,
          clientVersion: error?.clientVersion,
          params: {
            ...params,
            recalc_date: recalcDate,
          },
        }
      );
      throw error;
    }
  }

  /**
   * Run snapshot calculation immediately for a queued item (backdated path)
   */
  async processImmediately(queueId: bigint, company_code: number, recalc_date: Date): Promise<void> {
    const recalcDate = toDateOnlyUTC(recalc_date);

    // Mark IN_PROGRESS (best-effort)
    await prisma.snapshot_recalc_queue.update({
      where: { id: queueId },
      data: { status: RecalcStatus.IN_PROGRESS, started_at: new Date(), error_message: null },
    });

    try {
      // Ensure snapshot partition exists for the date
      await prisma.$executeRawUnsafe(
        'SELECT ensure_stock_daily_snapshot_partition($1::date)',
        recalcDate,
      );

      await prisma.$executeRawUnsafe(
        'SELECT calculate_stock_snapshot($1::int, $2::date)',
        company_code,
        recalcDate,
      );

      await prisma.snapshot_recalc_queue.update({
        where: { id: queueId },
        data: { status: RecalcStatus.COMPLETED, completed_at: new Date(), error_message: null },
      });

      logger.info(
        'Snapshot recalculation executed immediately',
        {
          queueId: queueId.toString(),
          companyCode: company_code,
          recalcDate,
        }
      );
    } catch (error: any) {
      const errorMessage = error?.message ?? 'Unknown error';
      const pgCode = error?.meta?.code ?? error?.code;
      
      await prisma.snapshot_recalc_queue.update({
        where: { id: queueId },
        data: { status: RecalcStatus.FAILED, completed_at: new Date(), error_message: errorMessage },
      });

      // Use warn level for expected failures (permission errors, function not found, etc)
      // Background worker will retry with proper permissions
      logger.warn(
        'Immediate snapshot recalculation failed (background worker will retry)',
        {
          queueId: queueId.toString(),
          companyCode: company_code,
          recalcDate,
          errorName: error?.name,
          errorMessage: error?.message,
          errorCode: pgCode,
          reason: pgCode === '42501' 
            ? 'Permission denied - check database user privileges'
            : pgCode === '42883'
            ? 'Function not found - maintenance function may not exist'
            : 'Unknown error',
        }
      );

      // Don't re-throw: let background worker retry
    }
  }

  /**
   * Check if recalc already queued for this date
   */
  async isAlreadyQueued(company_code: number, recalc_date: Date): Promise<boolean> {
    const dateOnly = toDateOnlyUTC(recalc_date);
    const existing = await prisma.snapshot_recalc_queue.findFirst({
      where: {
        company_code,
        recalc_date: dateOnly,
        status: { in: [RecalcStatus.PENDING, RecalcStatus.IN_PROGRESS] },
      },
      select: { id: true },
    });
    return existing !== null;
  }

  async getPendingQueue(limit: number = 10) {
    return await prisma.snapshot_recalc_queue.findMany({
      where: { status: RecalcStatus.PENDING },
      orderBy: [{ priority: 'desc' }, { queued_at: 'asc' }],
      take: limit,
    });
  }

  async markAsInProgress(id: bigint): Promise<void> {
    await prisma.snapshot_recalc_queue.update({
      where: { id },
      data: { status: RecalcStatus.IN_PROGRESS, started_at: new Date() },
    });
  }

  async markAsCompleted(id: bigint): Promise<void> {
    await prisma.snapshot_recalc_queue.update({
      where: { id },
      data: { status: RecalcStatus.COMPLETED, completed_at: new Date(), error_message: null },
    });
  }

  async markAsFailed(id: bigint, errorMessage: string): Promise<void> {
    await prisma.snapshot_recalc_queue.update({
      where: { id },
      data: { status: RecalcStatus.FAILED, completed_at: new Date(), error_message: errorMessage },
    });
  }
}