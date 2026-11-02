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
  CircularProgress,
} from '@mui/material';
import { Refresh, Visibility, ContentCopy, Check, GetApp, Replay as ReplayIcon } from '@mui/icons-material';
import { DataTable, Column } from '@/app/components/DataTable';
import { useToast } from '@/app/components/ToastProvider';
import { useSession } from 'next-auth/react';
import dayjs from 'dayjs';
import type { WmsInswStatus } from '@/lib/insw-queue/wms-log-status';
import { regenerationMessage, REGENERATION_SUCCESS } from '@/lib/insw-regeneration-messages';
import { WMS_INSW_STATUSES } from '@/lib/wms-insw-status-options';
import { wmsLogFilterParams } from '@/lib/wms-log-filters';

interface WMSTransmissionLog {
  insw?: WmsInswStatus;
  id: string;
  activity_log_id: string;
  action: string;
  wms_id: string | null;
  company_code: number | null;
  transmission_status: 'SUCCESS' | 'FAILED' | 'ERROR' | 'UNKNOWN' | 'RETRYING';
  wms_request_payload: any;
  imaps_error_response: any;
  error_type: string | null;
  summary: string;
  item_count: number | null;
  created_at: string;
  expires_at: string;
}

interface Company {
  code: number;
  name: string;
}

export default function WMSTransmissionLogsPage() {
  const theme = useTheme();
  const toast = useToast();
  const { data: session } = useSession();

  const [logs, setLogs] = useState<WMSTransmissionLog[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('ALL');
  const [errorTypeFilter, setErrorTypeFilter] = useState('ALL');
  const [transmissionStatusFilter, setTransmissionStatusFilter] = useState('ALL');
  const [inswStatusFilter, setInswStatusFilter] = useState('ALL');
  const [wmsIdSearch, setWmsIdSearch] = useState('');
  const [appliedWmsIdSearch, setAppliedWmsIdSearch] = useState('');
  const [filterOptions, setFilterOptions] = useState({
    actions: [] as string[],
    transmissionStatuses: [] as string[],
    errorTypes: [] as string[],
  });
  const [companyCodeFilter, setCompanyCodeFilter] = useState<string>('ALL');
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<WMSTransmissionLog | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(dayjs().subtract(7, 'days').format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [confirmRetryOpen, setConfirmRetryOpen] = useState(false);
  const [pendingRetryLog, setPendingRetryLog] = useState<WMSTransmissionLog | null>(null);
  const [retryingDialog, setRetryingDialog] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerationReason, setRegenerationReason] = useState('');
  const [regenerationError, setRegenerationError] = useState<string | null>(null);
 
  const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN';
  const userCompanyCode = session?.user?.companyCode as string | undefined;

  const retryableActions = new Set([
    'WMS_PROCESS_INCOMING_GOODS',
    'WMS_PROCESS_OUTGOING_GOODS',
    'WMS_PROCESS_MATERIAL_USAGE',
    'WMS_PROCESS_PRODUCTION_OUTPUT',
    'WMS_PROCESS_ADJUSTMENTS',
    'WMS_PROCESS_WIP_BALANCE',
  ]);
  const retryableErrorTypes = new Set(['ASYNC_PROCESSING_ERROR', 'ASYNC_RETRY_ERROR']);

  const isFailedRetryableLog = (log: WMSTransmissionLog) =>
    (log.transmission_status === 'FAILED' || log.transmission_status === 'ERROR') &&
    retryableActions.has(log.action) &&
    !!log.error_type &&
    retryableErrorTypes.has(log.error_type);

  const getRetryTooltip = (log: WMSTransmissionLog) => {
    if (!isFailedRetryableLog(log)) return 'Retry is only available for failed async WMS processing logs';
    if (!log.wms_request_payload) return 'Retry unavailable because original payload was not stored for this log.';
    return 'Retry WMS processing';
  };

  const canRetryLog = (log: WMSTransmissionLog) => isFailedRetryableLog(log) && !!log.wms_request_payload;

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
      label: 'WMS Status',
      minWidth: 120,
      format: (value: string) => {
        let color: 'success' | 'error' | 'warning' | 'default' = 'default';
        const label = value || 'UNKNOWN';
        if (value === 'SUCCESS') color = 'success';
        else if (value === 'FAILED') color = 'error';
        else if (value === 'ERROR') color = 'error';
        else if (value === 'UNKNOWN' || value === 'RETRYING') color = 'warning';

        return (
          <Tooltip title="WMS ingress status: local acceptance is separate from INSW delivery.">
            <Chip label={label} color={color} size="small" variant="outlined" sx={{ fontWeight: 'bold' }} />
          </Tooltip>
        );
      },
    },
    {
      id: 'insw',
      label: 'INSW Status',
      minWidth: 210,
      format: (_value: unknown, row: WMSTransmissionLog) => row.insw ? (
        <Tooltip title={row.insw.explanation}>
          <Chip label={row.insw.label} size="small" variant="outlined"
            color={row.insw.label === 'Succeeded' ? 'success' : row.insw.label === 'Failed' ? 'error' : 'default'} />
        </Tooltip>
      ) : '—',
    },
    {
      id: 'wms_id',
      label: 'WMS ID',
      minWidth: 150,
      format: (value: any) => value || '-',
    },
    {
      id: 'company_code',
      label: 'Company Code',
      minWidth: 120,
      format: (value: any) => {
        if (!value) return '-';
        const company = companies.find((c) => c.code === value);
        return company ? `${company.name} (${value})` : value;
      },
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
      minWidth: 140,
      format: (value: any, row: any) => (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="View Details">
            <IconButton
              size="small"
              color="primary"
              onClick={() => handleViewDetails(row as WMSTransmissionLog)}
            >
              <Visibility fontSize="small" />
            </IconButton>
          </Tooltip>
          {isFailedRetryableLog(row as WMSTransmissionLog) && (
            <Tooltip title={getRetryTooltip(row as WMSTransmissionLog)}>
              <span>
                <IconButton
                  size="small"
                  color="warning"
                  onClick={() => {
                    setPendingRetryLog(row as WMSTransmissionLog);
                    setConfirmRetryOpen(true);
                  }}
                  disabled={!canRetryLog(row as WMSTransmissionLog) || retryingId === String((row as WMSTransmissionLog).id)}
                >
                  {retryingId === String((row as WMSTransmissionLog).id)
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
    fetchCompanies();
    // Set default company filter for non-SUPER_ADMIN
    if (!isSuperAdmin && userCompanyCode) {
      setCompanyCodeFilter(userCompanyCode);
    }
  }, [isSuperAdmin, userCompanyCode]);

  useEffect(() => {
    fetchLogs();
  }, [appliedWmsIdSearch, actionFilter, errorTypeFilter, transmissionStatusFilter, inswStatusFilter, companyCodeFilter, dateFrom, dateTo, page, rowsPerPage]);

  // Dropdown options apply to the authorized date/company dataset rather than
  // the current page or selected row filters, so refresh them only when that
  // dataset changes.
  useEffect(() => {
    fetchFilterMetadata();
  }, [companyCodeFilter, dateFrom, dateTo]);

  const fetchCompanies = async () => {
    try {
      const response = await fetch('/api/settings/companies');
      const data = await response.json();
      if (Array.isArray(data)) {
        setCompanies(data);
      }
    } catch (err) {
      console.error('Error fetching companies:', err);
    }
  };

  const activeFilterParams = () => wmsLogFilterParams({ dateFrom, dateTo, appliedWmsIdSearch,
    actionFilter, errorTypeFilter, transmissionStatusFilter, inswStatusFilter, companyCodeFilter });

  const handleExportCsv = async () => {
    if (exportingCsv) return;
    setExportingCsv(true);
    try {
      const response = await fetch(`/api/settings/wms-transmission-logs/export/csv?${activeFilterParams()}`);
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || result?.message || 'Unable to export WMS CSV');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'wms-logs.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('WMS CSV exported successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to export WMS CSV');
    } finally { setExportingCsv(false); }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = activeFilterParams();
      params.set('page', String(page + 1));
      params.set('limit', String(rowsPerPage));
      params.set('include_filters', 'false');

      const response = await fetch(`/api/settings/wms-transmission-logs?${params}`);
      const result = await response.json();

      if (result.success && Array.isArray(result.data)) {
        setLogs(result.data);
        if (selectedLog) setSelectedLog(result.data.find((log: WMSTransmissionLog) => log.id === selectedLog.id) || null);
        setTotalCount(result.pagination?.total || 0);
        setError(null);
      } else {
        setLogs([]);
        setTotalCount(0);
        setError(result.error || 'Failed to fetch logs');
      }
    } catch (err) {
      console.error('Error fetching WMS transmission logs:', err);
      setLogs([]);
      setTotalCount(0);
      setError('Failed to fetch WMS transmission logs');
    } finally {
      setLoading(false);
    }
  };

  const fetchFilterMetadata = async () => {
    try {
      const params = new URLSearchParams({
        metadata_only: 'true',
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo + 'T23:59:59' }),
        ...(companyCodeFilter !== 'ALL' && { company_code: companyCodeFilter }),
      });
      const response = await fetch(`/api/settings/wms-transmission-logs?${params}`);
      const result = await response.json();

      if (result.success) {
        setFilterOptions({
          actions: result.filters?.actions || [],
          transmissionStatuses: result.filters?.transmissionStatuses || [],
          errorTypes: result.filters?.errorTypes || [],
        });
      }
    } catch (err) {
      console.error('Error fetching WMS transmission log filter metadata:', err);
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleSearch = () => {
    setAppliedWmsIdSearch(wmsIdSearch.trim());
    setPage(0);
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSearch();
  };

  const handleFilterChange = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setter(event.target.value);
    setPage(0);
  };

  const handleDateChange = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setter(event.target.value);
    setPage(0);
  };

  const handleRefresh = () => {
    fetchLogs();
    toast.success('WMS transmission logs refreshed');
  };

  const handleViewDetails = (log: WMSTransmissionLog) => {
    setSelectedLog(log);
    setRegenerationError(null);
    setRegenerationReason('');
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

  const handleRetry = async (log: WMSTransmissionLog) => {
    setRetryingId(String(log.id));
    try {
      const response = await fetch(`/api/settings/wms-transmission-logs/${log.id}/retry`, {
        method: 'POST',
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to retry WMS processing');
      }

      toast.success(result.message || 'WMS payload reprocessed successfully');
      await fetchLogs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to retry WMS processing');
      await fetchLogs();
    } finally {
      setRetryingId(null);
    }
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
          <Button variant="outlined" onClick={handleExportCsv} disabled={exportingCsv || loading}
            startIcon={exportingCsv ? <CircularProgress size={16} /> : <GetApp />}
            aria-label="Export CSV (max 100,000 rows)" aria-busy={exportingCsv}>
            Export CSV (max 100,000 rows)
          </Button>
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
          <Stack component="form" direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }} onSubmit={handleSearchSubmit}>
            <TextField
              label="Dari Tanggal"
              type="date"
              value={dateFrom}
              onChange={handleDateChange(setDateFrom)}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 160 }}
            />
            <TextField
              label="Sampai Tanggal"
              type="date"
              value={dateTo}
              onChange={handleDateChange(setDateTo)}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 160 }}
            />
            <TextField
              label="Search WMS ID"
              value={wmsIdSearch}
              onChange={(e) => setWmsIdSearch(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleSearch();
                }
              }}
              size="small"
              sx={{
                width: { xs: '100%', sm: '20rem' },
                maxWidth: '100%',
                flex: { xs: '0 0 auto', sm: '0 1 20rem' },
              }}
            />
            <TextField
              select
              label="Action"
              value={actionFilter}
              onChange={handleFilterChange(setActionFilter)}
              size="small"
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="ALL">All Actions</MenuItem>
              {filterOptions.actions.map((action) => (
                <MenuItem key={action} value={action}>
                  {action.replace('WMS_', '').replace('_ERROR', '')}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="WMS Status"
              value={transmissionStatusFilter}
              onChange={handleFilterChange(setTransmissionStatusFilter)}
              size="small"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="ALL">All WMS Status</MenuItem>
              {filterOptions.transmissionStatuses.map((status) => (
                <MenuItem key={status} value={status}>{status}</MenuItem>
              ))}
            </TextField>
            <TextField select label="INSW Status" value={inswStatusFilter}
              onChange={handleFilterChange(setInswStatusFilter)} size="small" sx={{ minWidth: 220 }}>
              <MenuItem value="ALL">All INSW Status</MenuItem>
              {WMS_INSW_STATUSES.map(status => <MenuItem key={status} value={status}>{status}</MenuItem>)}
            </TextField>
            <TextField
              select
              label="Error Type"
              value={errorTypeFilter}
              onChange={handleFilterChange(setErrorTypeFilter)}
              size="small"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="ALL">All Error Types</MenuItem>
              {filterOptions.errorTypes.map((errorType) => (
                <MenuItem key={errorType} value={errorType}>{errorType}</MenuItem>
              ))}
            </TextField>
            {isSuperAdmin && (
              <TextField
                select
                label="Company Code"
                value={companyCodeFilter}
                onChange={handleFilterChange(setCompanyCodeFilter)}
                size="small"
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="ALL">All Companies</MenuItem>
                {companies.map((company) => (
                  <MenuItem key={company.code} value={company.code.toString()}>
                    {company.name} ({company.code})
                  </MenuItem>
                ))}
              </TextField>
            )}
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
                    WMS Status
                  </Typography>
                  <Chip
                    label={selectedLog.transmission_status || 'UNKNOWN'}
                    color={
                      selectedLog.transmission_status === 'SUCCESS'
                        ? 'success'
                        : selectedLog.transmission_status === 'FAILED' || selectedLog.transmission_status === 'ERROR'
                        ? 'error'
                        : selectedLog.transmission_status === 'RETRYING'
                        ? 'warning'
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

                {selectedLog.insw && (
                  <Box>
                    <Typography variant="subtitle2">INSW transmission: {selectedLog.insw.label}</Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>{selectedLog.insw.explanation}</Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      {selectedLog.insw.workerAuthorized
                        ? 'Company is included in this application process worker fence.'
                        : 'Worker authorization is not established in this application process.'}
                    </Typography>
                    {selectedLog.insw.canInspectRegeneration && selectedLog.insw.label === 'Not queued' && (
                      <Tooltip title={selectedLog.insw.regenerationBlock}>
                        <span tabIndex={0} aria-label={selectedLog.insw.regenerationBlock}><Button disabled={!selectedLog.insw.canRegenerate || regenerating} sx={{ mt: 1 }} onClick={() => setConfirmRegenerate(true)}>Regenerate INSW Transmission</Button></span>
                      </Tooltip>
                    )}
                    {regenerationError && <Alert severity="error" role="alert" sx={{ mt: 1 }}>{regenerationError}</Alert>}
                    {selectedLog.insw.canViewInswLogs && (
                      <Button href="/insw/logs" sx={{ mt: 1 }}>Open INSW Logs</Button>
                    )}
                  </Box>
                )}

                {selectedLog.wms_request_payload && (
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
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          <Box>
            {selectedLog && isFailedRetryableLog(selectedLog) && (
              <Tooltip title={getRetryTooltip(selectedLog)}>
                <span>
                  <Button
                    onClick={() => {
                      setPendingRetryLog(selectedLog);
                      setConfirmRetryOpen(true);
                    }}
                    color="warning"
                    variant="contained"
                    disabled={!canRetryLog(selectedLog) || retryingDialog}
                    startIcon={retryingDialog ? <CircularProgress size={16} /> : <ReplayIcon />}
                  >
                    Retry Processing
                  </Button>
                </span>
              </Tooltip>
            )}
          </Box>
          <Button onClick={handleCloseDetailDialog} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog fullWidth maxWidth="sm" aria-labelledby="regenerate-insw-title" aria-describedby="regenerate-insw-confirmation" open={confirmRegenerate} onClose={() => { if (!regenerating) setConfirmRegenerate(false); }}>
        <DialogTitle id="regenerate-insw-title">Regenerate INSW Transmission</DialogTitle>
        <DialogContent>
          <Typography>WMS {selectedLog?.wms_id} · Company {selectedLog?.company_code} · {selectedLog?.action} · Destination {selectedLog?.insw?.regenerationDestination}</Typography>
          <TextField autoFocus required fullWidth label="Reason" placeholder="Enter the reason for regeneration" value={regenerationReason}
            disabled={regenerating} onChange={event => setRegenerationReason(event.target.value)} inputProps={{ maxLength: 500 }} sx={{ mt: 2 }} />
          <Typography id="regenerate-insw-confirmation" sx={{ mt: 2 }}>Have you checked this transaction on the official INSW website and confirmed that it has not already been transmitted?</Typography>
          {regenerationError && <Alert severity="error" role="alert" sx={{ mt: 2 }}>{regenerationError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button disabled={regenerating} onClick={() => setConfirmRegenerate(false)}>Cancel</Button>
          <Button variant="contained" disabled={regenerating || !regenerationReason.trim() || !selectedLog?.insw?.canRegenerate} onClick={async () => {
            if (!selectedLog || regenerating || !regenerationReason.trim()) return;
            setRegenerating(true);
            setRegenerationError(null);
            let failureMessage = regenerationMessage(undefined);
            try {
              const response = await fetch(`/api/settings/wms-transmission-logs/${selectedLog.id}/regenerate-insw`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: regenerationReason }),
              });
              const result = await response.json();
              if (!response.ok) { failureMessage = regenerationMessage(result.code); throw new Error(failureMessage); }
              toast.success(REGENERATION_SUCCESS);
              setConfirmRegenerate(false);
              setDetailDialogOpen(false);
            } catch {
              setRegenerationError(failureMessage);
            } finally {
              await fetchLogs();
              setRegenerating(false);
            }
          }}>{regenerating ? 'Queuing…' : 'Confirm Regeneration'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmRetryOpen} onClose={() => setConfirmRetryOpen(false)}>
        <DialogTitle>Confirm WMS Retry</DialogTitle>
        <DialogContent>
          <Typography>
            Retry internal WMS processing for this stored payload? This replays the original WMS payload through the current transaction logic.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setConfirmRetryOpen(false);
              setPendingRetryLog(null);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={async () => {
              if (!pendingRetryLog) return;
              const isFromDialog = selectedLog && selectedLog.id === pendingRetryLog.id;
              setConfirmRetryOpen(false);
              if (isFromDialog) setRetryingDialog(true);
              await handleRetry(pendingRetryLog);
              if (isFromDialog) {
                setRetryingDialog(false);
                setDetailDialogOpen(false);
              }
              setPendingRetryLog(null);
            }}
            color="warning"
            variant="contained"
          >
            Retry
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
