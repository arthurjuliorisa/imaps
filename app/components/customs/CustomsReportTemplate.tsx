'use client';

import React, { useState } from 'react';
import { Box } from '@mui/material';
import { ReportLayout } from './ReportLayout';
import { DateRangeFilter } from './DateRangeFilter';
import { ExportButtons } from './ExportButtons';
import { MutationReportTable, MutationData } from './MutationReportTable';

interface CustomsReportTemplateProps {
  title: string;
  subtitle?: string;
  sampleData: MutationData[];
}

export function CustomsReportTemplate({
  title,
  subtitle,
  sampleData
}: CustomsReportTemplateProps) {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const handleExportExcel = () => {
    console.log('Exporting to Excel...', { startDate, endDate });
  };

  const handleExportPDF = () => {
    console.log('Exporting to PDF...', { startDate, endDate });
  };

  const handlePageChange = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  return (
    <ReportLayout
      title={title}
      subtitle={subtitle}
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
        data={sampleData}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={handlePageChange}
        onRowsPerPageChange={handleRowsPerPageChange}
      />
    </ReportLayout>
  );
}
