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
} from '@mui/material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { exportToExcelWithHeaders, exportToPDF, formatDate, formatDateShort } from '@/lib/exportUtils';

interface OpnameHeader {
  id: string;
  documentNumber: string;
  date: Date;
  companyCode: number;
  companyName: string;
  status: string;
  description?: string;
}

const EXCEL_HEADERS = [
  { key: 'no', label: 'No', type: 'number' as const },
  { key: 'documentNumber', label: 'Document Number', type: 'text' as const },
  { key: 'date', label: 'Date', type: 'date' as const },
  { key: 'companyName', label: 'Company Name', type: 'text' as const },
  { key: 'status', label: 'Status', type: 'text' as const },
];

const PDF_COLUMNS = [
  { header: 'No', dataKey: 'no' },
  { header: 'Document Number', dataKey: 'documentNumber' },
  { header: 'Date', dataKey: 'date' },
  { header: 'Company Name', dataKey: 'companyName' },
  { header: 'Status', dataKey: 'status' },
];

export default function StockOpnameReportPage() {
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [data, setData] = useState<OpnameHeader[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/customs/stock-count/opname`);
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

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleRowClick = (id: string) => {
    router.push(`/customs/stock-count/opname/${id}`);
  };

  const handleExportExcel = () => {
    const exportData = data.map((row, index) => ({
      no: index + 1,
      documentNumber: row.documentNumber,
      date: row.date,
      companyName: row.companyName,
      status: row.status,
    }));

    exportToExcelWithHeaders(
      exportData,
      EXCEL_HEADERS,
      'Laporan_Stock_Opname',
      'Laporan Stock Opname'
    );
  };

  const handleExportPDF = () => {
    const exportData = data.map((row, index) => ({
      no: index + 1,
      documentNumber: row.documentNumber,
      date: formatDateShort(row.date),
      companyName: row.companyName,
      status: row.status,
    }));

    exportToPDF(
      exportData,
      PDF_COLUMNS,
      'Laporan_Stock_Opname',
      'Laporan Stock Opname'
    );
  };

  const paginatedData = data.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <ReportLayout
      title="Laporan Stock Opname"
      subtitle="Daftar laporan stock opname"
      actions={
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <ExportButtons
            onExportExcel={handleExportExcel}
            onExportPDF={handleExportPDF}
            disabled={data.length === 0 || loading}
          />
        </Box>
      }
    >
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
                <TableCell sx={{ fontWeight: 600 }}>Document Number</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Company Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 8 }}>
                    <Typography variant="body1" color="text.secondary">
                      No records found
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedData.map((row, index) => (
                  <TableRow
                    key={row.id}
                    hover
                    onClick={() => handleRowClick(row.id)}
                    sx={{
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.04),
                      },
                    }}
                  >
                    <TableCell>{page * rowsPerPage + index + 1}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {row.documentNumber}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatDate(row.date)}</TableCell>
                    <TableCell>{row.companyName}</TableCell>
                    <TableCell>
                      <Chip
                        label={row.status}
                        size="small"
                        color={row.status === 'RELEASED' ? 'success' : row.status === 'PROCESS' ? 'warning' : 'default'}
                      />
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
