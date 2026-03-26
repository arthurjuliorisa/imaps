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
  CircularProgress,
} from '@mui/material';
import { Refresh, Visibility, ContentCopy, Check, Replay as ReplayIcon, GetApp } from '@mui/icons-material';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
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

interface ChartDataPoint {
  date: string;
  success: number;
  failed: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  isDark: boolean;
}

function CustomChartTooltip({ active, payload, label, isDark }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        backgroundColor: isDark ? '#1e1e2e' : '#ffffff',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        p: 1.5,
        minWidth: 160,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
          display: 'block',
          mb: 0.75,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          fontSize: '0.68rem',
        }}
      >
        {label}
      </Typography>
      {payload.map((entry) => (
        <Box
          key={entry.name}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: entry.color,
              flexShrink: 0,
            }}
          />
          <Typography
            variant="body2"
            sx={{
              color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)',
              fontSize: '0.8rem',
            }}
          >
            <span style={{ opacity: 0.7 }}>
              {entry.name === 'success' ? 'Sukses' : 'Gagal'}:{' '}
            </span>
            <strong>{entry.value}</strong>
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export default function INSWLogsPage() {
  const theme = useTheme();
  const toast = useToast();
  const isDark = theme.palette.mode === 'dark';

  const [logs, setLogs] = useState<INSWLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transactionTypeFilter, setTransactionTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<INSWLog | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(dayjs().subtract(1, 'month').format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(dayjs().format('YYYY-MM-DD'));

  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendingDialog, setResendingDialog] = useState(false);
  const [confirmResendOpen, setConfirmResendOpen] = useState(false);
  const [pendingResendId, setPendingResendId] = useState<string | null>(null);
  const [checkingAdjustments, setCheckingAdjustments] = useState(false);
  const [adjustmentCheckResult, setAdjustmentCheckResult] = useState<{ hasAdjustments: boolean } | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string>('Apakah Anda yakin ingin mengirim ulang data ini ke INSW?');

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
        else if (upperValue === 'PENDING_RESOLVED') color = 'success';

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
      minWidth: 140,
      format: (value: any, row: any) => (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="View Details">
            <IconButton
              size="small"
              color="primary"
              onClick={() => handleViewDetails(row as INSWLog)}
            >
              <Visibility fontSize="small" />
            </IconButton>
          </Tooltip>
          {((row as INSWLog).insw_status === 'FAILED' || (row as INSWLog).insw_status === 'PENDING') && (
            <Tooltip title="Kirim Ulang">
              <span>
                <IconButton
                  size="small"
                  color="warning"
                  onClick={() => {
                    const log = row as INSWLog;
                    // Untuk stock_opname, check adjustments terlebih dahulu
                    if (log.transaction_type === 'stock_opname' && (log.insw_status === 'FAILED' || log.insw_status === 'PENDING')) {
                      checkAdjustments(String(log.id)).then((success) => {
                        if (success) {
                          setPendingResendId(String(log.id));
                          setConfirmResendOpen(true);
                        }
                      });
                    } else {
                      // For other transaction types, show confirmation dialog with standard message
                      setConfirmationMessage('Apakah Anda yakin ingin mengirim ulang data ini ke INSW?');
                      setPendingResendId(String(log.id));
                      setConfirmResendOpen(true);
                    }
                  }}
                  disabled={resendingId === String((row as INSWLog).id) || checkingAdjustments}
                >
                  {resendingId === String((row as INSWLog).id)
                    ? <CircularProgress size={16} />
                    : <ReplayIcon fontSize="small" />
                  }
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ];

  useEffect(() => {
    fetchLogs();
  }, [transactionTypeFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    fetchChartData();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: '100',
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo + 'T23:59:59' }),
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

  const fetchChartData = async () => {
    setChartLoading(true);
    try {
      const response = await fetch('/api/insw/logs/chart-stats');
      const result = await response.json();

      if (result.success && Array.isArray(result.data)) {
        setChartData(result.data);
      } else {
        setChartData([]);
      }
    } catch (err) {
      console.error('Error fetching chart data:', err);
      setChartData([]);
    } finally {
      setChartLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchLogs();
    fetchChartData();
    toast.success('INSW logs refreshed');
  };

  const handleExportExcel = () => {
    const params = new URLSearchParams({
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo && { date_to: dateTo + 'T23:59:59' }),
      ...(transactionTypeFilter !== 'ALL' && { transaction_type: transactionTypeFilter }),
      ...(statusFilter !== 'ALL' && { insw_status: statusFilter }),
    });
    window.open(`/api/insw/logs/export?${params}`, '_blank');
  };

  const handleViewDetails = (log: INSWLog) => {
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

  const checkAdjustments = async (logId: string): Promise<boolean> => {
    try {
      setCheckingAdjustments(true);
      const res = await fetch(`/api/insw/logs/${logId}/check-adjustments`);
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.message || 'Gagal mengecek adjustment');
        return false;
      }

      const hasAdjustments = data.hasAdjustments;
      setAdjustmentCheckResult({ hasAdjustments });

      // Set confirmation message based on adjustment check result
      if (hasAdjustments) {
        setConfirmationMessage('Please click OK only if you confirm that all adjustment postings are correct!');
      } else {
        setConfirmationMessage('Please click if You confirm that there is NO adjustment at all for this stockcount order?');
      }

      return true;
    } catch (err: any) {
      console.error('Error checking adjustments:', err);
      toast.error('Gagal mengecek adjustment');
      return false;
    } finally {
      setCheckingAdjustments(false);
    }
  };

  const handleResend = async (logId: string) => {
    setResendingId(logId);
    try {
      const res = await fetch(`/api/insw/logs/${logId}/resend`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Gagal mengirim ulang data');
      toast.success('Data berhasil dikirim ulang ke INSW');
      fetchLogs();
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengirim ulang data');
    } finally {
      setResendingId(null);
    }
  };

  const totalSuccess = chartData.reduce((sum, d) => sum + d.success, 0);
  const totalFailed = chartData.reduce((sum, d) => sum + d.failed, 0);

  const formattedChartData = chartData.map((d) => ({
    ...d,
    date: dayjs(d.date).format('DD/MM'),
  }));

  const gridStroke = alpha(theme.palette.text.primary, 0.08);
  const tickColor = theme.palette.text.secondary;

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
          <Tooltip title="Export Excel">
            <IconButton onClick={handleExportExcel} color="success">
              <GetApp />
            </IconButton>
          </Tooltip>
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

      {/* Chart Card */}
      <Card sx={{ boxShadow: 3, borderRadius: 2, mb: 3 }}>
        <CardContent sx={{ pb: 1 }}>
          {/* Card Header Row */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: 2,
              mb: 2.5,
            }}
          >
            <Box>
              <Typography variant="subtitle1" fontWeight="bold" sx={{ lineHeight: 1.3 }}>
                Statistik 7 Hari Terakhir
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Distribusi log INSW berdasarkan status per hari
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip
                size="small"
                label={`Total Sukses: ${totalSuccess}`}
                sx={{
                  backgroundColor: alpha('#4caf50', 0.12),
                  color: '#4caf50',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                }}
              />
              <Chip
                size="small"
                label={`Total Gagal: ${totalFailed}`}
                sx={{
                  backgroundColor: alpha('#f44336', 0.12),
                  color: '#f44336',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                }}
              />
            </Stack>
          </Box>

          {/* Area Chart */}
          <Box sx={{ opacity: chartLoading ? 0.4 : 1, transition: 'opacity 0.3s' }}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={formattedChartData}
                margin={{ top: 8, right: 16, left: -10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradientSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgba(76,175,80,0.6)" stopOpacity={1} />
                    <stop offset="95%" stopColor="rgba(76,175,80,0.0)" stopOpacity={1} />
                  </linearGradient>
                  <linearGradient id="gradientFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgba(244,67,54,0.5)" stopOpacity={1} />
                    <stop offset="95%" stopColor="rgba(244,67,54,0.0)" stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="4 4"
                  stroke={gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: tickColor, fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: tickColor, fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <RechartsTooltip
                  content={
                    <CustomChartTooltip isDark={isDark} />
                  }
                  cursor={{
                    stroke: alpha(theme.palette.text.primary, 0.1),
                    strokeWidth: 1,
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={32}
                  formatter={(value: string) =>
                    value === 'success' ? 'Success' : 'Failed'
                  }
                  wrapperStyle={{ fontSize: '0.8rem', paddingTop: '8px' }}
                />
                <Area
                  type="monotone"
                  dataKey="success"
                  stroke="#4caf50"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#gradientSuccess)"
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 0, fill: '#4caf50' }}
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  stroke="#f44336"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#gradientFailed)"
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 0, fill: '#f44336' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </Card>

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
              <MenuItem value="PENDING_RESOLVED">Pending Resolved</MenuItem>
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
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Transmission Details
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
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Request Payload
                    </Typography>
                    <Tooltip title={copiedKey === 'payload' ? 'Tersalin!' : 'Salin'}>
                      <IconButton
                        size="small"
                        onClick={() => handleCopy('payload', selectedLog.insw_request_payload)}
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
                    }}
                  >
                    <pre style={{ margin: 0, fontSize: '0.75rem' }}>
                      {JSON.stringify(selectedLog.insw_request_payload, null, 2)}
                    </pre>
                  </Box>
                </Box>

                {selectedLog.insw_response && (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="subtitle2" color="text.secondary">
                        INSW Response
                      </Typography>
                      <Tooltip title={copiedKey === 'response' ? 'Tersalin!' : 'Salin'}>
                        <IconButton
                          size="small"
                          onClick={() => handleCopy('response', selectedLog.insw_response)}
                          sx={{ color: copiedKey === 'response' ? 'success.main' : 'text.secondary' }}
                        >
                          {copiedKey === 'response' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
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
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          <Box>
            {(selectedLog?.insw_status === 'FAILED' || selectedLog?.insw_status === 'PENDING') && (
              <Button
                onClick={() => {
                  if (selectedLog && selectedLog.transaction_type === 'stock_opname' && (selectedLog.insw_status === 'FAILED' || selectedLog.insw_status === 'PENDING')) {
                    checkAdjustments(String(selectedLog.id)).then((success) => {
                      if (success) {
                        setPendingResendId(String(selectedLog.id));
                        setConfirmResendOpen(true);
                      }
                    });
                  } else {
                    // For other transaction types, show confirmation dialog with standard message
                    setConfirmationMessage('Apakah Anda yakin ingin mengirim ulang data ini ke INSW?');
                    setPendingResendId(String(selectedLog.id));
                    setConfirmResendOpen(true);
                  }
                }}
                color="warning"
                variant="contained"
                disabled={resendingDialog || checkingAdjustments}
                startIcon={resendingDialog || checkingAdjustments ? <CircularProgress size={16} /> : <ReplayIcon />}
              >
                Kirim Ulang
              </Button>
            )}
          </Box>
          <Button onClick={handleCloseDetailDialog} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmResendOpen} onClose={() => setConfirmResendOpen(false)}>
        <DialogTitle>Konfirmasi Kirim Ulang</DialogTitle>
        <DialogContent>
          <Typography>
            {confirmationMessage}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setConfirmResendOpen(false); setPendingResendId(null); }}>
            Batal
          </Button>
          <Button
            onClick={async () => {
              setConfirmResendOpen(false);
              if (!pendingResendId) return;
              const isFromDialog = selectedLog && String(selectedLog.id) === pendingResendId;
              if (isFromDialog) setResendingDialog(true);
              await handleResend(pendingResendId);
              if (isFromDialog) {
                setResendingDialog(false);
                setDetailDialogOpen(false);
              }
              setPendingResendId(null);
            }}
            color="warning"
            variant="contained"
          >
            Kirim Ulang
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
