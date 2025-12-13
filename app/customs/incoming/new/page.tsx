'use client';

import React from 'react';
import { Box, Container, Paper, Typography, Breadcrumbs, Link, alpha, useTheme } from '@mui/material';
import { NavigateNext, Home, Receipt } from '@mui/icons-material';
import { IncomingTransactionForm } from '@/app/components/customs/forms/IncomingTransactionForm';

export default function NewIncomingDocumentPage() {
  const theme = useTheme();

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Breadcrumbs */}
      <Breadcrumbs
        separator={<NavigateNext fontSize="small" />}
        aria-label="breadcrumb"
        sx={{ mb: 3 }}
      >
        <Link
          underline="hover"
          sx={{
            display: 'flex',
            alignItems: 'center',
            color: 'text.primary',
            '&:hover': { color: 'primary.main' },
          }}
          href="/dashboard"
        >
          <Home sx={{ mr: 0.5 }} fontSize="small" />
          Dashboard
        </Link>
        <Link
          underline="hover"
          sx={{
            display: 'flex',
            alignItems: 'center',
            color: 'text.primary',
            '&:hover': { color: 'primary.main' },
          }}
          href="/customs/incoming"
        >
          <Receipt sx={{ mr: 0.5 }} fontSize="small" />
          Incoming Documents
        </Link>
        <Typography
          sx={{ display: 'flex', alignItems: 'center' }}
          color="text.primary"
          fontWeight={600}
        >
          New Document
        </Typography>
      </Breadcrumbs>

      {/* Page Header */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mb: 3,
          borderRadius: 2,
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Typography variant="h4" fontWeight={700} color="primary" gutterBottom>
          New Incoming Transaction
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Create a new incoming customs transaction (BC23, BC27, BC40) with document header and item details.
        </Typography>
      </Paper>

      {/* Form */}
      <IncomingTransactionForm />
    </Container>
  );
}
