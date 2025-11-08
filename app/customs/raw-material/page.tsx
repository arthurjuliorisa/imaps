'use client';

import React, { useState } from 'react';
import { Box, Stack } from '@mui/material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { MutationReportTable, MutationData } from '@/app/components/customs/MutationReportTable';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';

// Sample data - Replace with actual API call
const sampleData: MutationData[] = [
  {
    id: 1,
    itemCode: 'RM-001',
    itemName: 'Steel Plate',
    unit: 'KG',
    beginning: 5000,
    in: 1000,
    out: 800,
    adjustment: 0,
    ending: 5200,
    stockOpname: 5200,
    variant: 0,
    remarks: 'Normal flow',
  },
  {
    id: 2,
    itemCode: 'RM-002',
    itemName: 'Aluminum Sheet',
    unit: 'PCS',
    beginning: 2000,
    in: 500,
    out: 600,
    adjustment: -50,
    ending: 1850,
    stockOpname: 1900,
    variant: 50,
    remarks: 'Stock variance detected',
  },
  {
    id: 3,
    itemCode: 'RM-003',
    itemName: 'Copper Wire',
    unit: 'M',
    beginning: 10000,
    in: 2000,
    out: 1500,
    adjustment: 0,
    ending: 10500,
    stockOpname: 10500,
    variant: 0,
    remarks: '',
  },
];

export default function RawMaterialMutationPage() {
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
      `LPJ_Mutasi_Bahan_Baku_${startDate}_${endDate}`,
      'Raw Material Mutation'
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
      `LPJ_Mutasi_Bahan_Baku_${startDate}_${endDate}`,
      'LPJ Mutasi Bahan Baku/Bahan Penolong',
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

  return (
    <ReportLayout
      title="LPJ Mutasi Bahan Baku/Bahan Penolong"
      subtitle="Laporan Pertanggungjawaban Mutasi Bahan Baku dan Bahan Penolong"
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
      <MutationReportTable
        data={data}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        onEdit={handleEdit}
        onView={handleView}
      />
    </ReportLayout>
  );
}
