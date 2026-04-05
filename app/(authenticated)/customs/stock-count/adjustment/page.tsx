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
import { exportToExcelWithHeaders, exportToPDF, formatDate, formatDateShort } from '@/lib/exportUtils';
import { formatQty } from '@/lib/utils/format';

interface AdjustmentData {
  id: string;
  companyName: string;
  docDate: Date;
  stoWmsId: string;
  adjustmentWmsId: string;
  internalEvidenceNumber: string;
  typeCode: string;
  itemCodeBahasa: string;
  itemCode: string;
  itemName: string;
  unit: string;
  beginningQty: number;
  incomingQty: number;
  outgoingQty: number;
  systemQty: number;
  actualQty: number;
  varianceQty: number;
  adjustmentQty: number;
  finalQty: number;
  reason: string;
}

const EXCEL_HEADERS = [
  { key: 'no', label: 'No', type: 'number' as const },
  { key: 'companyName', label: 'Company Name', type: 'text' as const },
  { key: 'docDate', label: 'Tanggal Pelaksanaan', type: 'date' as const },
  { key: 'stoWmsId', label: 'STO WMS ID', type: 'text' as const },
  { key: 'adjustmentWmsId', label: 'Adjustment WMS ID', type: 'text' as const },
  { key: 'internalEvidenceNumber', label: 'No. Bukti Internal', type: 'text' as const },
  { key: 'typeCode', label: 'Kategori Barang', type: 'text' as const },
  { key: 'itemCode', label: 'Kode Barang', type: 'text' as const },
  { key: 'itemName', label: 'Nama Barang', type: 'text' as const },
  { key: 'unit', label: 'Satuan Barang', type: 'text' as const },
  { key: 'jumlahBarang', label: 'Jumlah Barang', type: 'number' as const },
  { key: 'beginningQty', label: 'Saldo Awal', type: 'number' as const },
  { key: 'incomingQty', label: 'Jumlah Pemasukan Barang', type: 'number' as const },
  { key: 'outgoingQty', label: 'Jumlah Pengeluaran Barang', type: 'number' as const },
  { key: 'systemQty', label: 'Stok Sistem', type: 'number' as const },
  { key: 'actualQty', label: 'Hasil Pencacahan', type: 'number' as const },
  { key: 'varianceQty', label: 'Jumlah selisih', type: 'number' as const },
  { key: 'adjustmentQty', label: 'Penyesuaian (adjustment)', type: 'number' as const },
  { key: 'finalQty', label: 'Saldo Akhir', type: 'number' as const },
  { key: 'reason', label: 'Keterangan', type: 'text' as const },
];

const PDF_COLUMNS = [
  { header: 'No', dataKey: 'no' },
  { header: 'Company Name', dataKey: 'companyName' },
  { header: 'Tanggal Pelaksanaan', dataKey: 'docDate' },
  { header: 'STO WMS ID', dataKey: 'stoWmsId' },
  { header: 'No. Bukti Internal', dataKey: 'internalEvidenceNumber' },
  { header: 'Kode Barang', dataKey: 'itemCode' },
  { header: 'Nama Barang', dataKey: 'itemName' },
  { header: 'Satuan Barang', dataKey: 'unit' },
  { header: 'Jumlah Barang', dataKey: 'jumlahBarang' },
  { header: 'Stok Sistem', dataKey: 'systemQty' },
  { header: 'Hasil Pencacahan', dataKey: 'actualQty' },
  { header: 'Jumlah selisih', dataKey: 'varianceQty' },
  { header: 'Penyesuaian (adjustment)', dataKey: 'adjustmentQty' },
  { header: 'Saldo Akhir', dataKey: 'finalQty' },
];

export default function AdjustmentReportPage() {
  const theme = useTheme();
  const toast = useToast();

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [data, setData] = useState<AdjustmentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/customs/stock-count/adjustment');
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Error fetching adjustment report data:', error);
      toast.error('Failed to load adjustment report');
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
    return Array.from(dateSet).sort().reverse();
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
          row.adjustmentWmsId?.toLowerCase().includes(query) ||
          row.internalEvidenceNumber?.toLowerCase().includes(query) ||
          row.itemCode?.toLowerCase().includes(query) ||
          row.itemName?.toLowerCase().includes(query) ||
          row.reason?.toLowerCase().includes(query)
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
    const exportData = filteredData.map((row, index) => ({
      no: index + 1,
      companyName: row.companyName,
      docDate: row.docDate,
      stoWmsId: row.stoWmsId,
      adjustmentWmsId: row.adjustmentWmsId,
      internalEvidenceNumber: row.internalEvidenceNumber,
      typeCode: row.typeCode,
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit,
      jumlahBarang: row.incomingQty,
      beginningQty: row.beginningQty,
      incomingQty: row.incomingQty,
      outgoingQty: row.outgoingQty,
      systemQty: row.systemQty,
      actualQty: row.actualQty,
      varianceQty: row.varianceQty,
      adjustmentQty: row.adjustmentQty,
      finalQty: row.finalQty,
      reason: row.reason,
    }));

    exportToExcelWithHeaders(
      exportData,
      EXCEL_HEADERS,
      'Laporan_Adjustment',
      'Laporan Adjustment'
    );
  };

  const handleExportPDF = () => {
    const exportData = filteredData.map((row, index) => ({
      no: index + 1,
      companyName: row.companyName,
      docDate: formatDateShort(row.docDate),
      stoWmsId: row.stoWmsId,
      internalEvidenceNumber: row.internalEvidenceNumber,
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit,
      jumlahBarang: formatQty(row.incomingQty),
      systemQty: formatQty(row.systemQty),
      actualQty: formatQty(row.actualQty),
      varianceQty: formatQty(row.varianceQty),
      adjustmentQty: formatQty(row.adjustmentQty),
      finalQty: formatQty(row.finalQty),
    }));

    exportToPDF(
      exportData,
      PDF_COLUMNS,
      'Laporan_Adjustment',
      'Laporan Adjustment'
    );
  };

  const paginatedData = filteredData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const getVarianceColor = (variance: number) => {
    if (variance > 0) return theme.palette.success.main;
    if (variance < 0) return theme.palette.error.main;
    return 'text.primary';
  };

  return (
    <ReportLayout
      title="Laporan Adjustment"
      subtitle="Laporan penyesuaian stok berdasarkan hasil stock opname"
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
          placeholder="Search adjustment..."
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
          <Table sx={{ minWidth: 650 }} aria-label="adjustment report table">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Company Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Tanggal Pelaksanaan</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>STO WMS ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Adjustment WMS ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>No. Bukti Internal</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Kategori Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Kode Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Nama Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Satuan Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Jumlah Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Saldo Awal</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Jumlah Pemasukan Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Jumlah Pengeluaran Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Stok Sistem</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Hasil Pencacahan</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Jumlah selisih</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Penyesuaian (adjustment)</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Saldo Akhir</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Keterangan</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={20} align="center" sx={{ py: 8 }}>
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
                      <Typography variant="body2" color="text.secondary">
                        {row.stoWmsId || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {row.adjustmentWmsId || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {row.internalEvidenceNumber || '-'}
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
                    <TableCell align="right">{formatQty(row.incomingQty)}</TableCell>
                    <TableCell align="right">{formatQty(row.beginningQty)}</TableCell>
                    <TableCell align="right">{formatQty(row.incomingQty)}</TableCell>
                    <TableCell align="right">{formatQty(row.outgoingQty)}</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>
                        {formatQty(row.systemQty)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>
                        {formatQty(row.actualQty)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        sx={{ color: getVarianceColor(row.varianceQty) }}
                      >
                        {row.varianceQty > 0 ? '+' : ''}{formatQty(row.varianceQty)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        sx={{ color: getVarianceColor(row.adjustmentQty) }}
                      >
                        {row.adjustmentQty > 0 ? '+' : ''}{formatQty(row.adjustmentQty)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={700}>
                        {formatQty(row.finalQty)}
                      </Typography>
                    </TableCell>
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
