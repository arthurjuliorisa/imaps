'use client';

import React, { useState } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Stack,
  TablePagination,
  alpha,
  useTheme,
  Chip,
} from '@mui/material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { exportToExcel, exportToPDF, formatCurrency, formatDate } from '@/lib/exportUtils';

interface OutgoingGoodsData {
  id: number;
  docCode: string;
  registerNumber: string;
  registerDate: string;
  docNumber: string;
  docDate: string;
  recipient: string;
  itemCode: string;
  itemName: string;
  uom: string;
  qty: number;
  currency: string;
  amount: number;
}

// Sample data - Replace with actual API call
const sampleData: OutgoingGoodsData[] = [
  {
    id: 1,
    docCode: 'BC-3.0',
    registerNumber: 'OUT-2024-001',
    registerDate: '2024-01-25',
    docNumber: 'EXP-001',
    docDate: '2024-01-20',
    recipient: 'ABC Corp Singapore',
    itemCode: 'FG-001',
    itemName: 'Finished Product A',
    uom: 'PCS',
    qty: 200,
    currency: 'USD',
    amount: 8000,
  },
  {
    id: 2,
    docCode: 'BC-3.0',
    registerNumber: 'OUT-2024-002',
    registerDate: '2024-02-05',
    docNumber: 'EXP-002',
    docDate: '2024-02-01',
    recipient: 'XYZ Trading Malaysia',
    itemCode: 'FG-002',
    itemName: 'Finished Product B',
    uom: 'PCS',
    qty: 150,
    currency: 'USD',
    amount: 6000,
  },
];

export default function OutgoingGoodsReportPage() {
  const theme = useTheme();
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-12-31');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const data = sampleData; // Replace with filtered data from API

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
      'Doc Code': row.docCode,
      'Register Number': row.registerNumber,
      'Register Date': formatDate(row.registerDate),
      'Doc Number': row.docNumber,
      'Doc Date': formatDate(row.docDate),
      'Recipient': row.recipient,
      'Item Code': row.itemCode,
      'Item Name': row.itemName,
      'UOM': row.uom,
      'Qty': row.qty,
      'Currency': row.currency,
      'Amount': row.amount,
    }));

    exportToExcel(
      exportData,
      `Laporan_Pengeluaran_Barang_${startDate}_${endDate}`,
      'Outgoing Goods'
    );
  };

  const handleExportPDF = () => {
    const exportData = data.map((row, index) => ({
      no: index + 1,
      docCode: row.docCode,
      registerNumber: row.registerNumber,
      registerDate: formatDate(row.registerDate),
      docNumber: row.docNumber,
      docDate: formatDate(row.docDate),
      recipient: row.recipient,
      itemCode: row.itemCode,
      itemName: row.itemName,
      uom: row.uom,
      qty: row.qty.toString(),
      currency: row.currency,
      amount: formatCurrency(row.amount, row.currency),
    }));

    const columns = [
      { header: 'No', dataKey: 'no' },
      { header: 'Doc Code', dataKey: 'docCode' },
      { header: 'Register No', dataKey: 'registerNumber' },
      { header: 'Register Date', dataKey: 'registerDate' },
      { header: 'Doc Number', dataKey: 'docNumber' },
      { header: 'Doc Date', dataKey: 'docDate' },
      { header: 'Recipient', dataKey: 'recipient' },
      { header: 'Item Code', dataKey: 'itemCode' },
      { header: 'Item Name', dataKey: 'itemName' },
      { header: 'UOM', dataKey: 'uom' },
      { header: 'Qty', dataKey: 'qty' },
      { header: 'Currency', dataKey: 'currency' },
      { header: 'Amount', dataKey: 'amount' },
    ];

    exportToPDF(
      exportData,
      columns,
      `Laporan_Pengeluaran_Barang_${startDate}_${endDate}`,
      'Laporan Pengeluaran Barang per Dokumen Pabean',
      `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`
    );
  };

  const paginatedData = data.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <ReportLayout
      title="Laporan Pengeluaran Barang"
      subtitle="Laporan Pengeluaran Barang per Dokumen Pabean"
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
              disabled={data.length === 0}
            />
          </Box>
        </Stack>
      }
    >
      <TableContainer>
        <Table sx={{ minWidth: 650 }} aria-label="outgoing goods report table">
          <TableHead>
            <TableRow
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.08),
              }}
            >
              <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Doc Code</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Register Number</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Register Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Doc Number</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Doc Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Recipient</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>UOM</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Qty</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Currency</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} align="center" sx={{ py: 8 }}>
                  <Typography variant="body1" color="text.secondary">
                    No data available for the selected date range
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
                    <Chip label={row.docCode} size="small" color="secondary" variant="outlined" />
                  </TableCell>
                  <TableCell>{row.registerNumber}</TableCell>
                  <TableCell>{formatDate(row.registerDate)}</TableCell>
                  <TableCell>{row.docNumber}</TableCell>
                  <TableCell>{formatDate(row.docDate)}</TableCell>
                  <TableCell>{row.recipient}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.itemCode}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.itemName}</TableCell>
                  <TableCell>
                    <Chip label={row.uom} size="small" />
                  </TableCell>
                  <TableCell align="right">{row.qty.toLocaleString('id-ID')}</TableCell>
                  <TableCell>{row.currency}</TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={600}>
                      {formatCurrency(row.amount, row.currency)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
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
