'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  Stack,
  TextField,
  MenuItem,
} from '@mui/material';
import { NavigateNext, Home, Receipt, ArrowBack } from '@mui/icons-material';
import { formatDate } from '@/lib/exportUtils';

const formatQuantity = (value: number): string => {
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
};

interface OpnameHeader {
  id: string;
  documentNumber: string;
  date: Date;
  companyCode: number;
  companyName: string;
  status: string;
  description?: string;
}

interface OpnameDetail {
  id: string;
  itemType: string;
  itemCode: string;
  itemName: string;
  unit: string;
  systemQty: number;
  physicalQty: number;
  difference: number;
}

interface OpnameTransactionDetail {
  header: OpnameHeader;
  details: OpnameDetail[];
}

export default function OpnameDetailPage() {
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<OpnameTransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [itemTypeFilter, setItemTypeFilter] = useState<string>('');

  useEffect(() => {
    async function fetchData() {
      try {
        const params = new URLSearchParams();
        if (itemTypeFilter) {
          params.append('itemType', itemTypeFilter);
        }

        const queryString = params.toString();
        const url = `/api/customs/stock-count/opname/${id}${queryString ? `?${queryString}` : ''}`;

        const response = await fetch(url);
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

    if (id) {
      fetchData();
    }
  }, [id, itemTypeFilter, toast]);

  const uniqueItemTypes = useMemo(() => {
    if (!data?.details) return [];
    const types = new Set(data.details.map(item => item.itemType));
    return Array.from(types).sort();
  }, [data]);

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
          onClick={() => router.push('/customs/stock-count/opname')}
        >
          <Receipt sx={{ mr: 0.5 }} fontSize="small" />
          Laporan Stock Opname
        </Link>
        <Typography
          sx={{ display: 'flex', alignItems: 'center' }}
          color="text.primary"
          fontWeight={600}
        >
          {id}
        </Typography>
      </Breadcrumbs>

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
              Stock Opname Detail
            </Typography>
            <Typography variant="body1" color="text.secondary">
              View complete information for stock opname transaction
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<ArrowBack />}
            onClick={() => router.push('/customs/stock-count/opname')}
          >
            Back to List
          </Button>
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, mb: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          Document Header
        </Typography>
        <Divider sx={{ my: 2 }} />

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Document Number
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {data.header.documentNumber}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Date
              </Typography>
              <Typography variant="body1">
                {formatDate(data.header.date)}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Status
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                <Chip
                  label={data.header.status}
                  color={data.header.status === 'RELEASED' ? 'success' : data.header.status === 'PROCESS' ? 'warning' : 'default'}
                  size="small"
                />
              </Box>
            </Box>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Company Code
              </Typography>
              <Typography variant="body1">
                {data.header.companyCode}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Company Name
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {data.header.companyName}
              </Typography>
            </Box>
            {data.header.description && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Description
                </Typography>
                <Typography variant="body1">
                  {data.header.description}
                </Typography>
              </Box>
            )}
          </Grid>
        </Grid>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6" fontWeight={600}>
            Item Details ({data.details.length} items)
          </Typography>
          <TextField
            select
            label="Item Type"
            value={itemTypeFilter}
            onChange={(e) => setItemTypeFilter(e.target.value)}
            size="small"
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">All Item Types</MenuItem>
            {uniqueItemTypes.map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <Divider sx={{ my: 2 }} />

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">System Qty</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Physical Qty</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Difference</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.details.map((detail, index) => (
                <TableRow key={detail.id} hover>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Chip label={detail.itemType} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {detail.itemCode}
                    </Typography>
                  </TableCell>
                  <TableCell>{detail.itemName}</TableCell>
                  <TableCell>
                    <Chip label={detail.unit} size="small" />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={600}>
                      {formatQuantity(detail.systemQty)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={600}>
                      {formatQuantity(detail.physicalQty)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      color={detail.difference > 0 ? 'success.main' : detail.difference < 0 ? 'error.main' : 'text.primary'}
                    >
                      {formatQuantity(detail.difference)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

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
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Total System Qty:
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {formatQuantity(data.details.reduce((sum, d) => sum + d.systemQty, 0))}
              </Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">
                Total Physical Qty:
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {formatQuantity(data.details.reduce((sum, d) => sum + d.physicalQty, 0))}
              </Typography>
            </Stack>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}
