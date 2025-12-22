'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Stack, Button } from '@mui/material';
import { Add as AddIcon, UploadFile as UploadFileIcon, RemoveCircleOutline as RemoveIcon } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { MutationReportTable, MutationData } from '@/app/components/customs/MutationReportTable';
import { ScrapIncomingDialog } from '@/app/components/customs/ScrapIncomingDialog';
import { ScrapOutgoingDialog } from '@/app/components/customs/ScrapOutgoingDialog';
import { ExcelImportDialog } from '@/app/components/customs/ExcelImportDialog';
import { useToast } from '@/app/components/ToastProvider';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';
import dayjs from 'dayjs';

// Sample data - Replace with actual API call
const sampleData: MutationData[] = [
  {
    id: '1',
    itemCode: 'SCRAP-001',
    itemName: 'Metal Scrap',
    unit: 'KG',
    beginning: 500,
    in: 150,
    out: 200,
    adjustment: 0,
    ending: 450,
    stockOpname: 450,
    variant: 0,
    remarks: 'Sold to recycling company',
  },
  {
    id: '2',
    itemCode: 'SCRAP-002',
    itemName: 'Plastic Scrap',
    unit: 'KG',
    beginning: 300,
    in: 80,
    out: 100,
    adjustment: -5,
    ending: 275,
    stockOpname: 280,
    variant: 5,
    remarks: 'Weight discrepancy',
  },
];

export default function ScrapMutationPage() {
  const toast = useToast();

  // Default date range: last 30 days to today
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [data, setData] = useState<MutationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [incomingDialogOpen, setIncomingDialogOpen] = useState(false);
  const [outgoingDialogOpen, setOutgoingDialogOpen] = useState(false);
  const [excelImportOpen, setExcelImportOpen] = useState(false);

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
      'Beginning': row.beginning,
      'In': row.in,
      'Out': row.out,
      'Adjustment': row.adjustment,
      'Ending': row.ending,
      'Stock Opname': row.stockOpname,
      'Variant': row.variant,
    }));

    exportToExcel(
      exportData,
      `LPJ_Mutasi_Barang_Scrap_${startDate}_${endDate}`,
      'Scrap Mutation'
    );
  };

  const handleExportPDF = () => {
    const exportData = data.map((row, index) => ({
      no: index + 1,
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit,
      beginning: row.beginning.toString(),
      in: row.in.toString(),
      out: row.out.toString(),
      adjustment: row.adjustment.toString(),
      ending: row.ending.toString(),
      stockOpname: row.stockOpname.toString(),
      variant: row.variant.toString(),
    }));

    const columns = [
      { header: 'No', dataKey: 'no' },
      { header: 'Item Code', dataKey: 'itemCode' },
      { header: 'Item Name', dataKey: 'itemName' },
      { header: 'Unit', dataKey: 'unit' },
      { header: 'Beginning', dataKey: 'beginning' },
      { header: 'In', dataKey: 'in' },
      { header: 'Out', dataKey: 'out' },
      { header: 'Adjustment', dataKey: 'adjustment' },
      { header: 'Ending', dataKey: 'ending' },
      { header: 'Stock Opname', dataKey: 'stockOpname' },
      { header: 'Variant', dataKey: 'variant' },
    ];

    exportToPDF(
      exportData,
      columns,
      `LPJ_Mutasi_Barang_Scrap_${startDate}_${endDate}`,
      'LPJ Mutasi Barang Scrap',
      `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`
    );
  };

  const handleEdit = (item: MutationData) => {
    console.log('Edit item:', item);
    // Implement edit functionality
  };

  const handleView = (item: MutationData) => {
    console.log('View item:', item);
    // Implement view functionality
  };

  // Fetch data from API
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/customs/scrap?startDate=${startDate}&endDate=${endDate}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }
      const result = await response.json();
      // Backend returns array directly, not wrapped in {data: []}
      setData(Array.isArray(result) ? result : []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, toast]);

  // Load data on mount and when date range changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle incoming scrap submission
  const handleIncomingSubmit = async (formData: any) => {
    try {
      const response = await fetch('/api/customs/scrap/incoming', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: formData.date?.format('YYYY-MM-DD'),
          scrapCode: formData.scrapCode,
          qty: formData.qty,
          currency: formData.currency,
          amount: formData.amount,
          remarks: formData.remarks || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save data');
      }

      const result = await response.json();

      toast.success('Incoming scrap transaction added successfully!');
      await fetchData();
    } catch (error: any) {
      console.error('Error saving incoming scrap:', error);
      toast.error(error.message || 'Failed to save incoming scrap. Please try again.');
      throw error;
    }
  };

  // Handle outgoing scrap submission
  const handleOutgoingSubmit = async (formData: any) => {
    try {
      const response = await fetch('/api/customs/scrap/outgoing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: formData.date?.format('YYYY-MM-DD'),
          scrapCode: formData.scrapCode,
          qty: formData.qty,
          currency: formData.currency,
          amount: formData.amount,
          recipientName: formData.recipientName,
          remarks: formData.remarks || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save data');
      }

      const result = await response.json();

      toast.success('Outgoing scrap transaction added successfully!');
      await fetchData();
    } catch (error: any) {
      console.error('Error saving outgoing scrap:', error);
      toast.error(error.message || 'Failed to save outgoing scrap. Please try again.');
      throw error;
    }
  };

  // Handle Excel import submission
  const handleExcelImportSubmit = async (records: any[]) => {
    try {
      const response = await fetch('/api/customs/scrap/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          records: records.map(r => ({
            date: r.date,
            scrapCode: r.scrapCode,
            incoming: r.incoming,
            remarks: r.remarks
          }))
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to import data');
      }

      const result = await response.json();

      toast.success(`Successfully imported ${records.length} incoming scrap record(s)!`);
      // Refresh data
      await fetchData();
    } catch (error) {
      console.error('Error importing data:', error);
      toast.error('Failed to import records. Please try again.');
      throw error;
    }
  };

  return (
    <ReportLayout
      title="LPJ Mutasi Barang Scrap"
      subtitle="Laporan Pertanggungjawaban Mutasi Barang Scrap"
      actions={
        <Stack spacing={3}>
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setIncomingDialogOpen(true)}
              sx={{
                textTransform: 'none',
                borderRadius: 2,
                bgcolor: 'success.main',
                '&:hover': {
                  bgcolor: 'success.dark',
                },
              }}
            >
              Add Incoming Scrap
            </Button>
            <Button
              variant="contained"
              startIcon={<RemoveIcon />}
              onClick={() => setOutgoingDialogOpen(true)}
              sx={{
                textTransform: 'none',
                borderRadius: 2,
                bgcolor: 'warning.main',
                '&:hover': {
                  bgcolor: 'warning.dark',
                },
              }}
            >
              Add Outgoing Scrap
            </Button>
            <Button
              variant="contained"
              startIcon={<UploadFileIcon />}
              onClick={() => setExcelImportOpen(true)}
              sx={{
                textTransform: 'none',
                borderRadius: 2,
                bgcolor: 'info.main',
                '&:hover': {
                  bgcolor: 'info.dark',
                },
              }}
            >
              Import from Excel
            </Button>
            <ExportButtons
              onExportExcel={handleExportExcel}
              onExportPDF={handleExportPDF}
              disabled={data.length === 0}
            />
          </Box>
        </Stack>
      }
    >
      <MutationReportTable
        data={data}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        onEdit={handleEdit}
        onView={handleView}
        loading={loading}
        hideRemarks={true}
        hideActions={true}
        hideValueAmount={true}
      />

      {/* Incoming Scrap Dialog */}
      <ScrapIncomingDialog
        open={incomingDialogOpen}
        onClose={() => setIncomingDialogOpen(false)}
        onSubmit={handleIncomingSubmit}
      />

      {/* Outgoing Scrap Dialog */}
      <ScrapOutgoingDialog
        open={outgoingDialogOpen}
        onClose={() => setOutgoingDialogOpen(false)}
        onSubmit={handleOutgoingSubmit}
      />

      {/* Excel Import Dialog */}
      <ExcelImportDialog
        open={excelImportOpen}
        onClose={() => setExcelImportOpen(false)}
        onSubmit={handleExcelImportSubmit}
      />
    </ReportLayout>
  );
}
