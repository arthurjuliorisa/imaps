/**
 * Cron Service Initialization Middleware
 * Automatically initializes cron service on app startup
 * Uses a singleton pattern to ensure it runs only once
 */

import { initializeCronService } from '@/lib/services/cron.service';
import { logger } from '@/lib/utils/logger';

let cronInitialized = false;
let cronInitializationPromise: Promise<void> | null = null;

/**
 * Initialize cron service (thread-safe)
 * Ensures initialization runs only once even if called multiple times
 */
export async function initCronMiddleware(): Promise<void> {
  // If already initialized, return immediately
  if (cronInitialized) {
    return;
  }

  // If initialization is in progress, wait for it
  if (cronInitializationPromise) {
    return cronInitializationPromise;
  }

  // Start initialization
  cronInitializationPromise = (async () => {
    try {
      logger.info('🚀 Starting cron middleware initialization...');
      await initializeCronService();
      cronInitialized = true;
      logger.info('✅ Cron middleware initialization completed');
    } catch (error) {
      logger.error('❌ Cron middleware initialization failed', {
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - allow app to continue even if cron fails
      // This prevents app startup from failing due to cron issues
    } finally {
      cronInitializationPromise = null;
    }
  })();

  return cronInitializationPromise;
}

/**
 * Check if cron is initialized
 */
export function isCronInitialized(): boolean {
  return cronInitialized;
}
