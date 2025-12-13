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
            name="header.usageDate"
            control={control}
            rules={{ required: 'Usage date is required' }}
            render={({ field: { onChange, value }, fieldState: { error } }) => (
              <DatePicker
                label="Usage Date"
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
            name="header.remarks"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Remarks"
                multiline
                rows={3}
                placeholder="Enter any additional notes (optional)"
                helperText={`${(field.value || '').length}/500 characters`}
                inputProps={{ maxLength: 500 }}
              />
            )}
          />
        </Stack>
      </LocalizationProvider>
    </Paper>
  );
}
