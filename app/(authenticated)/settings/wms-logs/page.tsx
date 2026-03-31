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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import { Refresh, Visibility, ContentCopy, Check, GetApp } from '@mui/icons-material';
import { DataTable, Column } from '@/app/components/DataTable';
import { useToast } from '@/app/components/ToastProvider';
import dayjs from 'dayjs';

interface WMSTransmissionLog {
  id: string;
  activity_log_id: string;
  action: string;
  wms_id: string | null;
  company_code: number | null;
  transmission_status: 'SUCCESS' | 'FAILED' | 'ERROR' | 'UNKNOWN';
  wms_request_payload: any;
  imaps_error_response: any;
  error_type: string | null;
  summary: string;
  item_count: number | null;
  created_at: string;
  expires_at: string;
}

export default function WMSTransmissionLogsPage() {
  const theme = useTheme();
  const toast = useToast();

  const [logs, setLogs] = useState<WMSTransmissionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('ALL');
  const [errorTypeFilter, setErrorTypeFilter] = useState('ALL');
  const [transmissionStatusFilter, setTransmissionStatusFilter] = useState('ALL');
  const [companyCodeFilter, setCompanyCodeFilter] = useState('ALL');
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<WMSTransmissionLog | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(dayjs().subtract(7, 'days').format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(dayjs().format('YYYY-MM-DD'));

  const columns: Column[] = [
    {
      id: 'created_at',
      label: 'Created At',
      minWidth: 160,
      format: (value: any) => dayjs(value).format('MM/DD/YYYY HH:mm:ss'),
    },
    {
      id: 'action',
      label: 'Action',
      minWidth: 200,
      format: (value: string) => (
        <Chip
          label={value.replace('WMS_', '').replace('_ERROR', '')}
          size="small"
          sx={{ fontWeight: 'bold' }}
        />
      ),
    },
    {
      id: 'transmission_status',
      label: 'Status',
      minWidth: 120,
      format: (value: string) => {
        let color: 'success' | 'error' | 'warning' | 'default' = 'default';
        let label = value || 'UNKNOWN';
        if (value === 'SUCCESS') color = 'success';
        else if (value === 'FAILED') color = 'error';
        else if (value === 'ERROR') color = 'error';
        else if (value === 'UNKNOWN') color = 'warning';

        return (
          <Chip
            label={label}
            color={color}
            size="small"
            variant="outlined"
            sx={{ fontWeight: 'bold' }}
          />
        );
      },
    },
    {
      id: 'wms_id',
      label: 'WMS ID',
      minWidth: 150,
      format: (value: any) => value || '-',
    },
    {
      id: 'error_type',
      label: 'Error Type',
      minWidth: 150,
      format: (value: string | null) => {
        if (!value) return <Typography variant="body2">-</Typography>;
        let color: 'error' | 'warning' | 'info' = 'info';
        if (value === 'VALIDATION_ERROR') color = 'error';
        else if (value === 'BUSINESS_LOGIC_ERROR') color = 'warning';
        else if (value === 'SYSTEM_ERROR') color = 'error';

        return (
          <Chip
            label={value}
            color={color}
            size="small"
            sx={{ fontWeight: 'bold' }}
          />
        );
      },
    },
    {
      id: 'item_count',
      label: 'Items',
      minWidth: 80,
      format: (value: any) => value || '-',
    },
    {
      id: 'expires_at',
      label: 'Expires At',
      minWidth: 160,
      format: (value: any) => dayjs(value).format('MM/DD/YYYY'),
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
            onClick={() => handleViewDetails(row as WMSTransmissionLog)}
          >
            <Visibility fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  useEffect(() => {
    fetchLogs();
  }, [actionFilter, errorTypeFilter, transmissionStatusFilter, companyCodeFilter, dateFrom, dateTo]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: '100',
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo + 'T23:59:59' }),
        ...(actionFilter !== 'ALL' && { action: actionFilter }),
        ...(errorTypeFilter !== 'ALL' && { error_type: errorTypeFilter }),
        ...(transmissionStatusFilter !== 'ALL' && { transmission_status: transmissionStatusFilter }),
        ...(companyCodeFilter !== 'ALL' && { company_code: companyCodeFilter }),
      });

      const response = await fetch(`/api/settings/wms-transmission-logs?${params}`);
      const result = await response.json();

      if (result.success && Array.isArray(result.data)) {
        setLogs(result.data);
        setError(null);
      } else {
        setLogs([]);
        setError(result.error || 'Failed to fetch logs');
      }
    } catch (err) {
      console.error('Error fetching WMS transmission logs:', err);
      setLogs([]);
      setError('Failed to fetch WMS transmission logs');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchLogs();
    toast.success('WMS transmission logs refreshed');
  };

  const handleViewDetails = (log: WMSTransmissionLog) => {
    setSelectedLog(log);
    setDetailDialogOpen(true);
  };

  const handleCloseDetailDialog = () => {
    setDetailDialogOpen(false);
    setSelectedLog(null);
    setCopiedKey(null);
  };

  const handleCopy = (key: string, value: any) => {
    const text = JSON.stringify(value, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  };

  const getActionOptions = () => {
    const actions = new Set(logs.map((log) => log.action));
    return Array.from(actions).sort();
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
            WMS Transmission Logs
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Monitor WMS API request/response payload and error details
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

      {/* Stats Cards */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <Card sx={{ flex: 1, boxShadow: 1 }}>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Total Logs
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
              {logs.length}
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1, boxShadow: 1 }}>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Successful
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'success.main' }}>
              {logs.filter((log) => log.transmission_status === 'SUCCESS').length}
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1, boxShadow: 1 }}>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Failed
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'error.main' }}>
              {logs.filter((log) => log.transmission_status === 'FAILED').length}
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1, boxShadow: 1 }}>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Errors
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'error.main' }}>
              {logs.filter((log) => log.transmission_status === 'ERROR').length}
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      {/* Filter Card */}
      <Card sx={{ mb: 3, boxShadow: 1 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Dari Tanggal"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 160 }}
            />
            <TextField
              label="Sampai Tanggal"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 160 }}
            />
            <TextField
              select
              label="Action"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              size="small"
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="ALL">All Actions</MenuItem>
              {getActionOptions().map((action) => (
                <MenuItem key={action} value={action}>
                  {action.replace('WMS_', '').replace('_ERROR', '')}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Transmission Status"
              value={transmissionStatusFilter}
              onChange={(e) => setTransmissionStatusFilter(e.target.value)}
              size="small"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="ALL">All Status</MenuItem>
              <MenuItem value="SUCCESS">Success</MenuItem>
              <MenuItem value="FAILED">Failed</MenuItem>
              <MenuItem value="ERROR">Error</MenuItem>
            </TextField>
            <TextField
              select
              label="Error Type"
              value={errorTypeFilter}
              onChange={(e) => setErrorTypeFilter(e.target.value)}
              size="small"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="ALL">All Error Types</MenuItem>
              <MenuItem value="VALIDATION_ERROR">Validation Error</MenuItem>
              <MenuItem value="BUSINESS_LOGIC_ERROR">Business Logic Error</MenuItem>
              <MenuItem value="SYSTEM_ERROR">System Error</MenuItem>
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

      {/* Detail Dialog */}
      <Dialog
        open={detailDialogOpen}
        onClose={handleCloseDetailDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          WMS Transmission Details
        </DialogTitle>
        <DialogContent dividers>
          {selectedLog && (
            <Box>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Action
                  </Typography>
                  <Typography variant="body1">
                    {selectedLog.action}
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
                    Company Code
                  </Typography>
                  <Typography variant="body1">
                    {selectedLog.company_code || 'N/A'}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Error Type
                  </Typography>
                  <Chip
                    label={selectedLog.error_type || 'N/A'}
                    color={
                      selectedLog.error_type === 'VALIDATION_ERROR'
                        ? 'error'
                        : selectedLog.error_type === 'SYSTEM_ERROR'
                        ? 'error'
                        : 'warning'
                    }
                    size="small"
                  />
                </Box>

                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Transmission Status
                  </Typography>
                  <Chip
                    label={selectedLog.transmission_status || 'UNKNOWN'}
                    color={
                      selectedLog.transmission_status === 'SUCCESS'
                        ? 'success'
                        : selectedLog.transmission_status === 'FAILED' || selectedLog.transmission_status === 'ERROR'
                        ? 'error'
                        : 'default'
                    }
                    variant="outlined"
                    size="small"
                  />
                </Box>

                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Summary / Message
                  </Typography>
                  <Typography variant="body2">
                    {selectedLog.summary}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Item Count
                  </Typography>
                  <Typography variant="body1">
                    {selectedLog.item_count || 'N/A'}
                  </Typography>
                </Box>

                {selectedLog.transmission_status !== 'SUCCESS' && selectedLog.wms_request_payload && (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="subtitle2" color="text.secondary">
                        WMS Request Payload
                      </Typography>
                      <Tooltip title={copiedKey === 'payload' ? 'Tersalin!' : 'Salin'}>
                        <IconButton
                          size="small"
                          onClick={() => handleCopy('payload', selectedLog.wms_request_payload)}
                          sx={{ color: copiedKey === 'payload' ? 'success.main' : 'text.secondary' }}
                        >
                          {copiedKey === 'payload' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    </Box>
                    <Box
                      sx={{
                        bgcolor: 'grey.100',
                        p: 2,
                        borderRadius: 1,
                        maxHeight: 300,
                        overflow: 'auto',
                        border: '1px solid #e0e0e0',
                      }}
                    >
                      <pre style={{ margin: 0, fontSize: '0.75rem', fontFamily: 'monospace' }}>
                        {JSON.stringify(selectedLog.wms_request_payload, null, 2)}
                      </pre>
                    </Box>
                  </Box>
                )}

                {selectedLog.transmission_status !== 'SUCCESS' && selectedLog.imaps_error_response && (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="subtitle2" color="text.secondary">
                        iMAPS Error Response
                      </Typography>
                      <Tooltip title={copiedKey === 'response' ? 'Tersalin!' : 'Salin'}>
                        <IconButton
                          size="small"
                          onClick={() => handleCopy('response', selectedLog.imaps_error_response)}
                          sx={{ color: copiedKey === 'response' ? 'success.main' : 'text.secondary' }}
                        >
                          {copiedKey === 'response' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    </Box>
                    <Box
                      sx={{
                        bgcolor: '#ffebee',
                        p: 2,
                        borderRadius: 1,
                        maxHeight: 300,
                        overflow: 'auto',
                        border: '1px solid #ffcdd2',
                      }}
                    >
                      <pre style={{ margin: 0, fontSize: '0.75rem', fontFamily: 'monospace', color: '#c62828' }}>
                        {JSON.stringify(selectedLog.imaps_error_response, null, 2)}
                      </pre>
                    </Box>
                  </Box>
                )}

                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Created At
                  </Typography>
                  <Typography variant="body1">
                    {dayjs(selectedLog.created_at).format('MMMM D, YYYY HH:mm:ss')}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Expires At
                  </Typography>
                  <Typography variant="body1">
                    {dayjs(selectedLog.expires_at).format('MMMM D, YYYY HH:mm:ss')}
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
