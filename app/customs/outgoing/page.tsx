'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
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
  Stack,
  TablePagination,
  alpha,
  useTheme,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  MenuItem,
} from '@mui/material';
import { Visibility, Search as SearchIcon } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { exportToExcelWithHeaders, exportToPDF, formatDate, formatDateShort } from '@/lib/exportUtils';
import { formatQty, formatAmount } from '@/lib/utils/format';

interface OutgoingReportData {
  id: string;
  wmsId: string;
  companyCode: number;
  companyName: string;
  documentType: string;
  ppkekNumber: string;
  registrationDate: Date;
  documentNumber: string;
  date: Date;
  recipientName: string;
  typeCode: string;
  itemCode: string;
  itemName: string;
  unit: string;
  qty: number;
  currency: string;
  amount: number;
}

const EXCEL_HEADERS = [
  { key: 'no', label: 'No', type: 'number' as const },
  { key: 'companyName', label: 'Company Name', type: 'text' as const },
  { key: 'documentType', label: 'Jenis Dokumen Pabean', type: 'text' as const },
  { key: 'ppkekNumber', label: 'Nomor Daftar', type: 'text' as const },
  { key: 'registrationDate', label: 'Tanggal Daftar', type: 'date' as const },
  { key: 'documentNumber', label: 'Nomor Bukti Pengeluaran Barang', type: 'text' as const },
  { key: 'date', label: 'Tanggal Bukti Pengeluaran Barang', type: 'date' as const },
  { key: 'recipientName', label: 'Penerima barang', type: 'text' as const },
  { key: 'typeCode', label: 'Item Type', type: 'text' as const },
  { key: 'itemCode', label: 'Kode Barang', type: 'text' as const },
  { key: 'itemName', label: 'Nama Barang', type: 'text' as const },
  { key: 'unit', label: 'Satuan Barang', type: 'text' as const },
  { key: 'qty', label: 'Jumlah Barang', type: 'number' as const },
  { key: 'currency', label: 'valas', type: 'text' as const },
  { key: 'amount', label: 'nilai barang', type: 'number' as const },
];

const PDF_COLUMNS = [
  { header: 'No', dataKey: 'no' },
  { header: 'Company Name', dataKey: 'companyName' },
  { header: 'Jenis Dokumen Pabean', dataKey: 'documentType' },
  { header: 'Nomor Bukti Pengeluaran Barang', dataKey: 'documentNumber' },
  { header: 'Tanggal Bukti Pengeluaran Barang', dataKey: 'date' },
  { header: 'Penerima barang', dataKey: 'recipientName' },
  { header: 'Kode Barang', dataKey: 'itemCode' },
  { header: 'Nama Barang', dataKey: 'itemName' },
  { header: 'Jumlah Barang', dataKey: 'qty' },
  { header: 'valas', dataKey: 'currency' },
  { header: 'nilai barang', dataKey: 'amount' },
];

export default function OutgoingGoodsReportPage() {
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();

  // Default date range: today
  const now = new Date();

  const [startDate, setStartDate] = useState(now.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [data, setData] = useState<OutgoingReportData[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [itemTypeFilter, setItemTypeFilter] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
      });

      const response = await fetch(`/api/customs/outgoing?${params}`);
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Error fetching outgoing report data:', error);
      toast.error('Failed to load outgoing goods report');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page to 0 when search query or item type filter changes
  useEffect(() => {
    setPage(0);
  }, [searchQuery, itemTypeFilter]);

  // Get unique item types from data
  const uniqueItemTypes = useMemo(() => {
    const types = new Set(data.map(item => item.typeCode));
    return Array.from(types).sort();
  }, [data]);

  // Filter data based on search query and item type filter
  const filteredData = useMemo(() => {
    let filtered = data;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((row) => {
        return (
          row.companyName?.toLowerCase().includes(query) ||
          row.documentType?.toLowerCase().includes(query) ||
          row.ppkekNumber?.toLowerCase().includes(query) ||
          row.documentNumber?.toLowerCase().includes(query) ||
          row.recipientName?.toLowerCase().includes(query) ||
          row.typeCode?.toLowerCase().includes(query) ||
          row.itemCode?.toLowerCase().includes(query) ||
          row.itemName?.toLowerCase().includes(query) ||
          row.unit?.toLowerCase().includes(query) ||
          row.currency?.toLowerCase().includes(query)
        );
      });
    }

    // Apply item type filter
    if (itemTypeFilter) {
      filtered = filtered.filter(row => row.typeCode === itemTypeFilter);
    }

    return filtered;
  }, [data, searchQuery, itemTypeFilter]);

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
      documentType: row.documentType,
      ppkekNumber: row.ppkekNumber || '-',
      registrationDate: row.registrationDate,
      documentNumber: row.documentNumber,
      date: row.date,
      recipientName: row.recipientName,
      typeCode: row.typeCode,
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit,
      qty: row.qty,
      currency: row.currency,
      amount: row.amount,
    }));

    exportToExcelWithHeaders(
      exportData,
      EXCEL_HEADERS,
      `Laporan_Pengeluaran_Barang_${startDate}_${endDate}`,
      'Laporan Pengeluaran Barang'
    );
  };

  const handleExportPDF = () => {
    const exportData = filteredData.map((row, index) => ({
      no: index + 1,
      companyName: row.companyName,
      documentType: row.documentType,
      documentNumber: row.documentNumber,
      date: formatDateShort(row.date),
      recipientName: row.recipientName,
      itemCode: row.itemCode,
      itemName: row.itemName,
      qty: formatQty(row.qty),
      currency: row.currency,
      amount: formatAmount(row.amount),
    }));

    exportToPDF(
      exportData,
      PDF_COLUMNS,
      `Laporan_Pengeluaran_Barang_${startDate}_${endDate}`,
      'Laporan Pengeluaran Barang',
      `Period: ${formatDateShort(startDate)} - ${formatDateShort(endDate)}`
    );
  };

  const paginatedData = filteredData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <ReportLayout
      title="Laporan Pengeluaran Barang"
      subtitle="Laporan barang yang keluar berdasarkan dokumen customs"
      actions={
        <Stack spacing={3}>
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ExportButtons
              onExportExcel={handleExportExcel}
              onExportPDF={handleExportPDF}
              disabled={filteredData.length === 0 || loading}
            />
          </Box>
        </Stack>
      }
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3, mb: 3, px: 3, gap: 2 }}>
        <TextField
          select
          label="Item Type"
          value={itemTypeFilter}
          onChange={(e) => setItemTypeFilter(e.target.value)}
          size="small"
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All Item Types</MenuItem>
          {uniqueItemTypes.map((type) => (
            <MenuItem key={type} value={type}>
              {type}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          placeholder="Search transactions..."
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
          <Table sx={{ minWidth: 650 }} aria-label="outgoing goods report table">
            <TableHead>
              <TableRow
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                }}
              >
                <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Company Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Jenis Dokumen Pabean</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Nomor Daftar</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Tanggal Daftar</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Nomor Bukti Pengeluaran Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Tanggal Bukti Pengeluaran Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Penerima barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Kode Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Nama Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Satuan Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Jumlah Barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>valas</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">nilai barang</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="center">Traceback</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={16} align="center" sx={{ py: 8 }}>
                    <Typography variant="body1" color="text.secondary">
                      No records found for the selected date range
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedData.map((row, index) => (
                  <TableRow
                    key={row.id}
                    sx={{
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.04),
                      },
                    }}
                  >
                    <TableCell>{page * rowsPerPage + index + 1}</TableCell>
                    <TableCell>{row.companyName}</TableCell>
                    <TableCell>
                      <Chip
                        label={row.documentType}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      {row.ppkekNumber ? (
                        <Chip label={row.ppkekNumber} size="small" color="info" variant="outlined" />
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(row.registrationDate)}</TableCell>
                    <TableCell>{row.documentNumber}</TableCell>
                    <TableCell>{formatDate(row.date)}</TableCell>
                    <TableCell>{row.recipientName}</TableCell>
                    <TableCell>
                      <Chip label={row.typeCode} size="small" color="secondary" />
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
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>
                        {formatQty(row.qty)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={row.currency} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>
                        {formatAmount(row.amount)}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="View Details">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => router.push(`/customs/outgoing/${row.wmsId}`)}
                        >
                          <Visibility fontSize="small" />
                        </IconButton>
                      </Tooltip>
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
