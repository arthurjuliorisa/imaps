'use client';

import React from 'react';
import { Box, Typography, Paper, alpha, useTheme, Divider } from '@mui/material';
import { Description as DescriptionIcon } from '@mui/icons-material';

interface ReportLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function ReportLayout({ title, subtitle, children, actions }: ReportLayoutProps) {
  const theme = useTheme();

  return (
    <Box>
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mb: 3,
          background: theme.palette.mode === 'light'
            ? 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)'
            : 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
          color: 'white',
          borderRadius: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              bgcolor: 'rgba(255, 255, 255, 0.15)',
              backdropFilter: 'blur(10px)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <DescriptionIcon sx={{ fontSize: 32 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h4" fontWeight="bold" gutterBottom>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body1" sx={{ opacity: 0.9 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
        </Box>
      </Paper>

      {actions && (
        <Box sx={{ mb: 3 }}>
          <Paper
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.background.paper, 0.8),
              border: `1px solid ${theme.palette.divider}`,
            }}
          >
            {actions}
          </Paper>
        </Box>
      )}

      <Paper
        elevation={0}
        sx={{
          borderRadius: 2,
          overflow: 'hidden',
          border: `1px solid ${theme.palette.divider}`,
        }}
      >
        {children}
      </Paper>
    </Box>
  );
}
