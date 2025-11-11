'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Stack, Button } from '@mui/material';
import { Add as AddIcon, UploadFile as UploadFileIcon } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { MutationReportTable, MutationData } from '@/app/components/customs/MutationReportTable';
import { ManualEntryDialog } from '@/app/components/customs/ManualEntryDialog';
import { ExcelImportDialog } from '@/app/components/customs/ExcelImportDialog';
import { useToast } from '@/app/components/ToastProvider';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';
import dayjs from 'dayjs';

// Sample data - Replace with actual API call
const sampleData: MutationData[] = [
  {
    id: 1,
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
    id: 2,
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
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-12-31');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [data, setData] = useState<MutationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
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
      'Remarks': row.remarks,
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
      remarks: row.remarks || '-',
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
      { header: 'Remarks', dataKey: 'remarks' },
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

  // Handle manual entry submission
  const handleManualEntrySubmit = async (formData: any) => {
    try {
      const response = await fetch('/api/customs/scrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: formData.date?.format('YYYY-MM-DD'),
          itemId: formData.itemId,
          uomId: formData.uomId,
          incoming: formData.incoming,
          remarks: formData.remarks,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save data');
      }

      const result = await response.json();

      toast.success('Incoming scrap record added successfully!');
      // Refresh data
      // fetchData(); // Uncomment when API is ready

      // For demo: add to existing data
      // Backend should return the complete record with calculated values
      const newRecord: MutationData = {
        id: data.length + 1,
        itemCode: formData.itemCode,
        itemName: formData.itemName,
        unit: formData.uom,
        beginning: result.beginning || 0, // From backend calculation
        in: formData.incoming,
        out: 0, // Incoming-only records have 0 for these
        adjustment: 0,
        ending: result.ending || formData.incoming, // From backend calculation
        stockOpname: result.stockOpname || result.ending || formData.incoming,
        variant: 0,
        remarks: formData.remarks,
      };
      setData([...data, newRecord]);
    } catch (error) {
      console.error('Error saving data:', error);
      toast.error('Failed to save incoming scrap record. Please try again.');
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
            itemCode: r.itemCode,
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
      // fetchData(); // Uncomment when API is ready

      // For demo: add to existing data
      // Backend should return the complete records with calculated values
      const newRecords: MutationData[] = records.map((record, index) => ({
        id: data.length + index + 1,
        itemCode: record.itemCode,
        itemName: `Item ${record.itemCode}`, // This should come from API
        unit: 'KG', // This should come from API
        beginning: 0, // Backend will calculate from previous day
        in: record.incoming,
        out: 0, // Incoming-only records have 0 for these
        adjustment: 0,
        ending: record.incoming, // Backend will calculate: beginning + incoming
        stockOpname: record.incoming, // Backend will set this
        variant: 0,
        remarks: record.remarks,
      }));
      setData([...data, ...newRecords]);
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
              onClick={() => setManualEntryOpen(true)}
              sx={{
                textTransform: 'none',
                borderRadius: 2,
                bgcolor: 'success.main',
                '&:hover': {
                  bgcolor: 'success.dark',
                },
              }}
            >
              Add Manually
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
      />

      {/* Manual Entry Dialog */}
      <ManualEntryDialog
        open={manualEntryOpen}
        onClose={() => setManualEntryOpen(false)}
        onSubmit={handleManualEntrySubmit}
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
