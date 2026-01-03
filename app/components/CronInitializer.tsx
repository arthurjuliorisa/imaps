/**
 * Cron Initializer Component
 * Client component that initializes cron service on app load
 * Only attempts initialization if user is authenticated
 * Server-side initialization handles cases where user is not logged in
 */

'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { logger } from '@/lib/utils/logger';

export function CronInitializer() {
  const { data: session, status } = useSession();

  useEffect(() => {
    // Only attempt initialization if user is authenticated
    if (status !== 'authenticated' || !session) {
      return;
    }

    // Initialize cron service when user is logged in
    const initializeCron = async () => {
      try {
        logger.debug('🔄 Initializing cron service from authenticated session...');
        
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
        });
      }
    };

    // Initialize cron after a short delay to ensure app is ready
    const timeoutId = setTimeout(initializeCron, 1000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [session, status]);

  // This component renders nothing - it's only for side effects
  return null;
}
