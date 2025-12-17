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
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Add, Visibility } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';
import { getProductionTransactions } from '@/lib/api';
import type { FinishedGoodsProductionHeader } from '@/types/core';

export default function ProductionPage() {
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<FinishedGoodsProductionHeader[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getProductionTransactions({
        page,
        page_size: pageSize,
        start_date: startDate,
        end_date: endDate,
      });

      setData(response.data);
      setTotalRecords(response.pagination.total_records);
    } catch (error) {
      console.error('Error fetching production:', error);
      toast.error('Failed to load production data');
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
    setPage(newPage + 1);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPageSize(parseInt(event.target.value, 10));
    setPage(1);
  };

  const handleNewDocument = () => {
    router.push('/customs/production/new');
  };

  const handleExportExcel = () => {
    const exportData = data.map((row, index) => ({
      No: (page - 1) * pageSize + index + 1,
      'WMS ID': row.wms_id,
      'Company': row.company_code,
      'Internal Evidence': row.internal_evidence_number,
      'Transaction Date': formatDate(row.transaction_date.toISOString()),
      'Reversal': row.reversal || '-',
    }));

    exportToExcel(
      exportData,
      `Production_${startDate}_${endDate}`,
      'Production Output'
    );
  };

  const handleExportPDF = () => {
    const exportData = data.map((row, index) => ({
      no: (page - 1) * pageSize + index + 1,
      wmsId: row.wms_id,
      company: row.company_code,
      internalEvidence: row.internal_evidence_number,
      transactionDate: formatDate(row.transaction_date.toISOString()),
    }));

    const columns = [
      { header: 'No', dataKey: 'no' },
      { header: 'WMS ID', dataKey: 'wmsId' },
      { header: 'Company', dataKey: 'company' },
      { header: 'Internal Evidence', dataKey: 'internalEvidence' },
      { header: 'Transaction Date', dataKey: 'transactionDate' },
    ];

    exportToPDF(
      exportData,
      columns,
      `Production_${startDate}_${endDate}`,
      'Production Output Report',
      `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`
    );
  };

  return (
    <ReportLayout
      title="Production Output"
      subtitle="Finished goods and scrap production tracking"
      actions={
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={handleNewDocument}
              disabled={loading}
            >
              New Production
            </Button>
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
          <Table sx={{ minWidth: 650 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>WMS ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Company</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Internal Evidence</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Transaction Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Reversal</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 8 }}>
                    <Typography variant="body1" color="text.secondary">
                      No records found for the selected date range
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row, index) => (
                  <TableRow
                    key={`${row.company_code}-${row.wms_id}`}
                    sx={{ '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) } }}
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
                      {row.internal_evidence_number}
                    </TableCell>
                    <TableCell>{formatDate(row.transaction_date.toISOString())}</TableCell>
                    <TableCell>
                      {row.reversal ? (
                        <Chip label={row.reversal} size="small" color="warning" />
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Tooltip title="View Details">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => router.push(`/customs/production/${row.wms_id}`)}
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
      {!loading && totalRecords > 0 && (
        <TablePagination
          rowsPerPageOptions={[10, 20, 50, 100]}
          component="div"
          count={totalRecords}
          rowsPerPage={pageSize}
          page={page - 1}
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
