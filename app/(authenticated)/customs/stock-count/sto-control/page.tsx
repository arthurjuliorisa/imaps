'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/app/components/ToastProvider';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  TablePagination,
  alpha,
  useTheme,
  Chip,
  CircularProgress,
  TextField,
  InputAdornment,
  MenuItem,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { exportToExcelWithHeaders, exportToPDF } from '@/lib/exportUtils';
import { formatQty } from '@/lib/utils/format';

interface StoControlData {
  id: string;
  companyName: string;
  wmsId: string;
  owner: number;
  documentDate: string;
  status: string;
  itemType: string;
  itemCode: string;
  itemName: string;
  uom: string;
  originalBeginningQty: number;
  adjustedBeginningQty: number;
  inQty: number;
  outQty: number;
  originalEndingQty: number;
  adjustedEndingQty: number;
  wmsEndingQty: number;
  varianceAdjustedEnding: number;
  varianceOriginalEnding: number;
  stoCountQty: number;
  adjustmentQty: number;
  finalQty: number;
  reason: string;
}

const EXCEL_HEADERS = [
  { key: 'no', label: 'No', type: 'number' as const },
  { key: 'companyName', label: 'Company', type: 'text' as const },
  { key: 'wmsId', label: 'WMS ID', type: 'text' as const },
  { key: 'owner', label: 'Owner', type: 'number' as const },
  { key: 'documentDate', label: 'Document Date', type: 'date' as const },
  { key: 'status', label: 'Status', type: 'text' as const },
  { key: 'itemType', label: 'Item Type', type: 'text' as const },
  { key: 'itemCode', label: 'Item Code', type: 'text' as const },
  { key: 'itemName', label: 'Item Name', type: 'text' as const },
  { key: 'uom', label: 'UOM', type: 'text' as const },
  { key: 'originalBeginningQty', label: 'Original Beginning', type: 'number' as const },
  { key: 'adjustedBeginningQty', label: 'Adjusted Beginning', type: 'number' as const },
  { key: 'inQty', label: 'In', type: 'number' as const },
  { key: 'outQty', label: 'Out', type: 'number' as const },
  { key: 'originalEndingQty', label: 'Original Ending', type: 'number' as const },
  { key: 'adjustedEndingQty', label: 'Adjusted Ending', type: 'number' as const },
  { key: 'wmsEndingQty', label: 'WMS Ending', type: 'number' as const },
  { key: 'varianceAdjustedEnding', label: 'Variance (Adjusted Ending)', type: 'number' as const },
  { key: 'varianceOriginalEnding', label: 'Variance (Original Ending)', type: 'number' as const },
  { key: 'stoCountQty', label: 'STO Count', type: 'number' as const },
  { key: 'adjustmentQty', label: 'Adjustment', type: 'number' as const },
  { key: 'finalQty', label: 'Final Qty', type: 'number' as const },
  { key: 'reason', label: 'Reason', type: 'text' as const },
];

const PDF_COLUMNS = [
  { header: 'No', dataKey: 'no' },
  { header: 'Company', dataKey: 'companyName' },
  { header: 'WMS ID', dataKey: 'wmsId' },
  { header: 'Owner', dataKey: 'owner' },
  { header: 'Item Code', dataKey: 'itemCode' },
  { header: 'Item Name', dataKey: 'itemName' },
  { header: 'UOM', dataKey: 'uom' },
  { header: 'Orig. Beginning', dataKey: 'originalBeginningQty' },
  { header: 'Adj. Beginning', dataKey: 'adjustedBeginningQty' },
  { header: 'In', dataKey: 'inQty' },
  { header: 'Out', dataKey: 'outQty' },
  { header: 'Orig. Ending', dataKey: 'originalEndingQty' },
  { header: 'Adj. Ending', dataKey: 'adjustedEndingQty' },
  { header: 'WMS Ending', dataKey: 'wmsEndingQty' },
  { header: 'Var. (Adj. End.)', dataKey: 'varianceAdjustedEnding' },
  { header: 'Var. (Orig. End.)', dataKey: 'varianceOriginalEnding' },
  { header: 'STO Count', dataKey: 'stoCountQty' },
  { header: 'Adjustment', dataKey: 'adjustmentQty' },
  { header: 'Final Qty', dataKey: 'finalQty' },
];

const STATUS_OPTIONS = ['PROCESS', 'RELEASED'];

export default function StoControlPage() {
  const theme = useTheme();
  const toast = useToast();

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [data, setData] = useState<StoControlData[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/customs/stock-count/sto-control');
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Error fetching STO control data:', error);
      toast.error('Failed to load STO control data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [searchQuery, selectedStatus]);

  const filteredData = useMemo(() => {
    let filtered = data;

    if (selectedStatus) {
      filtered = filtered.filter((row) => row.status === selectedStatus);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((row) => {
        return (
          row.companyName?.toLowerCase().includes(query) ||
          row.wmsId?.toLowerCase().includes(query) ||
          row.itemCode?.toLowerCase().includes(query) ||
          row.itemName?.toLowerCase().includes(query)
        );
      });
    }

    return filtered;
  }, [data, selectedStatus, searchQuery]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleExportExcel = () => {
    const exportData = filteredData.map((row, index) => ({
      no: index + 1,
      companyName: row.companyName,
      wmsId: row.wmsId,
      owner: row.owner,
      documentDate: row.documentDate,
      status: row.status,
      itemType: row.itemType,
      itemCode: row.itemCode,
      itemName: row.itemName,
      uom: row.uom,
      originalBeginningQty: row.originalBeginningQty,
      adjustedBeginningQty: row.adjustedBeginningQty,
      inQty: row.inQty,
      outQty: row.outQty,
      originalEndingQty: row.originalEndingQty,
      adjustedEndingQty: row.adjustedEndingQty,
      wmsEndingQty: row.wmsEndingQty,
      varianceAdjustedEnding: row.varianceAdjustedEnding,
      varianceOriginalEnding: row.varianceOriginalEnding,
      stoCountQty: row.stoCountQty,
      adjustmentQty: row.adjustmentQty,
      finalQty: row.finalQty,
      reason: row.reason,
    }));

    exportToExcelWithHeaders(
      exportData,
      EXCEL_HEADERS,
      'STO_Adjustment_Control',
      'STO & Adjustment Control'
    );
  };

  const handleExportPDF = () => {
    const exportData = filteredData.map((row, index) => ({
      no: index + 1,
      companyName: row.companyName,
      wmsId: row.wmsId,
      owner: row.owner,
      itemCode: row.itemCode,
      itemName: row.itemName,
      uom: row.uom,
      originalBeginningQty: formatQty(row.originalBeginningQty),
      adjustedBeginningQty: formatQty(row.adjustedBeginningQty),
      inQty: formatQty(row.inQty),
      outQty: formatQty(row.outQty),
      originalEndingQty: formatQty(row.originalEndingQty),
      adjustedEndingQty: formatQty(row.adjustedEndingQty),
      wmsEndingQty: formatQty(row.wmsEndingQty),
      varianceAdjustedEnding: formatQty(row.varianceAdjustedEnding),
      varianceOriginalEnding: formatQty(row.varianceOriginalEnding),
      stoCountQty: formatQty(row.stoCountQty),
      adjustmentQty: formatQty(row.adjustmentQty),
      finalQty: formatQty(row.finalQty),
    }));

    exportToPDF(
      exportData,
      PDF_COLUMNS,
      'STO_Adjustment_Control',
      'STO & Adjustment Control'
    );
  };

  const paginatedData = filteredData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const getVarianceColor = (value: number) => {
    if (value > 0) return theme.palette.success.main;
    if (value < 0) return theme.palette.error.main;
    return 'text.primary';
  };

  const getStatusColor = (status: string): 'warning' | 'success' | 'default' => {
    if (status === 'PROCESS') return 'warning';
    if (status === 'RELEASED') return 'success';
    return 'default';
  };

  return (
    <ReportLayout
      title="STO & Adjustment Control"
      subtitle="Kontrol rekonsiliasi STO dan Adjustment"
      actions={
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <ExportButtons
            onExportExcel={handleExportExcel}
            onExportPDF={handleExportPDF}
            disabled={filteredData.length === 0 || loading}
          />
        </Box>
      }
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3, mb: 3, px: 3, gap: 2 }}>
        <TextField
          select
          label="Filter Status"
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          size="small"
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">Semua Status</MenuItem>
          {STATUS_OPTIONS.map((status) => (
            <MenuItem key={status} value={status}>
              {status}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          placeholder="Search by company, WMS ID, item code, item name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          size="small"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
          sx={{ maxWidth: 420 }}
        />
      </Box>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer>
          <Table sx={{ minWidth: 650 }} aria-label="sto control table">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Company</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>WMS ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Owner</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>UOM</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Original Beginning</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Adjusted Beginning</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">In</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Out</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Original Ending</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Adjusted Ending</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">WMS Ending</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Variance (Adjusted Ending)</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Variance (Original Ending)</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">STO Count</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Adjustment</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Final Qty</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={21} align="center" sx={{ py: 8 }}>
                    <Typography variant="body1" color="text.secondary">
                      No records found
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedData.map((row, index) => (
                  <TableRow
                    key={`${row.id}-${index}`}
                    sx={{
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.04),
                      },
                    }}
                  >
                    <TableCell>{page * rowsPerPage + index + 1}</TableCell>
                    <TableCell>{row.companyName}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {row.wmsId || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.owner}</TableCell>
                    <TableCell>
                      <Chip
                        label={row.status || '-'}
                        size="small"
                        color={getStatusColor(row.status)}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {row.itemType || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {row.itemCode}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.itemName}</TableCell>
                    <TableCell>
                      <Chip label={row.uom || '-'} size="small" />
                    </TableCell>
                    <TableCell align="right">{formatQty(row.originalBeginningQty)}</TableCell>
                    <TableCell align="right">{formatQty(row.adjustedBeginningQty)}</TableCell>
                    <TableCell align="right">{formatQty(row.inQty)}</TableCell>
                    <TableCell align="right">{formatQty(row.outQty)}</TableCell>
                    <TableCell align="right">{formatQty(row.originalEndingQty)}</TableCell>
                    <TableCell align="right">{formatQty(row.adjustedEndingQty)}</TableCell>
                    <TableCell align="right">{formatQty(row.wmsEndingQty)}</TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        sx={{ color: getVarianceColor(row.varianceAdjustedEnding) }}
                      >
                        {row.varianceAdjustedEnding > 0 ? '+' : ''}{formatQty(row.varianceAdjustedEnding)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        sx={{ color: getVarianceColor(row.varianceOriginalEnding) }}
                      >
                        {row.varianceOriginalEnding > 0 ? '+' : ''}{formatQty(row.varianceOriginalEnding)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{formatQty(row.stoCountQty)}</TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        sx={{ color: getVarianceColor(row.adjustmentQty) }}
                      >
                        {row.adjustmentQty > 0 ? '+' : ''}{formatQty(row.adjustmentQty)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{formatQty(row.finalQty)}</TableCell>
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
        count={filteredData.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </ReportLayout>
  );
}
