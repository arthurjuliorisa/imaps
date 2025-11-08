'use client';

import React from 'react';
import { Button, Stack } from '@mui/material';
import { PictureAsPdf, TableChart } from '@mui/icons-material';

interface ExportButtonsProps {
  onExportExcel: () => void;
  onExportPDF: () => void;
  disabled?: boolean;
}

export function ExportButtons({ onExportExcel, onExportPDF, disabled = false }: ExportButtonsProps) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <Button
        variant="outlined"
        startIcon={<TableChart />}
        onClick={onExportExcel}
        disabled={disabled}
        color="success"
        sx={{ minWidth: 140 }}
      >
        Export Excel
      </Button>
      <Button
        variant="outlined"
        startIcon={<PictureAsPdf />}
        onClick={onExportPDF}
        disabled={disabled}
        color="error"
        sx={{ minWidth: 140 }}
      >
        Export PDF
      </Button>
    </Stack>
  );
}
