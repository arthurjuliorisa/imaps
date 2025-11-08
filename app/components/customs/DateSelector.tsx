'use client';

import React from 'react';
import { Box, TextField } from '@mui/material';
import { CalendarMonth as CalendarIcon } from '@mui/icons-material';

interface DateSelectorProps {
  date: string;
  onDateChange: (date: string) => void;
  label?: string;
}

export function DateSelector({ date, onDateChange, label = 'Select Date' }: DateSelectorProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
      <CalendarIcon sx={{ color: 'text.secondary' }} />
      <TextField
        label={label}
        type="date"
        value={date}
        onChange={(e) => onDateChange(e.target.value)}
        InputLabelProps={{
          shrink: true,
        }}
        size="small"
        sx={{ minWidth: 200 }}
      />
    </Box>
  );
}
