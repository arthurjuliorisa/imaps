'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
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
import { exportToExcelWithHeaders, exportToPDF, formatDate, formatDateShort } from '@/lib/exportUtils';
import { formatQty } from '@/lib/utils/format';
import { canViewSystemQty } from '@/lib/utils/user-role.util';

interface StockOpnameData {
  id: string;
  companyName: string;
  docDate: Date;
  status: string;
  stoWmsId: string;
  typeCode: string;
  itemCodeBahasa: string;
  itemCode: string;
  itemName: string;
  unit: string;
  
  // ✅ v3.4.0: Reconciliation fields (INTERNAL ONLY)
  beginningQty?: number;
  incomingQtyOnDate?: number;
  outgoingQtyOnDate?: number;
  systemQty?: number;
  actualQtyCount?: number; // WMS ending
  varianceQty?: number;
  
  // ✅ v3.4.0: History tracking fields (INTERNAL ONLY)
  originalBeginningQty?: number | null;
  originalSystemQty?: number | null;
  isAdjusted?: boolean;
  adjustmentAppliedAt?: string | null;
  
  valueAmount: number;
  reason: string;
}

const getExcelHeaders = (canShowSystemQty: boolean) => [
  { key: 'no', label: 'No', type: 'number' as const },
  { key: 'companyName', label: 'Company Name', type: 'text' as const },
  { key: 'docDate', label: 'Tanggal Pelaksanaan', type: 'date' as const },
  { key: 'status', label: 'Status', type: 'text' as const },
  { key: 'stoWmsId', label: 'STO WMS ID', type: 'text' as const },
  { key: 'typeCode', label: 'Kategori Barang', type: 'text' as const },
  { key: 'itemCode', label: 'Kode Barang', type: 'text' as const },
  { key: 'itemName', label: 'Nama Barang', type: 'text' as const },
  { key: 'unit', label: 'Satuan Barang', type: 'text' as const },
  // ✅ v3.4.0: Reconciliation columns (INTERNAL ONLY)
  ...(canShowSystemQty ? [
    { key: 'beginningQty', label: 'Beginning', type: 'number' as const },
    { key: 'incomingQtyOnDate', label: 'Incoming', type: 'number' as const },
    { key: 'outgoingQtyOnDate', label: 'Outgoing', type: 'number' as const },
    { key: 'systemQty', label: 'System Ending', type: 'number' as const },
    { key: 'actualQtyCount', label: 'WMS Ending', type: 'number' as const },
    { key: 'varianceQty', label: 'Variance', type: 'number' as const },
  ] : []),
  { key: 'reason', label: 'Keterangan', type: 'text' as const },
];

const getPdfColumns = (canShowSystemQty: boolean) => [
  { header: 'No', dataKey: 'no' },
  { header: 'Company Name', dataKey: 'companyName' },
  { header: 'Tanggal Pelaksanaan', dataKey: 'docDate' },
  { header: 'Status', dataKey: 'status' },
  { header: 'STO WMS ID', dataKey: 'stoWmsId' },
  { header: 'Kode Barang', dataKey: 'itemCode' },
  { header: 'Nama Barang', dataKey: 'itemName' },
  // ✅ v3.4.0: Reconciliation columns (INTERNAL ONLY)
  ...(canShowSystemQty ? [
    { header: 'Beginning', dataKey: 'beginningQty' },
    { header: 'Incoming', dataKey: 'incomingQtyOnDate' },
    { header: 'Outgoing', dataKey: 'outgoingQtyOnDate' },
    { header: 'System Ending', dataKey: 'systemQty' },
    { header: 'WMS Ending', dataKey: 'actualQtyCount' },
    { header: 'Variance', dataKey: 'varianceQty' },
  ] : []),
  { header: 'Keterangan', dataKey: 'reason' },
];

export default function StockOpnameReportPage() {
  const theme = useTheme();
  const toast = useToast();
  const { data: session } = useSession();

  const userRole = session?.user?.role;
  const canShowSystemQty = canViewSystemQty(userRole);

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [data, setData] = useState<StockOpnameData[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/customs/stock-count/opname');
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Error fetching stock opname report data:', error);
      toast.error('Failed to load stock opname report');
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
  }, [searchQuery, selectedDate]);

  const uniqueDates = useMemo(() => {
    const dateSet = new Set<string>();
    data.forEach((row) => {
      if (row.docDate) {
        const isoDate = new Date(row.docDate).toISOString().split('T')[0];
        dateSet.add(isoDate);
      }
    });
    return Array.from(dateSet).sort();
  }, [data]);

  const filteredData = useMemo(() => {
    let filtered = data;

    if (selectedDate) {
      filtered = filtered.filter((row) => {
        const isoDate = new Date(row.docDate).toISOString().split('T')[0];
        return isoDate === selectedDate;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((row) => {
        return (
          row.companyName?.toLowerCase().includes(query) ||
          row.stoWmsId?.toLowerCase().includes(query) ||
          row.itemCode?.toLowerCase().includes(query) ||
          row.itemName?.toLowerCase().includes(query)
        );
      });
    }

    return filtered;
  }, [data, selectedDate, searchQuery]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleExportExcel = () => {
    const exportData = filteredData.map((row, index) => {
      const baseExport: any = {
        no: index + 1,
        companyName: row.companyName,
        docDate: row.docDate,
        status: row.status,
        stoWmsId: row.stoWmsId,
        typeCode: row.typeCode,
        itemCode: row.itemCode,
        itemName: row.itemName,
        unit: row.unit,
      };

      // ✅ v3.4.0: Include reconciliation fields (INTERNAL ONLY)
      if (canShowSystemQty) {
        baseExport.beginningQty = row.beginningQty ?? '-';
        baseExport.incomingQtyOnDate = row.incomingQtyOnDate ?? '-';
        baseExport.outgoingQtyOnDate = row.outgoingQtyOnDate ?? '-';
        baseExport.systemQty = row.systemQty ?? '-';
        baseExport.actualQtyCount = row.actualQtyCount ?? '-';
        baseExport.varianceQty = row.varianceQty ?? '-';
      }

      baseExport.reason = row.reason || '-';

      return baseExport;
    });

    exportToExcelWithHeaders(
      exportData,
      getExcelHeaders(canShowSystemQty),
      'Laporan_Stock_Opname',
      'Laporan Stock Opname'
    );
  };

  const handleExportPDF = () => {
    const exportData = filteredData.map((row, index) => {
      const baseExport: any = {
        no: index + 1,
        companyName: row.companyName,
        docDate: formatDateShort(row.docDate),
        status: row.status,
        stoWmsId: row.stoWmsId,
        itemCode: row.itemCode,
        itemName: row.itemName,
      };

      // ✅ v3.4.0: Include reconciliation fields (INTERNAL ONLY)
      if (canShowSystemQty) {
        baseExport.beginningQty = row.beginningQty !== undefined ? formatQty(row.beginningQty) : '-';
        baseExport.incomingQtyOnDate = row.incomingQtyOnDate !== undefined ? formatQty(row.incomingQtyOnDate) : '-';
        baseExport.outgoingQtyOnDate = row.outgoingQtyOnDate !== undefined ? formatQty(row.outgoingQtyOnDate) : '-';
        baseExport.systemQty = row.systemQty !== undefined ? formatQty(row.systemQty) : '-';
        baseExport.actualQtyCount = row.actualQtyCount !== undefined ? formatQty(row.actualQtyCount) : '-';
        baseExport.varianceQty = row.varianceQty !== undefined ? formatQty(row.varianceQty) : '-';
      }

      baseExport.reason = row.reason || '-';

      return baseExport;
    });

    exportToPDF(
      exportData,
      getPdfColumns(canShowSystemQty),
      'Laporan_Stock_Opname',
      'Laporan Stock Opname'
    );
  };

  const paginatedData = filteredData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <ReportLayout
      title="Laporan Stock Opname"
      subtitle="Daftar laporan stock opname"
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
          label="Pilih Tanggal"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          size="small"
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">Semua Tanggal</MenuItem>
          {uniqueDates.map((isoDate) => (
            <MenuItem key={isoDate} value={isoDate}>
              {new Date(isoDate + 'T00:00:00').toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: '2-digit',
              })}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          placeholder="Search opname..."
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
          sx={{ maxWidth: 400 }}
        />
      </Box>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer>
          <Table sx={{ minWidth: 650 }} aria-label="stock opname report table">
            <TableHead>
              <TableRow
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                }}
              >
                <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Company Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Tanggal Pelaksanaan</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>STO WMS ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Kategori Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Kode Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Nama Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Satuan Barang</TableCell>
                {/* ✅ v3.4.0: Reconciliation columns */}
                {canShowSystemQty ? (
                  /* INTERNAL ONLY: Show all reconciliation details */
                  <>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Beginning</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">In</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Out</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">System Ending</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">WMS Ending</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Variance</TableCell>
                  </>
                ) : (
                  /* EXTERNAL (CUSTOMS): Show only WMS count with localized label */
                  <TableCell sx={{ fontWeight: 600 }} align="right">Jumlah Hasil Pencacahan</TableCell>
                )}
                <TableCell sx={{ fontWeight: 600 }}>Keterangan</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canShowSystemQty ? 16 : 11} align="center" sx={{ py: 8 }}>
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
                    <TableCell>{formatDate(row.docDate)}</TableCell>
                    <TableCell>
                      <Chip
                        label={row.status}
                        size="small"
                        color={
                          row.status === 'RELEASED'
                            ? 'success'
                            : row.status === 'PROCESS'
                            ? 'warning'
                            : 'default'
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {row.stoWmsId || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <Chip label={row.typeCode} size="small" color="secondary" />
                        {row.itemCodeBahasa && (
                          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
                            {row.itemCodeBahasa}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {row.itemCode}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.itemName}</TableCell>
                    <TableCell>
                      <Chip label={row.unit} size="small" />
                    </TableCell>
                    {/* ✅ v3.4.0: Reconciliation columns */}
                    {canShowSystemQty ? (
                      /* INTERNAL ONLY: Show all reconciliation details */
                      <>
                        <TableCell align="right">
                          <Typography variant="body2">
                            {row.beginningQty !== undefined ? formatQty(row.beginningQty) : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2">
                            {row.incomingQtyOnDate !== undefined ? formatQty(row.incomingQtyOnDate) : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2">
                            {row.outgoingQtyOnDate !== undefined ? formatQty(row.outgoingQtyOnDate) : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={600}>
                            {row.systemQty !== undefined ? formatQty(row.systemQty) : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={600}>
                            {row.actualQtyCount !== undefined ? formatQty(row.actualQtyCount) : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            variant="body2"
                            sx={{
                              color:
                                row.varianceQty && row.varianceQty < 0
                                  ? '#d32f2f'
                                  : row.varianceQty && row.varianceQty > 0
                                  ? '#388e3c'
                                  : 'text.secondary',
                              fontWeight: row.varianceQty !== 0 ? 600 : 'normal',
                            }}
                          >
                            {row.varianceQty !== undefined ? formatQty(row.varianceQty) : '-'}
                          </Typography>
                        </TableCell>
                      </>
                    ) : (
                      /* EXTERNAL (CUSTOMS): Show only WMS count */
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight={600}>
                          {row.actualQtyCount !== undefined ? formatQty(row.actualQtyCount) : '-'}
                        </Typography>
                      </TableCell>
                    )}
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {row.reason || '-'}
                      </Typography>
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
        count={filteredData.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </ReportLayout>
  );
}
