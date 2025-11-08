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
  Typography,
  Stack,
  TablePagination,
  alpha,
  useTheme,
  Chip,
} from '@mui/material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateSelector } from '@/app/components/customs/DateSelector';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';

interface WIPData {
  id: number;
  itemCode: string;
  itemName: string;
  unit: string;
  qty: number;
  remarks: string;
}

// Sample data - Replace with actual API call
const sampleData: WIPData[] = [
  {
    id: 1,
    itemCode: 'SFG-001',
    itemName: 'Semi-Finished Product A',
    unit: 'PCS',
    qty: 150,
    remarks: 'In assembly line 1',
  },
  {
    id: 2,
    itemCode: 'SFG-002',
    itemName: 'Semi-Finished Product B',
    unit: 'PCS',
    qty: 200,
    remarks: 'In assembly line 2',
  },
  {
    id: 3,
    itemCode: 'SFG-003',
    itemName: 'Semi-Finished Product C',
    unit: 'PCS',
    qty: 75,
    remarks: 'In quality control',
  },
];

export default function WIPReportPage() {
  const theme = useTheme();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
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
      'Item Code': row.itemCode,
      'Item Name': row.itemName,
      'Unit': row.unit,
      'Qty': row.qty,
      'Remarks': row.remarks,
    }));

    exportToExcel(
      exportData,
      `LPJ_Work_In_Progress_${selectedDate}`,
      'WIP'
    );
  };

  const handleExportPDF = () => {
    const exportData = data.map((row, index) => ({
      no: index + 1,
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit,
      qty: row.qty.toString(),
      remarks: row.remarks || '-',
    }));

    const columns = [
      { header: 'No', dataKey: 'no' },
      { header: 'Item Code', dataKey: 'itemCode' },
      { header: 'Item Name', dataKey: 'itemName' },
      { header: 'Unit', dataKey: 'unit' },
      { header: 'Qty', dataKey: 'qty' },
      { header: 'Remarks', dataKey: 'remarks' },
    ];

    exportToPDF(
      exportData,
      columns,
      `LPJ_Work_In_Progress_${selectedDate}`,
      'LPJ Work In Progress',
      `Date: ${formatDate(selectedDate)}`
    );
  };

  const paginatedData = data.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const totalQty = data.reduce((sum, item) => sum + item.qty, 0);

  return (
    <ReportLayout
      title="LPJ Work In Progress"
      subtitle="Laporan Pertanggungjawaban Barang Setengah Jadi dalam Proses"
      actions={
        <Stack spacing={3}>
          <DateSelector
            date={selectedDate}
            onDateChange={setSelectedDate}
            label="Select Report Date"
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
        <Table sx={{ minWidth: 650 }} aria-label="wip report table">
          <TableHead>
            <TableRow
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.08),
              }}
            >
              <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Qty</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Remarks</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                  <Typography variant="body1" color="text.secondary">
                    No data available for the selected date
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              <>
                {paginatedData.map((row, index) => (
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
                        {row.itemCode}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.itemName}</TableCell>
                    <TableCell>
                      <Chip label={row.unit} size="small" />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>
                        {row.qty.toLocaleString('id-ID')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {row.remarks || '-'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow
                  sx={{
                    bgcolor: alpha(theme.palette.warning.main, 0.1),
                    '& td': { fontWeight: 700 },
                  }}
                >
                  <TableCell colSpan={4} align="right">
                    <Typography variant="body1" fontWeight={700}>
                      Total:
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body1" fontWeight={700} color="primary">
                      {totalQty.toLocaleString('id-ID')}
                    </Typography>
                  </TableCell>
                  <TableCell />
                </TableRow>
              </>
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
