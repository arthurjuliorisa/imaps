'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  Grid,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { Visibility as VisibilityIcon } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { useToast } from '@/app/components/ToastProvider';
import { exportToExcelWithHeaders, formatDate } from '@/lib/exportUtils';
import { formatQty } from '@/lib/utils/format';

interface ReversalRecord {
  id: number;
  transactionDate: string;
  wmsId: string;
  internalEvidenceNumber: string;
  companyName: string;
  owner: number;
  directionSummary: 'GAIN' | 'LOSS' | 'Mixed';
  itemCount: number;
  totalGainQty: number;
  totalLossQty: number;
  createdAt: string;
  inswStatus: string | null;
}

interface ReversalDetail {
  id: number;
  wmsId: string;
  companyName: string;
  owner: number;
  internalEvidenceNumber: string;
  transactionDate: string;
  timestamp: string;
  wmsDocType: string;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: number;
    itemType: string;
    itemCode: string;
    itemName: string;
    uom: string;
    adjustmentType: 'GAIN' | 'LOSS';
    qty: number;
    signedStockImpact: number;
    amount: number | null;
    reason: string | null;
  }>;
  insw: {
    latestStatus: string;
    activityCode: string | null;
    sentTime: string | null;
    errorMessage: string | null;
    retryCount: number;
  } | null;
}

const EXCEL_HEADERS = [
  { key: 'no', label: 'No', type: 'number' as const },
  { key: 'transactionDate', label: 'Transaction Date', type: 'date' as const },
  { key: 'wmsId', label: 'WMS ID', type: 'text' as const },
  { key: 'internalEvidenceNumber', label: 'Internal Evidence Number', type: 'text' as const },
  { key: 'companyName', label: 'Company', type: 'text' as const },
  { key: 'owner', label: 'Owner', type: 'number' as const },
  { key: 'directionSummary', label: 'Adjustment Direction Summary', type: 'text' as const },
  { key: 'itemCount', label: 'Item Count', type: 'number' as const },
  { key: 'totalGainQty', label: 'Total GAIN Quantity', type: 'number' as const },
  { key: 'totalLossQty', label: 'Total LOSS Quantity', type: 'number' as const },
  { key: 'inswStatus', label: 'INSW Status', type: 'text' as const },
  { key: 'createdAt', label: 'Created At', type: 'date' as const },
];

const directionColor = {
  GAIN: 'success',
  LOSS: 'error',
  Mixed: 'warning',
} as const;

export default function ReversalRecordPage() {
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<ReversalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ReversalDetail | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    wmsId: '',
    internalEvidenceNumber: '',
    direction: '',
    itemCode: '',
    itemName: '',
    inswStatus: '',
  });

  useEffect(() => {
    const checkPermission = async () => {
      const response = await fetch('/api/settings/access-menu/current-user-menus');
      if (!response.ok) return;
      const menus = await response.json();
      const hasAccess = menus.some((menu: any) => menu.menuPath === '/customs/reversal-record');
      if (!hasAccess) {
        router.replace('/access-denied');
      }
    };

    checkPermission();
  }, [router]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page + 1),
      pageSize: String(rowsPerPage),
    });

    Object.entries(filters).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim());
    });

    return params.toString();
  }, [filters, page, rowsPerPage]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/customs/reversal-record?${queryString}`);
      if (!response.ok) throw new Error('Failed to fetch reversal records');
      const result = await response.json();
      setRows(result.data || []);
      setTotal(result.pagination?.total || 0);
    } catch (error) {
      console.error('Error fetching reversal records:', error);
      toast.error('Failed to load reversal records');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [queryString, toast]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
  };

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/customs/reversal-record/${id}`);
      if (!response.ok) throw new Error('Failed to fetch reversal record detail');
      setDetail(await response.json());
    } catch (error) {
      console.error('Error fetching reversal detail:', error);
      toast.error('Failed to load reversal detail');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleExportExcel = () => {
    const exportData = rows.map((row, index) => ({
      no: page * rowsPerPage + index + 1,
      transactionDate: row.transactionDate,
      wmsId: row.wmsId,
      internalEvidenceNumber: row.internalEvidenceNumber,
      companyName: row.companyName,
      owner: row.owner,
      directionSummary: row.directionSummary,
      itemCount: row.itemCount,
      totalGainQty: row.totalGainQty,
      totalLossQty: row.totalLossQty,
      inswStatus: row.inswStatus || '',
      createdAt: row.createdAt,
    }));

    exportToExcelWithHeaders(exportData, EXCEL_HEADERS, 'Reversal_Record', 'Reversal Record');
  };

  return (
    <ReportLayout
      title="Reversal Record"
      subtitle="Revision adjustment transactions"
      actions={
        <ExportButtons
          onExportExcel={handleExportExcel}
          onExportPDF={() => undefined}
          disabled={rows.length === 0 || loading}
          pdfDisabled
        />
      }
    >
      <Grid container spacing={2} sx={{ mt: 3, mb: 3, px: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField fullWidth size="small" label="Start Date" type="date" value={filters.startDate} onChange={(e) => updateFilter('startDate', e.target.value)} InputLabelProps={{ shrink: true }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField fullWidth size="small" label="End Date" type="date" value={filters.endDate} onChange={(e) => updateFilter('endDate', e.target.value)} InputLabelProps={{ shrink: true }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField fullWidth size="small" label="WMS ID" value={filters.wmsId} onChange={(e) => updateFilter('wmsId', e.target.value)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField fullWidth size="small" label="Internal Evidence Number" value={filters.internalEvidenceNumber} onChange={(e) => updateFilter('internalEvidenceNumber', e.target.value)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField fullWidth select size="small" label="Direction" value={filters.direction} onChange={(e) => updateFilter('direction', e.target.value)}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="GAIN">GAIN</MenuItem>
            <MenuItem value="LOSS">LOSS</MenuItem>
            <MenuItem value="Mixed">Mixed</MenuItem>
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField fullWidth size="small" label="Item Code" value={filters.itemCode} onChange={(e) => updateFilter('itemCode', e.target.value)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField fullWidth size="small" label="Item Name" value={filters.itemName} onChange={(e) => updateFilter('itemName', e.target.value)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField fullWidth select size="small" label="INSW Status" value={filters.inswStatus} onChange={(e) => updateFilter('inswStatus', e.target.value)}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="PENDING">PENDING</MenuItem>
            <MenuItem value="SUCCESS">SUCCESS</MenuItem>
            <MenuItem value="FAILED">FAILED</MenuItem>
            <MenuItem value="SKIPPED">SKIPPED</MenuItem>
          </TextField>
        </Grid>
      </Grid>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer>
          <Table sx={{ minWidth: 1100 }} aria-label="reversal record table">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                <TableCell sx={{ fontWeight: 600 }}>Transaction Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>WMS ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Internal Evidence Number</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Company</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Owner</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Direction</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Item Count</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Total GAIN</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Total LOSS</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created At</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>INSW Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} align="center" sx={{ py: 8 }}>
                    <Typography color="text.secondary">No reversal records found</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>{formatDate(row.transactionDate)}</TableCell>
                    <TableCell>{row.wmsId}</TableCell>
                    <TableCell>{row.internalEvidenceNumber}</TableCell>
                    <TableCell>{row.companyName}</TableCell>
                    <TableCell>{row.owner}</TableCell>
                    <TableCell><Chip size="small" color={directionColor[row.directionSummary]} label={row.directionSummary} /></TableCell>
                    <TableCell align="right">{row.itemCount}</TableCell>
                    <TableCell align="right">{formatQty(row.totalGainQty)}</TableCell>
                    <TableCell align="right">{formatQty(row.totalLossQty)}</TableCell>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell>{row.inswStatus ? <Chip size="small" label={row.inswStatus} /> : '-'}</TableCell>
                    <TableCell>
                      <Button size="small" startIcon={<VisibilityIcon />} onClick={() => openDetail(row.id)}>
                        Detail
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <TablePagination
        rowsPerPageOptions={[5, 10, 25, 50]}
        component="div"
        count={total}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={(_event, nextPage) => setPage(nextPage)}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(parseInt(event.target.value, 10));
          setPage(0);
        }}
      />

      <Drawer anchor="right" open={!!detail || detailLoading} onClose={() => setDetail(null)} PaperProps={{ sx: { width: { xs: '100%', md: 720 }, p: 3 } }}>
        {detailLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
            <CircularProgress />
          </Box>
        ) : detail ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6">Reversal Detail</Typography>
              <Typography color="text.secondary">{detail.wmsId}</Typography>
            </Box>
            <Grid container spacing={2}>
              {[
                ['Company', detail.companyName],
                ['Owner', detail.owner],
                ['Internal Evidence Number', detail.internalEvidenceNumber],
                ['Transaction Date', formatDate(detail.transactionDate)],
                ['Timestamp', formatDate(detail.timestamp)],
                ['WMS Document Type', detail.wmsDocType],
                ['Created At', formatDate(detail.createdAt)],
                ['Updated At', formatDate(detail.updatedAt)],
              ].map(([label, value]) => (
                <Grid key={String(label)} size={{ xs: 12, sm: 6 }}>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                  <Typography variant="body2" fontWeight={600}>{String(value || '-')}</Typography>
                </Grid>
              ))}
            </Grid>

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>Items</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Item</TableCell>
                      <TableCell>UOM</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell align="right">Signed Impact</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell>Reason</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>{item.itemCode}</Typography>
                          <Typography variant="caption" color="text.secondary">{item.itemType} · {item.itemName}</Typography>
                        </TableCell>
                        <TableCell>{item.uom}</TableCell>
                        <TableCell><Chip size="small" label={item.adjustmentType} color={item.adjustmentType === 'GAIN' ? 'success' : 'error'} /></TableCell>
                        <TableCell align="right">{formatQty(item.qty)}</TableCell>
                        <TableCell align="right">{item.signedStockImpact > 0 ? '+' : ''}{formatQty(item.signedStockImpact)}</TableCell>
                        <TableCell align="right">{item.amount === null ? '-' : formatQty(item.amount)}</TableCell>
                        <TableCell>{item.reason || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>INSW</Typography>
              {detail.insw ? (
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}><Typography variant="caption" color="text.secondary">Latest Status</Typography><Typography>{detail.insw.latestStatus}</Typography></Grid>
                  <Grid size={{ xs: 12, sm: 6 }}><Typography variant="caption" color="text.secondary">Activity Code</Typography><Typography>{detail.insw.activityCode || '-'}</Typography></Grid>
                  <Grid size={{ xs: 12, sm: 6 }}><Typography variant="caption" color="text.secondary">Sent Time</Typography><Typography>{detail.insw.sentTime ? formatDate(detail.insw.sentTime) : '-'}</Typography></Grid>
                  <Grid size={{ xs: 12, sm: 6 }}><Typography variant="caption" color="text.secondary">Retry Count</Typography><Typography>{detail.insw.retryCount}</Typography></Grid>
                  <Grid size={{ xs: 12 }}><Typography variant="caption" color="text.secondary">Error Message</Typography><Typography>{detail.insw.errorMessage || '-'}</Typography></Grid>
                </Grid>
              ) : (
                <Typography color="text.secondary">No INSW transmission log found</Typography>
              )}
            </Box>
          </Box>
        ) : null}
      </Drawer>
    </ReportLayout>
  );
}
