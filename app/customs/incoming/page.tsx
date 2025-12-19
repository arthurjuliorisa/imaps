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
  Paper,
  Typography,
  Stack,
  TablePagination,
  alpha,
  useTheme,
  Chip,
  CircularProgress,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Visibility, Edit, Delete } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { exportToExcel, exportToPDF, formatCurrency, formatDate } from '@/lib/exportUtils';
import { getIncomingTransactions } from '@/lib/api';
import type { IncomingHeader } from '@/types/core';

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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<IncomingHeader[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getIncomingTransactions({
        page,
        page_size: pageSize,
        start_date: startDate,
        end_date: endDate,
      });

      setData(response.data);
      setTotalRecords(response.pagination.total_records);
    } catch (error) {
      console.error('Error fetching incoming transactions:', error);
      toast.error('Failed to load incoming transactions');
      setData([]);
      setTotalRecords(0);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, page, pageSize, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage + 1); // MUI uses 0-based, API uses 1-based
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPageSize(parseInt(event.target.value, 10));
    setPage(1);
  };


  const handleExportExcel = () => {
    const exportData = data.map((row, index) => ({
      No: (page - 1) * pageSize + index + 1,
      'WMS ID': row.wms_id,
      'Company Code': row.company_code,
      'Company Name': (row as any).company_name || '-',
      'Doc Type': row.customs_document_type,
      'PPKEK Number': row.ppkek_number || '-',
      'Customs Registration Date': formatDate(row.customs_registration_date),
      'Owner': row.owner,
      'Incoming Date': formatDate(row.incoming_date),
      'Invoice Number': row.invoice_number || '-',
      'Shipper': row.shipper_name || '-',
      'Created Date': formatDate(row.created_at),
    }));

    exportToExcel(
      exportData,
      `Incoming_Transactions_${startDate}_${endDate}`,
      'Incoming Transactions'
    );
  };

  const handleExportPDF = () => {
    const exportData = data.map((row, index) => ({
      no: (page - 1) * pageSize + index + 1,
      wmsId: row.wms_id,
      companyCode: row.company_code,
      companyName: (row as any).company_name || '-',
      docType: row.customs_document_type,
      ppkek: row.ppkek_number || '-',
      regDate: formatDate(row.customs_registration_date),
      owner: row.owner,
      incomingDate: formatDate(row.incoming_date),
      createdDate: formatDate(row.created_at),
    }));

    const columns = [
      { header: 'No', dataKey: 'no' },
      { header: 'WMS ID', dataKey: 'wmsId' },
      { header: 'Company Code', dataKey: 'companyCode' },
      { header: 'Company Name', dataKey: 'companyName' },
      { header: 'Doc Type', dataKey: 'docType' },
      { header: 'PPKEK', dataKey: 'ppkek' },
      { header: 'Reg Date', dataKey: 'regDate' },
      { header: 'Owner', dataKey: 'owner' },
      { header: 'Incoming Date', dataKey: 'incomingDate' },
      { header: 'Created Date', dataKey: 'createdDate' },
    ];

    exportToPDF(
      exportData,
      columns,
      `Incoming_Transactions_${startDate}_${endDate}`,
      'Incoming Transactions Report',
      `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`
    );
  };

  return (
    <ReportLayout
      title="Incoming Transactions"
      subtitle="Manage incoming customs documents (BC23, BC27, BC40)"
      actions={
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
            />
          </Box>
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
          <Table sx={{ minWidth: 650 }} aria-label="incoming transactions table">
            <TableHead>
              <TableRow
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                }}
              >
                <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>WMS ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Company Code</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Company Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Doc Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>PPKEK</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Reg Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Owner</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Incoming Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Invoice</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} align="center" sx={{ py: 8 }}>
                    <Typography variant="body1" color="text.secondary">
                      No records found for the selected date range
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row, index) => (
                  <TableRow
                    key={`${row.company_code}-${row.wms_id}`}
                    sx={{
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.04),
                      },
                    }}
                  >
                    <TableCell>{(page - 1) * pageSize + index + 1}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {row.wms_id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={row.company_code} size="small" />
                    </TableCell>
                    <TableCell>
                      {(row as any).company_name || '-'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={row.customs_document_type}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      {row.ppkek_number ? (
                        <Chip label={row.ppkek_number} size="small" color="info" variant="outlined" />
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(row.customs_registration_date)}</TableCell>
                    <TableCell>{row.owner}</TableCell>
                    <TableCell>{formatDate(row.incoming_date)}</TableCell>
                    <TableCell>{row.invoice_number || '-'}</TableCell>
                    <TableCell>
                      {formatDate(row.created_at)}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Tooltip title="View Details">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => router.push(`/customs/incoming/${row.wms_id}`)}
                          >
                            <Visibility fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {!loading && totalRecords > 0 && (
        <TablePagination
          rowsPerPageOptions={[10, 20, 50, 100]}
          component="div"
          count={totalRecords}
          rowsPerPage={pageSize}
          page={page - 1} // MUI uses 0-based
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          labelRowsPerPage="Rows per page:"
          labelDisplayedRows={({ from, to, count }) =>
            `${from}-${to} of ${count !== -1 ? count : `more than ${to}`}`
          }
        />
      )}
    </ReportLayout>
  );
}
