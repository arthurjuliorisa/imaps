'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '@/app/components/ToastProvider';
import {
  Box,
  Container,
  Paper,
  Typography,
  Breadcrumbs,
  Link,
  alpha,
  useTheme,
  Divider,
  Grid,
  Chip,
  CircularProgress,
  Button,
  Stack
} from '@mui/material';
import { NavigateNext, Home, Inventory, ArrowBack } from '@mui/icons-material';
import { formatDate } from '@/lib/exportUtils';
import type { WIPBalanceHeader } from '@/types/core';

export default function WIPBalanceDetailPage() {
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const params = useParams();
  const wms_id = params.wms_id as string;

  const [data, setData] = useState<WIPBalanceHeader | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch(`/api/wms/wip-balance/${wms_id}`);
        if (!response.ok) {
          throw new Error('Failed to fetch WIP balance');
        }
        const result = await response.json();
        setData(result.data);
      } catch (error) {
        console.error('Error fetching WIP balance:', error);
        toast.error('Failed to load WIP balance details');
      } finally {
        setLoading(false);
      }
    }

    if (wms_id) {
      fetchData();
    }
  }, [wms_id, toast]);

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (!data) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Typography variant="h6" color="text.secondary">
          WIP balance not found
        </Typography>
      </Container>
    );
  }

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
            cursor: 'pointer'
          }}
          onClick={() => router.push('/dashboard')}
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
            cursor: 'pointer'
          }}
          onClick={() => router.push('/customs/wip')}
        >
          <Inventory sx={{ mr: 0.5 }} fontSize="small" />
          WIP Balance
        </Link>
        <Typography
          sx={{ display: 'flex', alignItems: 'center' }}
          color="text.primary"
          fontWeight={600}
        >
          {wms_id}
        </Typography>
      </Breadcrumbs>

      {/* Header */}
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
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h4" fontWeight={700} color="primary" gutterBottom>
              WIP Balance Detail
            </Typography>
            <Typography variant="body1" color="text.secondary">
              View complete information for work-in-process inventory balance
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<ArrowBack />}
            onClick={() => router.push('/customs/wip')}
          >
            Back to List
          </Button>
        </Stack>
      </Paper>

      {/* WIP Balance Information */}
      <Paper elevation={0} sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          Balance Information
        </Typography>
        <Divider sx={{ my: 2 }} />

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                WMS ID
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {data.wms_id}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Company Code
              </Typography>
              <Typography variant="body1">
                {data.company_code}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Item Type
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                <Chip label={data.item_type} color="primary" size="small" />
              </Box>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Item Code
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {data.item_code}
              </Typography>
            </Box>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Item Name
              </Typography>
              <Typography variant="body1">
                {data.item_name}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Stock Date
              </Typography>
              <Typography variant="body1">
                {formatDate(data.stock_date)}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Quantity
              </Typography>
              <Typography variant="h5" fontWeight={700} color="primary">
                {data.qty.toLocaleString()} {data.uom}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Unit of Measure
              </Typography>
              <Typography variant="body1">
                {data.uom}
              </Typography>
            </Box>
          </Grid>
        </Grid>

        {/* Summary Card */}
        <Box sx={{ mt: 4 }}>
          <Divider sx={{ mb: 3 }} />
          <Paper
            elevation={0}
            sx={{
              p: 3,
              bgcolor: alpha(theme.palette.success.main, 0.08),
              border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
              borderRadius: 2
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="caption" color="text.secondary" gutterBottom>
                  Current WIP Balance
                </Typography>
                <Typography variant="h4" fontWeight={700} color="success.main">
                  {data.qty.toLocaleString()} {data.uom}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary" gutterBottom>
                  As of Date
                </Typography>
                <Typography variant="h6" fontWeight={600}>
                  {formatDate(data.stock_date)}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Box>
      </Paper>
    </Container>
  );
}
