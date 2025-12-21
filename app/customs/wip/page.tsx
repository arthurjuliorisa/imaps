'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ToastProvider';
import { Box, Stack } from '@mui/material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { WIPReportTable, WIPData } from '@/app/components/customs/WIPReportTable';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';

export default function WIPMutationPage() {
  const toast = useToast();

  // Default date range: last 30 days to today
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [data, setData] = useState<WIPData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
      });

      const response = await fetch(`/api/customs/wip?${params}`);
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Error fetching WIP mutation data:', error);
      toast.error('Failed to load WIP mutation data');
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
    const exportData = data.map((row) => ({
      No: row.no,
      'Company Name': row.companyName || '-',
      'Item Code': row.itemCode,
      'Item Name': row.itemName,
      'Item Type': row.itemType || '-',
      'Unit': row.unitQuantity,
      'Quantity': row.quantity,
      'Stock Date': formatDate(row.stockDate),
      'Remarks': row.remarks || '-',
      'Created At': formatDate(row.createdAt),
    }));

    exportToExcel(
      exportData,
      `WIP_Stock_Position_${startDate}_${endDate}`,
      'WIP Stock Position'
    );
  };

  const handleExportPDF = () => {
    const exportData = data.map((row) => ({
      no: row.no,
      companyName: row.companyName || '-',
      itemCode: row.itemCode,
      itemName: row.itemName,
      itemType: row.itemType || '-',
      unit: row.unitQuantity,
      quantity: row.quantity.toString(),
      stockDate: formatDate(row.stockDate),
      remarks: row.remarks || '-',
      createdAt: formatDate(row.createdAt),
    }));

    const columns = [
      { header: 'No', dataKey: 'no' },
      { header: 'Company', dataKey: 'companyName' },
      { header: 'Item Code', dataKey: 'itemCode' },
      { header: 'Item Name', dataKey: 'itemName' },
      { header: 'Type', dataKey: 'itemType' },
      { header: 'Unit', dataKey: 'unit' },
      { header: 'Quantity', dataKey: 'quantity' },
      { header: 'Stock Date', dataKey: 'stockDate' },
      { header: 'Remarks', dataKey: 'remarks' },
      { header: 'Created At', dataKey: 'createdAt' },
    ];

    exportToPDF(
      exportData,
      columns,
      `WIP_Stock_Position_${startDate}_${endDate}`,
      'WIP Stock Position Report',
      `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`
    );
  };

  const handleEdit = (item: WIPData) => {
    console.log('Edit item:', item);
    // Implement edit functionality
  };

  const handleView = (item: WIPData) => {
    console.log('View item:', item);
    // Implement view functionality
  };

  return (
    <ReportLayout
      title="LPJ Mutasi WIP"
      subtitle="Laporan Pertanggungjawaban Mutasi Work In Process"
      actions={
        <Stack spacing={3}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
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
      <WIPReportTable
        data={data}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        onEdit={handleEdit}
        onView={handleView}
        loading={loading}
      />
    </ReportLayout>
  );
}
