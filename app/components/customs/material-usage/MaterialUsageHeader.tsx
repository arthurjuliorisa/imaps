'use client';

import React from 'react';
import { Box, TextField, Paper, Typography, Stack } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { Controller, Control } from 'react-hook-form';
import dayjs from 'dayjs';
import { MaterialUsageFormData } from '@/types/material-usage';
import { WorkOrderSelector } from './WorkOrderSelector';

interface MaterialUsageHeaderProps {
  control: Control<MaterialUsageFormData>;
}

export function MaterialUsageHeader({ control }: MaterialUsageHeaderProps) {
  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom fontWeight="bold" color="primary">
        Material Usage Information
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Enter the general information for material usage transaction
      </Typography>

      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Stack spacing={3}>
          <Controller
            name="header.transaction_date"
            control={control}
            rules={{ required: 'Transaction date is required' }}
            render={({ field: { onChange, value }, fieldState: { error } }) => (
              <DatePicker
                label="Transaction Date"
                value={value ? dayjs(value) : null}
                onChange={(newValue) => {
                  onChange(newValue ? newValue.toDate() : null);
                }}
                maxDate={dayjs()}
                slotProps={{
                  textField: {
                    fullWidth: true,
                    required: true,
                    error: !!error,
                    helperText: error?.message || 'Date when materials were used',
                  },
                }}
              />
            )}
          />

          <WorkOrderSelector control={control} />

          <Controller
            name="header.internal_evidence_number"
            control={control}
            rules={{ required: 'Internal evidence number is required' }}
            render={({ field, fieldState: { error } }) => (
              <TextField
                {...field}
                label="Internal Evidence Number"
                placeholder="Enter internal evidence number"
                required
                error={!!error}
                helperText={error?.message || 'Internal document reference number'}
              />
            )}
          />
        </Stack>
      </LocalizationProvider>
    </Paper>
  );
}
