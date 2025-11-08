'use client';

import React from 'react';
import { Box, TextField, Stack } from '@mui/material';
import { DateRange as DateRangeIcon } from '@mui/icons-material';

interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
}

export function DateRangeFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: DateRangeFilterProps) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <DateRangeIcon sx={{ color: 'text.secondary' }} />
        <TextField
          label="Start Date"
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          InputLabelProps={{
            shrink: true,
          }}
          size="small"
          sx={{ minWidth: 180 }}
        />
      </Box>
      <TextField
        label="End Date"
        type="date"
        value={endDate}
        onChange={(e) => onEndDateChange(e.target.value)}
        InputLabelProps={{
          shrink: true,
        }}
        size="small"
        sx={{ minWidth: 180 }}
      />
    </Stack>
  );
}
