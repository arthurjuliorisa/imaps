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
  Badge,
} from '@mui/material';
import { Add, Visibility } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { exportToExcel, exportToPDF, formatCurrency, formatDate } from '@/lib/exportUtils';
import { getOutgoingTransactions } from '@/lib/api';
import type { OutgoingHeader } from '@/types/core';

interface ProductionOutputIdsCellProps {
  ids: string[];
}

function ProductionOutputIdsCell({ ids }: ProductionOutputIdsCellProps) {
  if (!ids || ids.length === 0) {
    return <Typography variant="body2" color="text.secondary">-</Typography>;
  }

  const displayIds = ids.slice(0, 2);
  const remainingCount = ids.length - 2;

  return (
    <Tooltip
      title={
        <Box>
          <Typography variant="caption" fontWeight={600} sx={{ mb: 0.5 }}>
            All Production Output IDs:
          </Typography>
          {ids.map((id, index) => (
            <Typography key={index} variant="caption" display="block">
              {id}
            </Typography>
          ))}
        </Box>
      }
      arrow
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {displayIds.map((id, index) => (
          <Chip
            key={index}
            label={id}
            size="small"
            variant="outlined"
            color="secondary"
            sx={{ fontSize: '0.7rem' }}
          />
        ))}
        {remainingCount > 0 && (
          <Chip
            label={`+${remainingCount} more`}
            size="small"
            color="info"
            sx={{ fontSize: '0.7rem', fontWeight: 600 }}
          />
        )}
      </Box>
    </Tooltip>
  );
}

export default function OutgoingGoodsReportPage() {
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
  const [data, setData] = useState<OutgoingHeader[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getOutgoingTransactions({
        page,
        page_size: pageSize,
        start_date: startDate,
        end_date: endDate,
      });

      setData(response.data);
      setTotalRecords(response.pagination.total_records);
    } catch (error) {
      console.error('Error fetching outgoing transactions:', error);
      toast.error('Failed to load outgoing transactions');
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
      'PPKEK': row.ppkek_number,
      'Reg Date': formatDate(row.customs_registration_date),
      'Outgoing Date': formatDate(row.outgoing_date),
      'Recipient': row.recipient_name || '-',
      'Invoice': row.invoice_number || '-',
      'Production Output IDs': ((row as any).production_output_wms_ids || []).join(', ') || '-',
      'Created Date': formatDate(row.created_at),
    }));

    exportToExcel(
      exportData,
      `Outgoing_Transactions_${startDate}_${endDate}`,
      'Outgoing Transactions'
    );
  };

  const handleExportPDF = () => {
    const exportData = data.map((row, index) => ({
      no: (page - 1) * pageSize + index + 1,
      wmsId: row.wms_id,
      companyCode: row.company_code,
      companyName: (row as any).company_name || '-',
      docType: row.customs_document_type,
      ppkek: row.ppkek_number,
      regDate: formatDate(row.customs_registration_date),
      outgoingDate: formatDate(row.outgoing_date),
      productionIds: ((row as any).production_output_wms_ids || []).slice(0, 3).join(', ') + (((row as any).production_output_wms_ids || []).length > 3 ? '...' : ''),
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
      { header: 'Outgoing Date', dataKey: 'outgoingDate' },
      { header: 'Production IDs', dataKey: 'productionIds' },
      { header: 'Created Date', dataKey: 'createdDate' },
    ];

    exportToPDF(
      exportData,
      columns,
      `Outgoing_Transactions_${startDate}_${endDate}`,
      'Outgoing Transactions Report',
      `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`
    );
  };

  return (
    <ReportLayout
      title="Outgoing Transactions"
      subtitle="Manage outgoing customs documents (BC30, BC25, BC27, BC41)"
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
          <Table sx={{ minWidth: 650 }} aria-label="outgoing transactions table">
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
                <TableCell sx={{ fontWeight: 600 }}>Outgoing Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Recipient</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Invoice</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Production Output IDs</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} align="center" sx={{ py: 8 }}>
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
                        color="secondary"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip label={row.ppkek_number} size="small" color="info" variant="outlined" />
                    </TableCell>
                    <TableCell>{formatDate(row.customs_registration_date)}</TableCell>
                    <TableCell>{formatDate(row.outgoing_date)}</TableCell>
                    <TableCell>{row.recipient_name || '-'}</TableCell>
                    <TableCell>{row.invoice_number || '-'}</TableCell>
                    <TableCell>
                      <ProductionOutputIdsCell ids={(row as any).production_output_wms_ids || []} />
                    </TableCell>
                    <TableCell>
                      {formatDate(row.created_at)}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Tooltip title="View Details">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => router.push(`/customs/outgoing/${row.wms_id}`)}
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
