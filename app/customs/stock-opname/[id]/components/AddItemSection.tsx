'use client';

import React, { useState } from 'react';
import {
  Paper,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Upload as UploadIcon } from '@mui/icons-material';
import { ManualInputDialog } from './ManualInputDialog';
import { ExcelUploadDialog } from './ExcelUploadDialog';

interface AddItemSectionProps {
  stockOpnameId: number;
  onItemAdded: () => void;
}

export function AddItemSection({ stockOpnameId, onItemAdded }: AddItemSectionProps) {
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [excelDialogOpen, setExcelDialogOpen] = useState(false);

  return (
    <>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Add Items
        </Typography>
        <Stack direction="row" spacing={2}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setManualDialogOpen(true)}
          >
            Manual Input
          </Button>
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => setExcelDialogOpen(true)}
          >
            Upload Excel
          </Button>
        </Stack>
      </Paper>

      <ManualInputDialog
        open={manualDialogOpen}
        onClose={() => setManualDialogOpen(false)}
        stockOpnameId={stockOpnameId}
        onSuccess={() => {
          setManualDialogOpen(false);
          onItemAdded();
        }}
      />

      <ExcelUploadDialog
        open={excelDialogOpen}
        onClose={() => setExcelDialogOpen(false)}
        stockOpnameId={stockOpnameId}
        onSuccess={() => {
          setExcelDialogOpen(false);
          onItemAdded();
        }}
      />
    </>
  );
}
