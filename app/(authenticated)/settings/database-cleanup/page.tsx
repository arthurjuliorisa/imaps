'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Alert,
  Stack,
  Card,
  CardContent,
  Divider,
  useTheme,
  alpha,
} from '@mui/material';
import { Warning } from '@mui/icons-material';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CleanupModeSelector } from './components/CleanupModeSelector';
import { FullResetMode } from './components/FullResetMode';
import { SelectiveMode } from './components/SelectiveMode';

type CleanupMode = 'selector' | 'full' | 'selective';

export default function DatabaseCleanupPage() {
  const theme = useTheme();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<CleanupMode>('selector');
  const [isProduction, setIsProduction] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check auth and environment
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }

    if (status === 'authenticated') {
      checkEnvironment();
    }
  }, [status, router]);

  const checkEnvironment = async () => {
    try {
      const response = await fetch('/api/admin/cleanup');
      if (!response.ok) throw new Error('Unauthorized');

      const data = await response.json();
      setIsProduction(data.phase === 'production');
    } catch (error) {
      console.error('Failed to check environment:', error);
      setIsProduction(true); // Default to production (safest)
    } finally {
      setIsLoading(false);
    }
  };

  if (status === 'loading' || isLoading) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ py: 4 }}>
          <Typography>Loading...</Typography>
        </Box>
      </Container>
    );
  }

  if (!session?.user) {
    return null;
  }

  return (
    <Container maxWidth="lg">
      <Stack spacing={3} sx={{ py: 3 }}>
        {/* Header */}
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
            Database Cleanup
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Manage and execute database cleanup operations
          </Typography>
        </Box>

        {/* Production Warning */}
        {isProduction && (
          <Alert
            severity="error"
            icon={<Warning />}
            sx={{
              backgroundColor: alpha(theme.palette.error.main, 0.1),
              borderLeft: `4px solid ${theme.palette.error.main}`,
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Production Environment
            </Typography>
            <Typography variant="body2">
              Database cleanup is disabled in the production environment for safety reasons.
              This feature is only available in development and staging environments.
            </Typography>
          </Alert>
        )}

        {!isProduction && (
          <>
            {/* Environment Info Card */}
            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      ⚠️ Important Notice
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      This feature is designed for development and staging environments only.
                      All cleanup operations are logged and require admin authentication with
                      password confirmation.
                    </Typography>
                  </Box>
                  <Divider />
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      Features:
                    </Typography>
                    <Typography variant="body2" color="textSecondary" component="ul" sx={{ ml: 2 }}>
                      <li>Full Reset: Delete all data from 25 cleanup tables at once</li>
                      <li>
                        Selective Cleanup: Choose specific tables with dependency validation
                      </li>
                      <li>Automatic backup creation before cleanup</li>
                      <li>Real-time progress tracking</li>
                      <li>Comprehensive audit logging</li>
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            {/* Mode Selection */}
            {mode === 'selector' && (
              <CleanupModeSelector
                onSelectFullReset={() => setMode('full')}
                onSelectSelective={() => setMode('selective')}
              />
            )}

            {/* Full Reset Mode */}
            {mode === 'full' && (
              <FullResetMode
                onBack={() => setMode('selector')}
              />
            )}

            {/* Selective Mode */}
            {mode === 'selective' && (
              <SelectiveMode
                onBack={() => setMode('selector')}
              />
            )}
          </>
        )}
      </Stack>
    </Container>
  );
}
