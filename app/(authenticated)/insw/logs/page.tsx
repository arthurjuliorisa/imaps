'use client';

import React, { useState, useEffect, useRef } from 'react';
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
import { transmissionStatus, transmissionResult, transmissionError } from '@/lib/insw-log-presentation';
import type { AttemptHistoryEntry } from '@/lib/insw-queue/attempt-history';
import { provenanceLabel, type OperationalState } from '@/lib/insw-queue/operational-state';

interface INSWLog {
  id: string;
  transaction_type: string;
  transaction_id: number | null;
  wms_id: string | null;
  company_code: number;
  insw_status: string;
  insw_activity_code: string | null;
  insw_request_payload?: any;
  insw_response?: any;
  insw_error: string | null;
  sent_at: string | null;
  retry_count: number;
  can_resend?: boolean;
  current_queue?: OperationalState | null;
  queue_id?: string | null;
  queue_attempt_id?: string | null;
  created_at: string;
  attempt_history?: { entries: AttemptHistoryEntry[]; truncated: boolean } | null;
  metadata?: { endpoint_url?: string; rehearsalProvenance?: string } | null;
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

const LARGE_PAYLOAD_ITEM_THRESHOLD = 100;

const PAYLOAD_ROW_ARRAY_KEYS = [
  'barangTransaksi',
  'items',
  'details',
  'detail',
  'rows',
  'records',
  'results',
];

const MAX_PAYLOAD_COUNT_SCAN_DEPTH = 8;

function countNestedArrayItemsByKey(
  value: any,
  targetKey: string,
  depth = 0,
  seen = new WeakSet<object>()
): { count: number; found: boolean } {
  if (!value || depth > MAX_PAYLOAD_COUNT_SCAN_DEPTH) {
    return { count: 0, found: false };
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return { count: 0, found: false };
    }
    seen.add(value);
  }

  if (Array.isArray(value)) {
    let count = 0;
    let found = false;

    for (const item of value) {
      const nested = countNestedArrayItemsByKey(item, targetKey, depth + 1, seen);
      count += nested.count;
      found = found || nested.found;

      if (count > LARGE_PAYLOAD_ITEM_THRESHOLD) {
        return { count, found };
      }
    }

    return { count, found };
  }

  if (typeof value !== 'object') {
    return { count: 0, found: false };
  }

  const targetValue = value[targetKey];
  if (Array.isArray(targetValue)) {
    return { count: targetValue.length, found: true };
  }

  let count = 0;
  let found = false;

  for (const childValue of Object.values(value)) {
    const nested = countNestedArrayItemsByKey(childValue, targetKey, depth + 1, seen);
    count += nested.count;
    found = found || nested.found;

    if (count > LARGE_PAYLOAD_ITEM_THRESHOLD) {
      return { count, found };
    }
  }

  return { count, found };
}

function findLargeArrayCount(
  value: any,
  depth = 0,
  seen = new WeakSet<object>()
): number | null {
  if (!value || depth > MAX_PAYLOAD_COUNT_SCAN_DEPTH) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

    try {
      return findLargeArrayCount(JSON.parse(trimmed), depth + 1, seen);
    } catch {
      return null;
    }
  }

  if (typeof value !== 'object') return null;

  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length > LARGE_PAYLOAD_ITEM_THRESHOLD) return value.length;

    for (const item of value) {
      const nestedCount = findLargeArrayCount(item, depth + 1, seen);
      if (nestedCount !== null) return nestedCount;
    }

    return null;
  }

  for (const key of PAYLOAD_ROW_ARRAY_KEYS) {
    const rowArray = value[key];
    if (Array.isArray(rowArray) && rowArray.length > LARGE_PAYLOAD_ITEM_THRESHOLD) {
      return rowArray.length;
    }
  }

  for (const childValue of Object.values(value)) {
    const nestedCount = findLargeArrayCount(childValue, depth + 1, seen);
    if (nestedCount !== null) return nestedCount;
  }

  return null;
}

function getPayloadItemCount(payload: any): number | null {
  if (!payload) return null;

  const parsedPayload = typeof payload === 'string' ? (() => {
    const trimmed = payload.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return payload;

    try {
      return JSON.parse(trimmed);
    } catch {
      return payload;
    }
  })() : payload;

  const barangTransaksiCount = countNestedArrayItemsByKey(parsedPayload, 'barangTransaksi');
  if (barangTransaksiCount.found) return barangTransaksiCount.count;

  const largeArrayCount = findLargeArrayCount(parsedPayload);
  if (largeArrayCount !== null) return largeArrayCount;

  return null;
}

function isLargePayload(payload: any): boolean {
  const itemCount = getPayloadItemCount(payload);
  return itemCount !== null && itemCount > LARGE_PAYLOAD_ITEM_THRESHOLD;
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
  const [transactionTypes, setTransactionTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [wmsIdDraft, setWmsIdDraft] = useState('');
  const [wmsIdSearch, setWmsIdSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [loadedListKey, setLoadedListKey] = useState<string | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<INSWLog | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequestVersion = useRef(0);
  const listRequestVersion = useRef(0);
  const metadataRequestVersion = useRef(0);
  const chartRequestVersion = useRef(0);
  const resendLatch = useRef(false);
  const refreshLatch = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(dayjs().subtract(7, 'day').format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(dayjs().format('YYYY-MM-DD'));

  // Draft WMS text is deliberately excluded: only Enter commits it.
  const activeListKey = JSON.stringify([transactionTypeFilter, statusFilter, wmsIdSearch, dateFrom, dateTo, page, rowsPerPage]);
  const exportReady = !loading && !error && loadedListKey === activeListKey;

  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendingDialog, setResendingDialog] = useState(false);
  const [confirmResendOpen, setConfirmResendOpen] = useState(false);
  const [pendingResendId, setPendingResendId] = useState<string | null>(null);
  const [checkingAdjustments, setCheckingAdjustments] = useState(false);
  const [adjustmentCheckResult, setAdjustmentCheckResult] = useState<{ hasAdjustments: boolean } | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string>('Apakah Anda yakin ingin mengirim ulang data ini ke INSW?');

  const [detailError, setDetailError] = useState<string | null>(null);

  const columns: Column[] = [
    {
      id: 'sent_at',
      label: 'Sent At',
      minWidth: 160,
      format: (value: any) => value ? dayjs(value).format('DD-MMMM-YY HH:mm:ss') : '-',
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
      label: 'Recorded Result',
      minWidth: 150,
      format: (value: string, row: INSWLog) => {
        const result = transmissionResult(value, undefined, row.metadata?.rehearsalProvenance);
        return <Chip label={result.label} color={result.color} size="small" />;
      },
    },
    {
      id: 'current_queue',
      label: 'INSW Status',
      minWidth: 280,
      format: (_value: any, row: INSWLog) => renderQueueState(row),
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
              aria-label={`View details for log ${row.id}`}
              color="primary"
              onClick={() => handleViewDetails(row as INSWLog)}
            >
              <Visibility fontSize="small" />
            </IconButton>
          </Tooltip>
          {(row as INSWLog).can_resend === true && (
            <Tooltip title="Kirim Ulang">
              <span>
                <IconButton
                  aria-label="Kirim Ulang"
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
  }, [transactionTypeFilter, statusFilter, wmsIdSearch, dateFrom, dateTo, page, rowsPerPage]);

  useEffect(() => {
    fetchFilterMetadata();
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchChartData();
  }, []);

  const fetchLogs = async () => {
    const requestVersion = ++listRequestVersion.current;
    const requestKey = activeListKey;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        limit: String(rowsPerPage),
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo }),
        ...(transactionTypeFilter !== 'ALL' && { transaction_type: transactionTypeFilter }),
        ...(statusFilter !== 'ALL' && { insw_status: statusFilter }),
        ...(wmsIdSearch && { wms_id: wmsIdSearch }),
      });

      const response = await fetch(`/api/insw/logs?${params}`);
      const result = await response.json();
      if (requestVersion !== listRequestVersion.current) return false;

      if (response.ok && result.success && Array.isArray(result.data)) {
        setLoadedListKey(requestKey);
        setLogs(result.data);
        setTotalCount(result.pagination?.total || 0);
        setError(null);
        return true;
      } else {
        setLogs([]);
        setTotalCount(0);
        setError(result.error || result.message || 'Failed to fetch logs');
        return false;
      }
    } catch (err) {
      if (requestVersion !== listRequestVersion.current) return false;
      console.error('Error fetching INSW logs:', err);
      setLogs([]);
      setTotalCount(0);
      setError('Failed to fetch INSW logs');
      return false;
    } finally {
      if (requestVersion === listRequestVersion.current) setLoading(false);
    }
  };

  const fetchFilterMetadata = async () => {
    const version = ++metadataRequestVersion.current;
    try {
      const params = new URLSearchParams({
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo }),
      });
      const response = await fetch(`/api/insw/logs/metadata?${params}`);
      const result = await response.json();
      if (version !== metadataRequestVersion.current) return false;
      if (response.ok && result.success) {
        setTransactionTypes(result.data?.transactionTypes || []);
        setStatuses(result.data?.statuses || []);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error fetching INSW log filter metadata:', err);
      return false;
    }
  };

  const fetchChartData = async () => {
    const version = ++chartRequestVersion.current;
    setChartLoading(true);
    try {
      const response = await fetch('/api/insw/logs/chart-stats');
      const result = await response.json();

      if (version !== chartRequestVersion.current) return false;
      if (response.ok && result.success && Array.isArray(result.data)) {
        setChartData(result.data);
        return true;
      } else {
        setChartData([]);
        return false;
      }
    } catch (err) {
      if (version !== chartRequestVersion.current) return false;
      console.error('Error fetching chart data:', err);
      setChartData([]);
      return false;
    } finally {
      if (version === chartRequestVersion.current) setChartLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextRowsPerPage = Number(event.target.value);
    setRowsPerPage([5, 10, 25, 50].includes(nextRowsPerPage) ? nextRowsPerPage : 10);
    setPage(0);
  };

  const handleSearch = () => {
    setWmsIdSearch(wmsIdDraft.trim());
    setPage(0);
  };

  const handleRefresh = async () => {
    if (refreshLatch.current) return;
    refreshLatch.current = true;
    setRefreshing(true);
    try {
      const requests = [fetchLogs(), fetchChartData(), fetchFilterMetadata()];
      const versions = [listRequestVersion.current, chartRequestVersion.current, metadataRequestVersion.current];
      const results = await Promise.all(requests);
      // A completed request may have been superseded while another was pending.
      const currentVersions = [listRequestVersion.current, chartRequestVersion.current, metadataRequestVersion.current];
      if (results.every(Boolean) && versions.every((version, index) => version === currentVersions[index])) {
        toast.success('INSW logs refreshed');
      } else {
        toast.error('Refresh incomplete; a request failed or was superseded.');
      }
    } finally {
      refreshLatch.current = false;
      setRefreshing(false);
    }
  };

  const handleExportExcel = async () => {
    if (!exportReady || exporting) return;
    const params = new URLSearchParams({
      ...(wmsIdSearch && { wms_id: wmsIdSearch }),
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo && { date_to: dateTo }),
      ...(transactionTypeFilter !== 'ALL' && { transaction_type: transactionTypeFilter }),
      ...(statusFilter !== 'ALL' && { insw_status: statusFilter }),
      ...(wmsIdSearch && { wms_id: wmsIdSearch }),
    });
    setExporting(true);
    try {
      const response = await fetch(`/api/insw/logs/export?${params}`);
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || 'Unable to export INSW logs');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'insw-logs.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Allow the browser to start consuming the object URL before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to export INSW logs');
    } finally {
      setExporting(false);
    }
  };

  const handleExportCsv = async () => {
    if (!exportReady || exportingCsv) return;
    const params = new URLSearchParams({
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo && { date_to: dateTo }),
      ...(transactionTypeFilter !== 'ALL' && { transaction_type: transactionTypeFilter }),
      ...(statusFilter !== 'ALL' && { insw_status: statusFilter }),
      ...(wmsIdSearch && { wms_id: wmsIdSearch }),
    });
    setExportingCsv(true);
    try {
      const response = await fetch(`/api/insw/logs/export/csv?${params}`);
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || result?.message || 'Unable to export INSW CSV');
      }
      const blob = await response.blob();
      const empty = blob.size === new TextEncoder().encode('\uFEFFNo,Sent At,Type,WMS ID,Activity,Status,Retries\r\n').length;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'insw-logs.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(empty ? 'No matching logs. Downloaded CSV contains headers only.' : 'INSW CSV downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to export INSW CSV');
    } finally {
      setExportingCsv(false);
    }
  };

  const handleViewDetails = async (log: INSWLog) => {
    const logId = String(log.id);
    const requestVersion = ++detailRequestVersion.current;
    setSelectedLogId(logId);
    // List rows intentionally omit payloads. Clear the previous detail before
    // loading so it cannot be shown under the newly selected row.
    setSelectedLog(null);
    setDetailError(null);
    setDetailDialogOpen(true);
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/insw/logs/${encodeURIComponent(logId)}`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Failed to load log details');
      if (String(result.data?.id) !== logId) throw new Error('Loaded log detail does not match the selected row');
      if (detailRequestVersion.current !== requestVersion) return;
      setSelectedLog(result.data);
    } catch (err: any) {
      if (detailRequestVersion.current === requestVersion) {
        setDetailError(err.message || 'Failed to load log details');
        toast.error(err.message || 'Failed to load log details');
      }
    } finally {
      if (detailRequestVersion.current === requestVersion) {
        setDetailLoading(false);
      }
    }
  };

  const handleCloseDetailDialog = () => {
    detailRequestVersion.current += 1;
    setDetailDialogOpen(false);
    setSelectedLogId(null);
    setSelectedLog(null);
    setCopiedKey(null);
    setDetailLoading(false);
  };

  const handleCopy = (key: string, value: any) => {
    const text = JSON.stringify(value, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  };

  const downloadJsonPayload = (payload: any, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const renderPayloadContent = (
    payload: any,
    payloadType: 'request' | 'response',
    logId: string
  ) => {
    if (payload == null) return <Typography variant="body2" color="text.secondary">No recorded {payloadType} payload.</Typography>;
    if (isLargePayload(payload)) {
      const filename = `insw-${payloadType}-payload-${logId}.json`;

      return (
        <Box
          sx={{
            bgcolor: 'warning.light',
            color: 'warning.contrastText',
            p: 2,
            borderRadius: 1,
          }}
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            Payload is too large, if you need to review it, please download the json file instead.
          </Typography>
          <Button
            variant="contained"
            color="warning"
            size="small"
            startIcon={<GetApp />}
            onClick={() => downloadJsonPayload(payload, filename)}
          >
            Download JSON Payload
          </Button>
        </Box>
      );
    }

    return (
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
          {JSON.stringify(payload, null, 2)}
        </pre>
      </Box>
    );
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
    if (resendLatch.current) return;
    resendLatch.current = true;
    setResendingId(logId);
    try {
      const res = await fetch(`/api/insw/logs/${logId}/resend`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if ([403, 404, 409].includes(res.status)) {
          // Remove the stale action immediately, even if the authoritative reload fails.
          handleCloseDetailDialog();
          await fetchLogs();
        }
        const fallback = res.status === 403 ? 'Permission denied. Refresh your access before trying again.'
          : res.status === 404 ? 'Log no longer available in this company.'
          : res.status === 409 ? 'Eligibility changed. Review the refreshed queue state.' : 'Gagal mengirim ulang data';
        throw new Error(data.message || data.error || fallback);
      }
      toast.success(res.status === 202 || data.status === 'accepted'
        ? 'Accepted to queue; not delivered' : 'Data berhasil dikirim ulang ke INSW');
      handleCloseDetailDialog();
      await fetchLogs();
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengirim ulang data');
    } finally {
      resendLatch.current = false;
      setResendingId(null);
    }
  };

  function renderQueueState(log: INSWLog) {
    const q = log.current_queue;
    const status = transmissionStatus(log);
    return <Stack spacing={0.5} sx={{ overflowWrap: 'anywhere' }}>
      <Chip label={status.label} color={status.color} size="small" sx={{ alignSelf: 'flex-start' }} />
      <Typography variant="body2">{status.explanation}</Typography>
      {status.provenance && <Typography variant="caption">{status.provenance}</Typography>}
      {status.time && <Typography variant="caption">Last activity: {dayjs(status.time).format('DD-MMMM-YY HH:mm:ss')}</Typography>}
      {q?.error_message && <Typography variant="caption">{transmissionError(q.error_message)}</Typography>}
      {q && !q.latest_log_id && q.id !== log.queue_id && !log.id.startsWith('queue:') && <Button size="small" onClick={() => handleViewDetails({ ...log, id: `queue:${q.id}` })}>View latest transmission</Button>}
      {q?.latest_log_id && q.latest_log_id !== log.id && <Button size="small" onClick={() => handleViewDetails({ ...log, id: q.latest_log_id! })}>View latest transmission</Button>}
    </Stack>;
  }

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
          flexWrap: 'wrap',
          gap: 2,
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
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Tooltip title="Export Excel">
            <span>
              <IconButton onClick={handleExportExcel} color="success" disabled={!exportReady || exporting} aria-label="Export Excel" aria-busy={exporting}>
                {exporting ? <CircularProgress size={20} color="inherit" /> : <GetApp />}
              </IconButton>
            </span>
          </Tooltip>
          <Button onClick={handleExportCsv} color="success" disabled={!exportReady || exportingCsv}
            aria-label="Export CSV (max 100,000 rows)" aria-busy={exportingCsv}
            startIcon={exportingCsv ? <CircularProgress size={16} color="inherit" /> : <GetApp />}>
            Export CSV (max 100,000 rows)
          </Button>
          <Tooltip title="Refresh">
            <IconButton aria-label="Refresh INSW logs" aria-busy={refreshing} onClick={handleRefresh} disabled={refreshing} color="primary">
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
                Historical attempt outcomes — last 7 days
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Historical FAILED includes retries and uncertain delivery; these are not live queue counts.
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
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
            <TextField
              label="Dari Tanggal"
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 160 }}
            />
            <TextField
              label="Sampai Tanggal"
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 160 }}
            />
            <TextField
              select
              label="Transaction Type"
              value={transactionTypeFilter}
              onChange={(e) => { setTransactionTypeFilter(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="ALL">All Types</MenuItem>
              {transactionTypes.map((type) => (
                <MenuItem key={type} value={type}>{type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Status"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="ALL">All Status</MenuItem>
              {statuses.map((status) => (
                <MenuItem key={status} value={status}>{status.replace(/_/g, ' ')}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Search WMS ID"
              value={wmsIdDraft}
              onChange={(e) => setWmsIdDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
              placeholder="Press Enter to search"
              size="small"
              sx={{ width: { xs: '100%', sm: 260 }, maxWidth: '100%' }}
            />
          </Stack>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={logs}
        loading={loading}
        searchable={false}
        pagination={{
          page,
          rowsPerPage,
          onPageChange: handlePageChange,
          onRowsPerPageChange: handleRowsPerPageChange,
          rowsPerPageOptions: [5, 10, 25, 50],
          total: totalCount,
        }}
      />

      <Dialog
        open={detailDialogOpen}
        onClose={handleCloseDetailDialog}
        maxWidth="md"
        fullWidth
        aria-labelledby="insw-detail-title"
      >
        <DialogTitle id="insw-detail-title" sx={{ fontWeight: 'bold' }}>
          Transmission Details
        </DialogTitle>
        <DialogContent dividers sx={{ overflowWrap: 'anywhere' }}>
          {detailError && <Alert severity="error" action={<Button color="inherit" onClick={() => selectedLogId && handleViewDetails({ id: selectedLogId } as INSWLog)}>Retry</Button>}>{detailError}</Alert>}
          {detailLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {selectedLog && selectedLogId === String(selectedLog.id) && !detailLoading && (
            <Box>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Transmission Status
                  </Typography>
                  {renderQueueState(selectedLog)}
                </Box>

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

                {selectedLog.attempt_history && <Box component="section" aria-label="Transmission History">
                  <Typography variant="subtitle2">Transmission History</Typography>
                  <Typography variant="caption">Oldest first. The latest transmission status is shown above.</Typography>
                  {selectedLog.attempt_history.truncated && <Alert severity="info">Showing the first 100 records. Filter by WMS ID to find other logs.</Alert>}
                  {selectedLog.attempt_history.entries.length === 0 && <Typography variant="body2">No transmissions recorded yet.</Typography>}
                  <Stack component="ol" spacing={1} sx={{ pl: 3 }}>
                    {selectedLog.attempt_history.entries.map((entry, index) => {
                      const result = transmissionResult(entry.outcome, entry.delivery_state, entry.provenance);
                      return <Box component="li" key={`${entry.id}:${entry.log_id}`} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                        <Typography variant="body2" fontWeight={600}>Transmission {index + 1} · {result.label}{entry.log_id === selectedLog.id ? ' · selected record' : ''}</Typography>
                        <Typography variant="caption" display="block">{dayjs(entry.completed_at || entry.started_at || entry.claimed_at).format('DD-MMMM-YY HH:mm:ss')}{!entry.started_at ? ' · sending did not start' : ''}</Typography>
                        <Typography variant="body2">{result.explanation}</Typography>
                        {provenanceLabel(entry.provenance) && <Typography variant="caption">{provenanceLabel(entry.provenance)}</Typography>}
                        {entry.reason && <Typography variant="body2">{transmissionError(entry.reason)}</Typography>}
                        {(entry.reason || entry.http_code) && <Box component="details"><Box component="summary">Recorded error</Box><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{entry.http_code ? `HTTP ${entry.http_code}: ` : ''}{entry.reason}</Typography></Box>}
                      </Box>;
                    })}
                  </Stack>
                </Box>}

                {selectedLog.insw_error && (
                  <Box>
                    <Typography variant="subtitle2" color="error">
                      Error Message
                    </Typography>
                    <Typography variant="body2" color="error">
                      {transmissionError(selectedLog.insw_error)}
                    </Typography>
                  </Box>
                )}

                <Box component="details">
                  <Box component="summary" sx={{ cursor: 'pointer' }}>Technical details</Box>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Recorded result: {selectedLog.insw_status} · Reference: {selectedLog.queue_attempt_id || selectedLog.id}</Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{selectedLog.metadata?.endpoint_url}</Typography>
                  {selectedLog.insw_error && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{selectedLog.insw_error}</Typography>}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Request Payload
                      </Typography>
                      {selectedLog.insw_request_payload != null && !isLargePayload(selectedLog.insw_request_payload) && (
                        <Tooltip title={copiedKey === 'payload' ? 'Copied!' : 'Copy'}>
                          <IconButton
                            aria-label="Copy request payload"
                            size="small"
                            onClick={() => handleCopy('payload', selectedLog.insw_request_payload)}
                            sx={{ color: copiedKey === 'payload' ? 'success.main' : 'text.secondary' }}
                          >
                            {copiedKey === 'payload' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                    {renderPayloadContent(selectedLog.insw_request_payload, 'request', selectedLog.id)}
                  </Box>

                  {selectedLog.insw_response && (
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="subtitle2" color="text.secondary">
                          INSW Response
                        </Typography>
                        {!isLargePayload(selectedLog.insw_response) && (
                          <Tooltip title={copiedKey === 'response' ? 'Copied!' : 'Copy'}>
                            <IconButton
                              aria-label="Copy INSW response"
                              size="small"
                              onClick={() => handleCopy('response', selectedLog.insw_response)}
                              sx={{ color: copiedKey === 'response' ? 'success.main' : 'text.secondary' }}
                            >
                              {copiedKey === 'response' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                      {renderPayloadContent(selectedLog.insw_response, 'response', selectedLog.id)}
                    </Box>
                  )}

                </Box>
              </Stack>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          <Box>
            {selectedLog && selectedLog.can_resend === true && (
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
