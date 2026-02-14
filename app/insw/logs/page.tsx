'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Alert,
  alpha,
  useTheme,
  Chip,
  TextField,
  MenuItem,
  Stack,
  Card,
  CardContent,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import { Refresh, Visibility } from '@mui/icons-material';
import { DataTable, Column } from '@/app/components/DataTable';
import { useToast } from '@/app/components/ToastProvider';
import dayjs from 'dayjs';

interface INSWLog {
  id: string;
  transaction_type: string;
  transaction_id: number | null;
  wms_id: string | null;
  company_code: number;
  insw_status: string;
  insw_activity_code: string | null;
  insw_request_payload: any;
  insw_response: any;
  insw_error: string | null;
  sent_at: string | null;
  retry_count: number;
  created_at: string;
}

export default function INSWLogsPage() {
  const theme = useTheme();
  const toast = useToast();
  const [logs, setLogs] = useState<INSWLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transactionTypeFilter, setTransactionTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<INSWLog | null>(null);

  const columns: Column[] = [
    {
      id: 'sent_at',
      label: 'Sent At',
      minWidth: 160,
      format: (value: any) => value ? dayjs(value).format('MM/DD/YYYY HH:mm:ss') : '-',
    },
    {
      id: 'transaction_type',
      label: 'Type',
      minWidth: 120,
      format: (value: string) => (
        <Chip
          label={value.toUpperCase()}
          size="small"
          sx={{ fontWeight: 'bold' }}
        />
      ),
    },
    {
      id: 'transaction_id',
      label: 'Trans ID',
      minWidth: 100,
      format: (value: any) => value || '-',
    },
    {
      id: 'wms_id',
      label: 'WMS ID',
      minWidth: 120,
      format: (value: any) => value || '-',
    },
    {
      id: 'insw_activity_code',
      label: 'Activity',
      minWidth: 100,
      format: (value: any) => value || '-',
    },
    {
      id: 'insw_status',
      label: 'Status',
      minWidth: 120,
      format: (value: string) => {
        const upperValue = value?.toUpperCase() || '';
        let color: 'success' | 'error' | 'warning' | 'info' = 'info';
        if (upperValue === 'SUCCESS') color = 'success';
        else if (upperValue === 'FAILED') color = 'error';
        else if (upperValue === 'PENDING' || upperValue === 'SENT') color = 'warning';

        return (
          <Chip
            label={upperValue}
            color={color}
            size="small"
            sx={{ fontWeight: 'bold' }}
          />
        );
      },
    },
    {
      id: 'retry_count',
      label: 'Retries',
      minWidth: 80,
      format: (value: any) => value || 0,
    },
    {
      id: 'actions',
      label: 'Actions',
      minWidth: 100,
      format: (value: any, row: any) => (
        <Tooltip title="View Details">
          <IconButton
            size="small"
            color="primary"
            onClick={() => handleViewDetails(row as INSWLog)}
          >
            <Visibility fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  useEffect(() => {
    fetchLogs();
  }, [transactionTypeFilter, statusFilter]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: '100',
        ...(transactionTypeFilter !== 'ALL' && { transaction_type: transactionTypeFilter }),
        ...(statusFilter !== 'ALL' && { insw_status: statusFilter }),
      });

      const response = await fetch(`/api/insw/logs?${params}`);
      const result = await response.json();

      if (result.success && Array.isArray(result.data)) {
        setLogs(result.data);
        setError(null);
      } else {
        setLogs([]);
        setError(result.error || 'Failed to fetch logs');
      }
    } catch (err) {
      console.error('Error fetching INSW logs:', err);
      setLogs([]);
      setError('Failed to fetch INSW logs');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchLogs();
    toast.success('INSW logs refreshed');
  };

  const handleViewDetails = (log: INSWLog) => {
    setSelectedLog(log);
    setDetailDialogOpen(true);
  };

  const handleCloseDetailDialog = () => {
    setDetailDialogOpen(false);
    setSelectedLog(null);
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
          pb: 2,
          borderBottom: `2px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Box>
          <Typography variant="h5" fontWeight="bold" color="primary">
            INSW Transmission Logs
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Monitor INSW API transmission history and status
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh">
            <IconButton onClick={handleRefresh} color="primary">
              <Refresh />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ mb: 3, boxShadow: 1 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Transaction Type"
              value={transactionTypeFilter}
              onChange={(e) => setTransactionTypeFilter(e.target.value)}
              size="small"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="ALL">All Types</MenuItem>
              <MenuItem value="incoming">Incoming</MenuItem>
              <MenuItem value="outgoing">Outgoing</MenuItem>
            </TextField>
            <TextField
              select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              size="small"
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="ALL">All Status</MenuItem>
              <MenuItem value="SUCCESS">Success</MenuItem>
              <MenuItem value="FAILED">Failed</MenuItem>
              <MenuItem value="PENDING">Pending</MenuItem>
              <MenuItem value="SENT">Sent</MenuItem>
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={logs}
        loading={loading}
        searchable={false}
      />

      <Dialog
        open={detailDialogOpen}
        onClose={handleCloseDetailDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Typography variant="h6" fontWeight="bold">
            Transmission Details
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {selectedLog && (
            <Box>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Transaction Type
                  </Typography>
                  <Typography variant="body1">
                    {selectedLog.transaction_type.toUpperCase()}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Transaction ID
                  </Typography>
                  <Typography variant="body1">
                    {selectedLog.transaction_id || 'N/A'}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    WMS ID
                  </Typography>
                  <Typography variant="body1">
                    {selectedLog.wms_id || 'N/A'}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    INSW Status
                  </Typography>
                  <Chip
                    label={selectedLog.insw_status}
                    color={selectedLog.insw_status === 'SUCCESS' ? 'success' : 'error'}
                    size="small"
                  />
                </Box>

                {selectedLog.insw_error && (
                  <Box>
                    <Typography variant="subtitle2" color="error">
                      Error Message
                    </Typography>
                    <Typography variant="body2" color="error">
                      {selectedLog.insw_error}
                    </Typography>
                  </Box>
                )}

                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Request Payload
                  </Typography>
                  <Box
                    sx={{
                      bgcolor: 'grey.100',
                      p: 2,
                      borderRadius: 1,
                      maxHeight: 300,
                      overflow: 'auto',
                    }}
                  >
                    <pre style={{ margin: 0, fontSize: '0.75rem' }}>
                      {JSON.stringify(selectedLog.insw_request_payload, null, 2)}
                    </pre>
                  </Box>
                </Box>

                {selectedLog.insw_response && (
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      INSW Response
                    </Typography>
                    <Box
                      sx={{
                        bgcolor: 'grey.100',
                        p: 2,
                        borderRadius: 1,
                        maxHeight: 300,
                        overflow: 'auto',
                      }}
                    >
                      <pre style={{ margin: 0, fontSize: '0.75rem' }}>
                        {JSON.stringify(selectedLog.insw_response, null, 2)}
                      </pre>
                    </Box>
                  </Box>
                )}

                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Sent At
                  </Typography>
                  <Typography variant="body1">
                    {selectedLog.sent_at
                      ? dayjs(selectedLog.sent_at).format('MMMM D, YYYY HH:mm:ss')
                      : 'Not sent yet'}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Retry Count
                  </Typography>
                  <Typography variant="body1">
                    {selectedLog.retry_count}
                  </Typography>
                </Box>
              </Stack>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDetailDialog} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
