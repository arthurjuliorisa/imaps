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
                    helperText: error?.message || 'Date when production was completed',
                  },
                }}
              />
            )}
          />

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
                helperText={error?.message || 'Unique document number for this production output'}
              />
            )}
          />

          <Controller
            name="header.reversal"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Reversal"
                placeholder="Enter reversal indicator (optional)"
                helperText="Optional reversal indicator (max 1 character)"
                inputProps={{ maxLength: 1 }}
              />
            )}
          />
        </Stack>
      </LocalizationProvider>
    </Paper>
  );
}
