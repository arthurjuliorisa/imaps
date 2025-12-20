/**
 * Cron Service
 * Handles scheduled tasks for snapshot recalculation queue processing
 * and end-of-day snapshot calculations
 * 
 * Tasks:
 * 1. Every 15 minutes: Process pending recalculation queue items
 * 2. Every day at end-of-day time: Calculate daily stock snapshots for all companies
 * 
 * Timezone Configuration:
 * - Uses server/application timezone
 * - Can be configured via APP_TIMEZONE environment variable
 * - Default: system timezone
 */

import cron, { type ScheduledTask, type TaskOptions } from 'node-cron';
import { prisma } from '@/lib/db/prisma';
import { logger } from '@/lib/utils/logger';

interface CronJob {
  name: string;
  schedule: string;
  task: () => Promise<void>;
}

interface TimezoneConfig {
  name: string;
  offset: number; // Offset from UTC in hours
}

class CronService {
  private jobs: Map<string, ScheduledTask> = new Map();
  private isInitialized = false;
  private timezone: TimezoneConfig;
  private endOfDayHour: number = 0; // Default 00:00 (midnight)
  private endOfDayMinute: number = 5; // 5 minutes after midnight

  constructor() {
    this.timezone = this.getTimezoneConfig();
  }

  /**
   * Get timezone configuration from environment or system
   * Supports: APP_TIMEZONE environment variable or system timezone
   */
  private getTimezoneConfig(): TimezoneConfig {
    // Try to get timezone from environment variable
    const envTimezone = process.env.APP_TIMEZONE?.toUpperCase();

    // Common timezone configurations
    const timezoneMap: Record<string, TimezoneConfig> = {
      'UTC': { name: 'UTC', offset: 0 },
      'GMT': { name: 'GMT', offset: 0 },
      'WIB': { name: 'Western Indonesia Time (UTC+7)', offset: 7 }, // Jakarta
      'UTC+7': { name: 'UTC+7', offset: 7 },
      'UTC-5': { name: 'UTC-5 (EST)', offset: -5 },
      'UTC-8': { name: 'UTC-8 (PST)', offset: -8 },
      'PST': { name: 'PST', offset: -8 },
      'EST': { name: 'EST', offset: -5 },
      'IST': { name: 'IST (UTC+5:30)', offset: 5.5 },
      'SGT': { name: 'Singapore Time (UTC+8)', offset: 8 },
      'HKT': { name: 'Hong Kong Time (UTC+8)', offset: 8 },
      'JST': { name: 'Japan Standard Time (UTC+9)', offset: 9 },
    };

    // If APP_TIMEZONE is set, use it
    if (envTimezone && timezoneMap[envTimezone]) {
      logger.info('🕐 Using APP_TIMEZONE from environment', {
        timezone: timezoneMap[envTimezone].name,
      });
      return timezoneMap[envTimezone];
    }

    // Get system timezone offset
    const systemOffset = -new Date().getTimezoneOffset() / 60;
    const timezone: TimezoneConfig = {
      name: `System Timezone (UTC${systemOffset >= 0 ? '+' : ''}${systemOffset})`,
      offset: systemOffset,
    };

    logger.info('🕐 Using system timezone', {
      timezone: timezone.name,
      offset: timezone.offset,
    });

    return timezone;
  }

  /**
   * Get current date in application timezone
   */
  private getCurrentDateInTimezone(): Date {
    const now = new Date();
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const tzTime = new Date(utcTime + this.timezone.offset * 3600000);
    // Set to date only (00:00:00)
    tzTime.setUTCHours(0, 0, 0, 0);
    return tzTime;
  }

  /**
   * Get cron schedule for end-of-day based on timezone
   */
  private getEndOfDaySchedule(): string {
    // Format: minute hour day month weekday
    // Using UTC-adjusted time for cron schedule
    const offsetMinutes = Math.round(this.timezone.offset * 60);
    const offsetHours = Math.floor(offsetMinutes / 60);
    const offsetMins = offsetMinutes % 60;

    // Calculate UTC time for end-of-day (00:05 in app timezone)
    let utcHour = (this.endOfDayHour - offsetHours + 24) % 24;
    let utcMinute = (this.endOfDayMinute - offsetMins + 60) % 60;
    if (utcMinute < 0) {
      utcHour = (utcHour - 1 + 24) % 24;
      utcMinute += 60;
    }

    const schedule = `${utcMinute} ${utcHour} * * *`;
    logger.info('📅 End-of-day schedule calculated', {
      appTimezone: this.timezone.name,
      endOfDayTime: `${this.endOfDayHour.toString().padStart(2, '0')}:${this.endOfDayMinute.toString().padStart(2, '0')}`,
      utcEquivalent: `${utcHour.toString().padStart(2, '0')}:${utcMinute.toString().padStart(2, '0')} UTC`,
      cronExpression: schedule,
    });

    return schedule;
  }

  /**
   * Initialize all cron jobs
   * Safe to call multiple times (checks isInitialized flag)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('CronService already initialized');
      return;
    }

    try {
      logger.info('🔄 Initializing CronService...', {
        timezone: this.timezone.name,
      });

      // Register all cron jobs
      const cronJobs: CronJob[] = [
        {
          name: 'process-recalc-queue',
          schedule: '*/15 * * * *', // Every 15 minutes (timezone-agnostic)
          task: this.processRecalcQueue.bind(this),
        },
        {
          name: 'calculate-daily-snapshots',
          schedule: this.getEndOfDaySchedule(), // Daily at end-of-day (timezone-aware)
          task: this.calculateDailySnapshots.bind(this),
        },
      ];

      // Schedule each job
      for (const job of cronJobs) {
        this.scheduleJob(job);
      }

      this.isInitialized = true;
      logger.info('✅ CronService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize CronService', {
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Schedule a cron job
   */
  private scheduleJob(job: CronJob): void {
    try {
      const task = cron.schedule(job.schedule, () => this.executeJob(job));

      this.jobs.set(job.name, task);
      
      logger.info(`📅 Cron job scheduled: ${job.name} (${job.schedule})`);
    } catch (error) {
      logger.error(`Failed to schedule cron job: ${job.name}`, {
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute a cron job with error handling
   */
  private async executeJob(job: CronJob): Promise<void> {
    const startTime = Date.now();
    try {
      logger.info(`⏱️ Executing cron job: ${job.name}`);
      await job.task();
      const duration = Date.now() - startTime;
      logger.info(`✅ Cron job completed: ${job.name}`, { durationMs: duration });
    } catch (error) {
      logger.error(`❌ Cron job failed: ${job.name}`, {
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Process pending recalculation queue items (Every 15 minutes)
   */
  private async processRecalcQueue(): Promise<void> {
    try {
      // Get list of active companies for batch processing
      const companies = await prisma.companies.findMany({
        select: { code: true },
      });

      if (companies.length === 0) {
        logger.debug('No companies found, skipping queue processing');
        return;
      }

      // Process queue for each company
      let totalProcessed = 0;
      for (const company of companies) {
        try {
          const result = await prisma.$executeRawUnsafe(
            'SELECT process_recalc_queue($1::int)',
            10 // Batch size: process max 10 items per company
          );

          // Note: result is typically the number of rows processed
          totalProcessed += typeof result === 'number' ? result : 0;

          logger.debug('Processed recalc queue', {
            companyCode: company.code,
          });
        } catch (error) {
          logger.warn('Failed to process queue for company', {
            companyCode: company.code,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('Recalc queue processing completed', {
        companiesProcessed: companies.length,
        totalItemsProcessed: totalProcessed,
      });
    } catch (error) {
      logger.error('Error in processRecalcQueue', {
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Calculate daily stock snapshots for all companies (Every day at end-of-day)
   */
  private async calculateDailySnapshots(): Promise<void> {
    try {
      const today = this.getCurrentDateInTimezone();

      // Get list of active companies
      const companies = await prisma.companies.findMany({
        select: { code: true },
      });

      if (companies.length === 0) {
        logger.debug('No companies found, skipping snapshot calculation');
        return;
      }

      logger.info('Starting daily snapshot calculation', {
        snapshotDate: today.toISOString().split('T')[0],
        companiesCount: companies.length,
        timezone: this.timezone.name,
      });

      // Calculate snapshot for each company
      for (const company of companies) {
        try {
          await prisma.$executeRawUnsafe(
            'SELECT calculate_stock_snapshot($1::int, $2::date)',
            company.code,
            today
          );

          logger.debug('Calculated snapshot for company', {
            companyCode: company.code,
            date: today.toISOString().split('T')[0],
          });
        } catch (error) {
          logger.warn('Failed to calculate snapshot for company', {
            companyCode: company.code,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('Daily snapshot calculation completed', {
        companiesProcessed: companies.length,
        snapshotDate: today.toISOString().split('T')[0],
      });
    } catch (error) {
      logger.error('Error in calculateDailySnapshots', {
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop all cron jobs (graceful shutdown)
   */
  async stop(): Promise<void> {
    logger.info('🛑 Stopping CronService...');
    for (const [jobName, task] of this.jobs) {
      try {
        task.stop();
        task.destroy();
        logger.info(`Stopped cron job: ${jobName}`);
      } catch (error) {
        logger.error(`Failed to stop cron job: ${jobName}`, {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.jobs.clear();
    this.isInitialized = false;
    logger.info('✅ CronService stopped');
  }

  /**
   * Get status of all cron jobs
   */
  getStatus(): Record<string, string> {
    const status: Record<string, string> = {};
    for (const [jobName] of this.jobs) {
      status[jobName] = 'scheduled';
    }
    return status;
  }
}

// Singleton instance
let cronServiceInstance: CronService | null = null;

/**
 * Get or create CronService singleton
 */
export function getCronService(): CronService {
  if (!cronServiceInstance) {
    cronServiceInstance = new CronService();
  }
  return cronServiceInstance;
}

/**
 * Initialize cron service (safe idempotent call)
 */
export async function initializeCronService(): Promise<void> {
  const service = getCronService();
  await service.initialize();
}

/**
 * Stop cron service (for graceful shutdown)
 */
export async function stopCronService(): Promise<void> {
  if (cronServiceInstance) {
    await cronServiceInstance.stop();
  }
}
