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
    itemCode: 'CAP-001',
    itemName: 'CNC Machine',
    unit: 'UNIT',
    beginning: 5,
    in: 1,
    out: 0,
    adjustment: 0,
    ending: 6,
    stockOpname: 6,
    variant: 0,
    remarks: 'New machine purchased',
  },
  {
    id: 2,
    itemCode: 'CAP-002',
    itemName: 'Forklift',
    unit: 'UNIT',
    beginning: 3,
    in: 0,
    out: 1,
    adjustment: 0,
    ending: 2,
    stockOpname: 2,
    variant: 0,
    remarks: 'Old unit sold',
  },
  {
    id: 3,
    itemCode: 'CAP-003',
    itemName: 'Welding Machine',
    unit: 'UNIT',
    beginning: 8,
    in: 2,
    out: 0,
    adjustment: 0,
    ending: 10,
    stockOpname: 10,
    variant: 0,
    remarks: 'Capacity expansion',
  },
];

export default function CapitalGoodsMutationPage() {
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
      `LPJ_Mutasi_Barang_Modal_${startDate}_${endDate}`,
      'Capital Goods Mutation'
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
      `LPJ_Mutasi_Barang_Modal_${startDate}_${endDate}`,
      'LPJ Mutasi Barang Modal',
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
      title="LPJ Mutasi Barang Modal"
      subtitle="Laporan Pertanggungjawaban Mutasi Barang Modal"
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
