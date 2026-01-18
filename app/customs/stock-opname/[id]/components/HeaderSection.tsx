'use client';

import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Chip,
  Button,
  Stack,
  Grid,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import {
  ArrowBack,
  Edit as EditIcon,
  PlayArrow,
  CheckCircle,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { StockOpname, StockOpnameStatus } from '@/types/stock-opname';
import { useToast } from '@/app/components/ToastProvider';

interface HeaderSectionProps {
  stockOpname: StockOpname;
  totalItems: number;
  totalStoQty: number;
  totalVariance: number;
  onUpdate: () => void;
}

export function HeaderSection({
  stockOpname,
  totalItems,
  totalStoQty,
  totalVariance,
  onUpdate,
}: HeaderSectionProps) {
  const router = useRouter();
  const toast = useToast();
  const [editDialog, setEditDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [companyName, setCompanyName] = useState<string>('');

  const now = new Date();
  const stoDate = new Date(stockOpname.sto_datetime);
  const stoDateStr = stoDate.toISOString().split('T')[0];
  const stoTimeStr = stoDate.toTimeString().slice(0, 5);

  const [formData, setFormData] = useState({
    sto_date: stoDateStr,
    sto_time: stoTimeStr,
    pic_name: stockOpname.pic_name || '',
  });

  React.useEffect(() => {
    const fetchCompanyName = async () => {
      try {
        const response = await fetch(`/api/master/companies?code=${stockOpname.company_code}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data && result.data.length > 0) {
            setCompanyName(result.data[0].name);
          }
        }
      } catch (error) {
        console.error('Failed to fetch company name:', error);
      }
    };

    fetchCompanyName();
  }, [stockOpname.company_code]);

  const getStatusColor = (status: StockOpnameStatus) => {
    switch (status) {
      case 'OPEN':
        return 'warning';
      case 'PROCESS':
        return 'info';
      case 'RELEASED':
        return 'success';
      default:
        return 'default';
    }
  };

  const formatDateTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).replace(',', '');
    } catch {
      return '-';
    }
  };

  const handleUpdateHeader = async () => {
    setLoading(true);
    try {
      const stoDateTime = new Date(`${formData.sto_date}T${formData.sto_time}:00`);

      const response = await fetch(`/api/customs/stock-opname/${stockOpname.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sto_date: stoDateTime.toISOString(),
          pic_name: formData.pic_name.trim() || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update');
      }

      toast.success('Stock opname updated successfully');
      setEditDialog(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating stock opname:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: StockOpnameStatus) => {
    const confirmMessage =
      newStatus === 'PROCESS'
        ? 'Change status to PROCESS? You cannot revert this action.'
        : 'Change status to RELEASED? You cannot revert this action.';

    if (!confirm(confirmMessage)) return;

    try {
      const response = await fetch(`/api/customs/stock-opname/${stockOpname.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update status');
      }

      toast.success(`Status changed to ${newStatus}`);
      onUpdate();
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update status');
    }
  };

  return (
    <>
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <IconButton onClick={() => router.push('/customs/stock-opname')}>
            <ArrowBack />
          </IconButton>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h4" fontWeight="bold">
              {stockOpname.sto_number}
            </Typography>
          </Box>
          <Tooltip
            title={
              stockOpname.status === 'OPEN'
                ? 'Initial state - waiting for items to be added'
                : stockOpname.status === 'PROCESS'
                ? 'Items are being added or edited'
                : 'Finalized - no further changes allowed'
            }
          >
            <Chip
              label={stockOpname.status}
              color={getStatusColor(stockOpname.status)}
              size="medium"
            />
          </Tooltip>
          {stockOpname.status !== 'RELEASED' && (
            <Tooltip title="Edit Header">
              <IconButton onClick={() => setEditDialog(true)} color="primary">
                <EditIcon />
              </IconButton>
            </Tooltip>
          )}
          {stockOpname.status === 'PROCESS' && (
            <Button
              variant="contained"
              color="success"
              startIcon={<CheckCircle />}
              onClick={() => handleStatusChange('RELEASED')}
            >
              Release STO
            </Button>
          )}
        </Box>

        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                STO Information
              </Typography>
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Company
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {stockOpname.company_code}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {companyName || 'Loading...'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    STO Date & Time
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {formatDateTime(stockOpname.sto_datetime)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    PIC Name
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {stockOpname.pic_name || '-'}
                  </Typography>
                </Box>
              </Stack>
            </Paper>
          </Grid>

          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Summary
              </Typography>
              <Box sx={{ display: 'flex', gap: 3, mt: 2 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Total Items
                  </Typography>
                  <Typography variant="h6" fontWeight={600}>
                    {totalItems}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Total STO Qty
                  </Typography>
                  <Typography variant="h6" fontWeight={600}>
                    {totalStoQty.toFixed(2)}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Total Variance
                  </Typography>
                  <Typography
                    variant="h6"
                    fontWeight={600}
                    color={totalVariance > 0 ? 'success.main' : totalVariance < 0 ? 'error.main' : 'text.primary'}
                  >
                    {totalVariance.toFixed(2)}
                  </Typography>
                </Box>
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Audit Information
              </Typography>
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Created By
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {stockOpname.created_by}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Created At
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {formatDateTime(stockOpname.created_at)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Updated At
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {formatDateTime(stockOpname.updated_at)}
                  </Typography>
                </Box>
              </Stack>
            </Paper>
          </Grid>
        </Grid>
      </Box>

      <Dialog open={editDialog} onClose={() => setEditDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Stock Opname Header</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 2 }}>
            <TextField
              label="STO Date"
              type="date"
              value={formData.sto_date}
              onChange={(e) => setFormData({ ...formData, sto_date: e.target.value })}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="STO Time"
              type="time"
              value={formData.sto_time}
              onChange={(e) => setFormData({ ...formData, sto_time: e.target.value })}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="PIC Name"
              value={formData.pic_name}
              onChange={(e) => setFormData({ ...formData, pic_name: e.target.value })}
              inputProps={{ maxLength: 100 }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditDialog(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleUpdateHeader} variant="contained" disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
