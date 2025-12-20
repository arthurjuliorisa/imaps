/**
 * Cron Initializer Component
 * Client component that initializes cron service on app load
 * Runs safely as useEffect in browser without blocking page render
 */

'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/utils/logger';

export function CronInitializer() {
  useEffect(() => {
    // Initialize cron service when component mounts
    const initializeCron = async () => {
      try {
        logger.debug('🔄 Initializing cron service from client...');
        
        // Call API endpoint to initialize cron service
        const response = await fetch('/api/admin/cron', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          logger.info('✅ Cron service initialized successfully', {
            message: data.message,
            timestamp: data.timestamp,
          });
        } else {
          logger.warn('Cron service initialization returned non-ok status', {
            status: response.status,
            statusText: response.statusText,
          });
        }
      } catch (error) {
        // Log but don't throw - cron initialization is not critical for app functionality
        logger.warn('Failed to initialize cron service from client', {
          errorMessage: error instanceof Error ? error.message : String(error),
          note: 'This may be expected if user is not authenticated or not admin',
        });
      }
    };

    // Initialize cron after a short delay to ensure app is ready
    const timeoutId = setTimeout(initializeCron, 1000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  // This component renders nothing - it's only for side effects
  return null;
}
