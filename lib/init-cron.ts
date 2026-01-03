/**
 * Server-side Cron Initialization
 * Import this in a server component to ensure cron service starts
 */

import { initializeCronService } from '@/lib/services/cron.service';
import { logger } from '@/lib/utils/logger';

export async function initCronServiceOnStartup() {
  try {
    logger.info('🔄 Initializing cron service on application startup...');
    await initializeCronService();
    logger.info('✅ Cron service initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize cron service on startup', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    // Continue anyway - don't block app startup
  }
}
