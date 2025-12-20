'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
} from '@mui/material';
import { Visibility } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';

interface IncomingReportData {
  id: string;
  wmsId: number;
  companyCode: number;
  companyName: string;
  documentType: string;
  ppkekNumber: string;
  registrationDate: Date;
  documentNumber: string;
  date: Date;
  shipperName: string;
  typeCode: string;
  itemCode: string;
  itemName: string;
  unit: string;
  qty: number;
  currency: string;
  amount: number;
  createdAt: Date;
}

export default function IncomingGoodsReportPage() {
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();

  // Default date range: last 30 days to today
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [data, setData] = useState<IncomingReportData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
      });

      const response = await fetch(`/api/customs/incoming?${params}`);
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Error fetching incoming report data:', error);
      toast.error('Failed to load incoming goods report');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleExportExcel = () => {
    const exportData = data.map((row, index) => ({
      No: index + 1,
      'WMS ID': row.wmsId,
      'Company Name': row.companyName,
      'Doc Type': row.documentType,
      'PPKEK Number': row.ppkekNumber || '-',
      'Registration Date': formatDate(row.registrationDate),
      'Doc Number': row.documentNumber,
      'Doc Date': formatDate(row.date),
      'Shipper Name': row.shipperName,
      'Item Type': row.typeCode,
      'Item Code': row.itemCode,
      'Item Name': row.itemName,
      'Unit': row.unit,
      'Quantity': row.qty,
      'Currency': row.currency,
      'Value Amount': row.amount,
      'Created Date': formatDate(row.createdAt),
    }));

    exportToExcel(
      exportData,
      `Laporan_Pemasukan_Barang_${startDate}_${endDate}`,
      'Laporan Pemasukan Barang'
    );
  };

  const handleExportPDF = () => {
    const exportData = data.map((row, index) => ({
      no: index + 1,
      wmsId: row.wmsId.toString(),
      docType: row.documentType,
      docNumber: row.documentNumber,
      docDate: formatDate(row.date),
      shipper: row.shipperName,
      itemCode: row.itemCode,
      itemName: row.itemName,
      qty: row.qty.toString(),
      currency: row.currency,
      amount: row.amount.toLocaleString('id-ID', { minimumFractionDigits: 2 }),
    }));

    const columns = [
      { header: 'No', dataKey: 'no' },
      { header: 'WMS ID', dataKey: 'wmsId' },
      { header: 'Doc Type', dataKey: 'docType' },
      { header: 'Doc Number', dataKey: 'docNumber' },
      { header: 'Date', dataKey: 'docDate' },
      { header: 'Shipper', dataKey: 'shipper' },
      { header: 'Item Code', dataKey: 'itemCode' },
      { header: 'Item Name', dataKey: 'itemName' },
      { header: 'Qty', dataKey: 'qty' },
      { header: 'Currency', dataKey: 'currency' },
      { header: 'Amount', dataKey: 'amount' },
    ];

    exportToPDF(
      exportData,
      columns,
      `Laporan_Pemasukan_Barang_${startDate}_${endDate}`,
      'Laporan Pemasukan Barang',
      `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`
    );
  };

  const paginatedData = data.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <ReportLayout
      title="Laporan Pemasukan Barang"
      subtitle="Laporan barang yang masuk berdasarkan dokumen customs"
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
              disabled={data.length === 0 || loading}
            />
          </Box>
        </Stack>
      }
    >
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer>
          <Table sx={{ minWidth: 650 }} aria-label="incoming goods report table">
            <TableHead>
              <TableRow
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                }}
              >
                <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>WMS ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Company Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Doc Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>PPKEK Number</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Reg Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Doc Number</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Doc Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Shipper Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Quantity</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Currency</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Value Amount</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="center">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={18} align="center" sx={{ py: 8 }}>
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
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {row.wmsId}
                      </Typography>
                    </TableCell>
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
                    <TableCell>{row.shipperName}</TableCell>
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
                        {row.qty.toLocaleString('id-ID', { minimumFractionDigits: 2 })}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={row.currency} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>
                        {row.amount.toLocaleString('id-ID', { minimumFractionDigits: 2 })}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell align="center">
                      <Tooltip title="View Details">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => router.push(`/customs/incoming/${row.wmsId}`)}
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
        count={data.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </ReportLayout>
  );
}
