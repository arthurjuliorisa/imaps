'use client';

import React from 'react';
import { Box, TextField, Paper, Typography, Stack } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { Controller, Control } from 'react-hook-form';
import dayjs from 'dayjs';
import { ProductionOutputFormData } from '@/types/production';

interface ProductionOutputHeaderProps {
  control: Control<ProductionOutputFormData>;
}

export function ProductionOutputHeader({ control }: ProductionOutputHeaderProps) {
  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom fontWeight="bold" color="primary">
        Production Output Information
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Enter the general information for production output transaction
      </Typography>

      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Stack spacing={3}>
          <Controller
            name="header.productionDate"
            control={control}
            rules={{ required: 'Production date is required' }}
            render={({ field: { onChange, value }, fieldState: { error } }) => (
              <DatePicker
                label="Production Date"
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
                    helperText: error?.message || 'Date when production was completed',
                  },
                }}
              />
            )}
          />

          <Controller
            name="header.batchNumber"
            control={control}
            rules={{ required: 'Batch number is required' }}
            render={({ field, fieldState: { error } }) => (
              <TextField
                {...field}
                label="Batch Number"
                placeholder="Enter production batch number"
                required
                error={!!error}
                helperText={error?.message || 'Unique identifier for this production batch'}
              />
            )}
          />

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
