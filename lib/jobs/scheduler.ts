/**
 * Job Scheduler
 * Manages all cron jobs for background processing
 *
 * Schedules:
 * - Hourly Batch: Every hour at minute 5 (01:05, 02:05, etc.)
 * - EOD Snapshot: Daily at 23:55
 * - Materialized Views: Daily at 00:30 (after EOD snapshot)
 * - Recalc Queue: Every 5 minutes
 */

import cron, { ScheduledTask } from 'node-cron';
import { processHourlyBatch } from './hourly-batch-processor';
import { calculateEODSnapshot } from './eod-snapshot-calculator';
import { processRecalcQueue } from './recalc-queue-worker';
import { refreshMaterializedViews } from './materialized-views-refresher';

interface SchedulerConfig {
  enableHourlyBatch: boolean;
  enableEODSnapshot: boolean;
  enableRecalcQueue: boolean;
  enableMaterializedViewsRefresh: boolean;
}

class JobScheduler {
  private hourlyBatchTask?: ScheduledTask;
  private eodSnapshotTask?: ScheduledTask;
  private recalcQueueTask?: ScheduledTask;
  private materializedViewsTask?: ScheduledTask;
  private isInitialized = false;

  /**
   * Initialize and start all scheduled jobs
   */
  public start(config?: Partial<SchedulerConfig>): void {
    if (this.isInitialized) {
      console.warn('[Scheduler] Scheduler is already initialized');
      return;
    }

    const defaultConfig: SchedulerConfig = {
      enableHourlyBatch: true,
      enableEODSnapshot: true,
      enableRecalcQueue: true,
      enableMaterializedViewsRefresh: true,
      ...config,
    };

    console.log('[Scheduler] Initializing job scheduler with config:', defaultConfig);

    // Hourly Batch Processor - runs every hour at minute 5
    if (defaultConfig.enableHourlyBatch) {
      this.hourlyBatchTask = cron.schedule(
        '5 * * * *', // At minute 5 past every hour
        async () => {
          console.log('[Scheduler] Starting hourly batch job...');
          try {
            const result = await processHourlyBatch('SCHEDULER');
            if (result.success) {
              console.log(
                `[Scheduler] Hourly batch completed: ${result.processedRecords} processed, ${result.failedRecords} failed`
              );
            } else {
              console.error(`[Scheduler] Hourly batch failed: ${result.errorMessage}`);
            }
          } catch (error) {
            console.error('[Scheduler] Hourly batch error:', error);
          }
        },
        {
          timezone: 'Asia/Jakarta', // Adjust to your timezone
        }
      );
      console.log('[Scheduler] Hourly batch job scheduled (every hour at minute 5)');
    }

    // EOD Snapshot Calculator - runs daily at 23:55
    if (defaultConfig.enableEODSnapshot) {
      this.eodSnapshotTask = cron.schedule(
        '55 23 * * *', // At 23:55 every day
        async () => {
          console.log('[Scheduler] Starting EOD snapshot job...');
          try {
            const result = await calculateEODSnapshot('SCHEDULER');
            if (result.success) {
              console.log(
                `[Scheduler] EOD snapshot completed: ${result.processedRecords} processed, ${result.failedRecords} failed`
              );
            } else {
              console.error(`[Scheduler] EOD snapshot failed: ${result.errorMessage}`);
            }
          } catch (error) {
            console.error('[Scheduler] EOD snapshot error:', error);
          }
        },
        {
          timezone: 'Asia/Jakarta', // Adjust to your timezone
        }
      );
      console.log('[Scheduler] EOD snapshot job scheduled (daily at 23:55)');
    }

    // Recalculation Queue Worker - runs every 5 minutes
    if (defaultConfig.enableRecalcQueue) {
      this.recalcQueueTask = cron.schedule(
        '*/5 * * * *', // Every 5 minutes
        async () => {
          console.log('[Scheduler] Starting recalc queue job...');
          try {
            const result = await processRecalcQueue('SCHEDULER');
            if (result.success) {
              console.log(
                `[Scheduler] Recalc queue completed: ${result.processedRecords} processed, ${result.failedRecords} failed`
              );
            } else {
              console.error(`[Scheduler] Recalc queue failed: ${result.errorMessage}`);
            }
          } catch (error) {
            console.error('[Scheduler] Recalc queue error:', error);
          }
        },
        {
          timezone: 'Asia/Jakarta', // Adjust to your timezone
        }
      );
      console.log('[Scheduler] Recalc queue job scheduled (every 5 minutes)');
    }

    // Materialized Views Refresher - runs daily at 00:30 (after EOD snapshot)
    if (defaultConfig.enableMaterializedViewsRefresh) {
      this.materializedViewsTask = cron.schedule(
        '30 0 * * *', // At 00:30 every day
        async () => {
          console.log('[Scheduler] Starting materialized views refresh job...');
          try {
            const result = await refreshMaterializedViews('SCHEDULER');
            if (result.success) {
              console.log(
                `[Scheduler] Materialized views refresh completed: ${result.processedRecords} views refreshed, ${result.failedRecords} failed`
              );
            } else {
              console.error(`[Scheduler] Materialized views refresh failed: ${result.errorMessage}`);
            }
          } catch (error) {
            console.error('[Scheduler] Materialized views refresh error:', error);
          }
        },
        {
          timezone: 'Asia/Jakarta', // Adjust to your timezone
        }
      );
      console.log('[Scheduler] Materialized views refresh job scheduled (daily at 00:30)');
    }

    this.isInitialized = true;
    console.log('[Scheduler] All jobs scheduled successfully');
  }

  /**
   * Stop all scheduled jobs
   */
  public stop(): void {
    console.log('[Scheduler] Stopping all scheduled jobs...');

    if (this.hourlyBatchTask) {
      this.hourlyBatchTask.stop();
      console.log('[Scheduler] Hourly batch job stopped');
    }

    if (this.eodSnapshotTask) {
      this.eodSnapshotTask.stop();
      console.log('[Scheduler] EOD snapshot job stopped');
    }

    if (this.recalcQueueTask) {
      this.recalcQueueTask.stop();
      console.log('[Scheduler] Recalc queue job stopped');
    }

    if (this.materializedViewsTask) {
      this.materializedViewsTask.stop();
      console.log('[Scheduler] Materialized views refresh job stopped');
    }

    this.isInitialized = false;
    console.log('[Scheduler] All jobs stopped');
  }

  /**
   * Get status of all scheduled jobs
   */
  public getStatus(): {
    isInitialized: boolean;
    jobs: {
      hourlyBatch: boolean;
      eodSnapshot: boolean;
      recalcQueue: boolean;
      materializedViews: boolean;
    };
  } {
    return {
      isInitialized: this.isInitialized,
      jobs: {
        hourlyBatch: !!this.hourlyBatchTask,
        eodSnapshot: !!this.eodSnapshotTask,
        recalcQueue: !!this.recalcQueueTask,
        materializedViews: !!this.materializedViewsTask,
      },
    };
  }

  /**
   * Manually trigger a specific job
   */
  public async triggerJob(
    jobType: 'hourly-batch' | 'eod-snapshot' | 'recalc-queue' | 'materialized-views',
    triggeredBy: string
  ): Promise<{
    success: boolean;
    processedRecords: number;
    failedRecords: number;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  }> {
    console.log(`[Scheduler] Manually triggering ${jobType} job by ${triggeredBy}`);

    try {
      switch (jobType) {
        case 'hourly-batch':
          return await processHourlyBatch(triggeredBy);

        case 'eod-snapshot':
          return await calculateEODSnapshot(triggeredBy);

        case 'recalc-queue':
          return await processRecalcQueue(triggeredBy);

        case 'materialized-views':
          return await refreshMaterializedViews(triggeredBy);

        default:
          throw new Error(`Unknown job type: ${jobType}`);
      }
    } catch (error) {
      console.error(`[Scheduler] Error triggering ${jobType}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        processedRecords: 0,
        failedRecords: 0,
        errorMessage,
      };
    }
  }
}

// Export singleton instance
export const scheduler = new JobScheduler();

// Auto-start scheduler in production
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_JOBS !== 'false') {
  console.log('[Scheduler] Auto-starting scheduler in production mode');
  scheduler.start();
}

// Graceful shutdown
if (typeof process !== 'undefined') {
  process.on('SIGTERM', () => {
    console.log('[Scheduler] SIGTERM received, stopping scheduler...');
    scheduler.stop();
  });

  process.on('SIGINT', () => {
    console.log('[Scheduler] SIGINT received, stopping scheduler...');
    scheduler.stop();
  });
}
