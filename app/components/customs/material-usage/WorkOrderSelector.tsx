'use client';

import React from 'react';
import { TextField } from '@mui/material';
import { Controller, Control } from 'react-hook-form';
import { MaterialUsageFormData } from '@/types/material-usage';

interface WorkOrderSelectorProps {
  control: Control<MaterialUsageFormData>;
  disabled?: boolean;
}

export function WorkOrderSelector({ control, disabled = false }: WorkOrderSelectorProps) {
  return (
    <Controller
      name="header.workOrderNumber"
      control={control}
      rules={{ required: 'Work order number is required' }}
      render={({ field, fieldState: { error } }) => (
        <TextField
          {...field}
          fullWidth
          label="Work Order Number"
          placeholder="e.g., WO-2024-001"
          required
          disabled={disabled}
          error={!!error}
          helperText={error?.message || 'Enter the work order number for material consumption'}
          inputProps={{ maxLength: 50 }}
        />
      )}
    />
  );
}
