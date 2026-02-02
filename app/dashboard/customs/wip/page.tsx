'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ToastProvider';
import { Box, Stack } from '@mui/material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { MutationReportTable, MutationData } from '@/app/components/customs/MutationReportTable';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';

interface WIPBalanceData {
  no: number;
  companyName: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  unitQuantity: string;
  quantity: number;
  stockDate: string;
  remarks: string | null;
  createdAt: string;
}

export default function WIPReportPage() {
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
      const result: WIPBalanceData[] = await response.json();

      // Transform API response to MutationData format
      const transformedData: MutationData[] = result.map((row) => ({
        id: `${row.itemCode}-${row.stockDate}`,
        itemCode: row.itemCode,
        itemName: row.itemName,
        unit: row.unitQuantity,
        beginning: row.quantity, // WIP balance is the current position
        in: 0,
        out: 0,
        adjustment: 0,
        ending: row.quantity,
        stockOpname: row.quantity,
        variant: 0,
        remarks: row.remarks || '-',
      }));

      setData(transformedData);
    } catch (error) {
      console.error('Error fetching WIP balance data:', error);
      toast.error('Gagal memuat data posisi barang dalam proses');
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
    const exportData = data.map((row, idx) => ({
      No: idx + 1,
      'Item Code': row.itemCode,
      'Item Name': row.itemName,
      'Unit': row.unit,
      'Quantity': row.ending,
      'Remarks': row.remarks || '-',
    }));

    exportToExcel(
      exportData,
      `Laporan_Posisi_Barang_Dalam_Proses_${startDate}_${endDate}`,
      'Laporan Posisi Barang Dalam Proses'
    );
  };

  const handleExportPDF = () => {
    const exportData = data.map((row, idx) => ({
      no: idx + 1,
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit,
      quantity: row.ending.toString(),
      remarks: row.remarks || '-',
    }));

    const columns = [
      { header: 'No', dataKey: 'no' },
      { header: 'Item Code', dataKey: 'itemCode' },
      { header: 'Item Name', dataKey: 'itemName' },
      { header: 'Unit', dataKey: 'unit' },
      { header: 'Quantity', dataKey: 'quantity' },
      { header: 'Remarks', dataKey: 'remarks' },
    ];

    exportToPDF(
      exportData,
      columns,
      `Laporan_Posisi_Barang_Dalam_Proses_${startDate}_${endDate}`,
      'Laporan Posisi Barang Dalam Proses'
    );
  };

  return (
    <ReportLayout
      title="Laporan Posisi Barang Dalam Proses"
      subtitle="Laporan posisi barang dalam proses produksi di kawasan berikat"
      actions={
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          <ExportButtons
            onExportExcel={handleExportExcel}
            onExportPDF={handleExportPDF}
          />
        </Box>
      }
    >
      <MutationReportTable
        data={data}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </ReportLayout>
  );
}
