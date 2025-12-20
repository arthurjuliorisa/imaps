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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Button,
  Stack
} from '@mui/material';
import { NavigateNext, Home, Inventory, ArrowBack } from '@mui/icons-material';
import { formatDate } from '@/lib/exportUtils';
import type { ProductionOutputHeader, ProductionOutputDetail } from '@/types/core';

interface ProductionTransactionDetail {
  header: ProductionOutputHeader;
  details: ProductionOutputDetail[];
}

export default function ProductionDetailPage() {
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const params = useParams();
  const wms_id = params.wms_id as string;

  const [data, setData] = useState<ProductionTransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch(`/api/wms/production/${wms_id}`);
        if (!response.ok) {
          throw new Error('Failed to fetch transaction');
        }
        const result = await response.json();
        setData(result.data);
      } catch (error) {
        console.error('Error fetching transaction:', error);
        toast.error('Failed to load transaction details');
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
          Transaction not found
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
          onClick={() => router.push('/customs/production')}
        >
          <Inventory sx={{ mr: 0.5 }} fontSize="small" />
          Production Output
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
              Production Output Detail
            </Typography>
            <Typography variant="body1" color="text.secondary">
              View complete information for production output transaction
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<ArrowBack />}
            onClick={() => router.push('/customs/production')}
          >
            Back to List
          </Button>
        </Stack>
      </Paper>

      {/* Document Header Information */}
      <Paper elevation={0} sx={{ p: 3, mb: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          Document Header
        </Typography>
        <Divider sx={{ my: 2 }} />

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                WMS ID
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {data.header.wms_id}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Company Code
              </Typography>
              <Typography variant="body1">
                {data.header.company_code}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Internal Evidence Number
              </Typography>
              <Typography variant="body1">
                {data.header.internal_evidence_number}
              </Typography>
            </Box>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Transaction Date
              </Typography>
              <Typography variant="body1">
                {formatDate(data.header.transaction_date)}
              </Typography>
            </Box>
            {data.header.reversal && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Reversal
                </Typography>
                <Box sx={{ mt: 0.5 }}>
                  <Chip label={data.header.reversal} color="warning" size="small" />
                </Box>
              </Box>
            )}
          </Grid>
        </Grid>
      </Paper>

      {/* Item Details */}
      <Paper elevation={0} sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          Item Details ({data.details.length} items)
        </Typography>
        <Divider sx={{ my: 2 }} />

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>UOM</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Qty</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Work Order Numbers</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.details.map((detail, index) => (
                <TableRow key={detail.id} hover>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {detail.item_code}
                    </Typography>
                  </TableCell>
                  <TableCell>{detail.item_name}</TableCell>
                  <TableCell>
                    <Chip label={detail.item_type} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>{detail.uom}</TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={600}>
                      {detail.qty.toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {detail.work_order_numbers.length > 0 ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {detail.work_order_numbers.map((wo, idx) => (
                          <Chip key={idx} label={wo} size="small" variant="outlined" />
                        ))}
                      </Box>
                    ) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Summary */}
        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
          <Box sx={{ minWidth: 300 }}>
            <Divider sx={{ mb: 2 }} />
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Total Items:
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {data.details.length}
              </Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">
                Total Quantity:
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {data.details.reduce((sum, d) => sum + d.qty, 0).toLocaleString()}
              </Typography>
            </Stack>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}
