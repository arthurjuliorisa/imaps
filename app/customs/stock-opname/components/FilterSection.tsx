'use client';

import React from 'react';
import {
  Box,
  TextField,
  Stack,
  Chip,
  Paper,
  InputAdornment,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { StockOpnameStatus } from '@/types/stock-opname';

interface FilterSectionProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: StockOpnameStatus | '';
  onStatusChange: (status: StockOpnameStatus | '') => void;
  year: string;
  onYearChange: (year: string) => void;
  onReset: () => void;
}

const STATUS_OPTIONS: Array<{ value: StockOpnameStatus | ''; label: string; color: 'default' | 'warning' | 'info' | 'success' }> = [
  { value: '', label: 'All', color: 'default' },
  { value: 'OPEN', label: 'OPEN', color: 'warning' },
  { value: 'PROCESS', label: 'PROCESS', color: 'info' },
  { value: 'RELEASED', label: 'RELEASED', color: 'success' },
];

export function FilterSection({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  year,
  onYearChange,
}: FilterSectionProps) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {STATUS_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              color={option.color}
              variant={statusFilter === option.value ? 'filled' : 'outlined'}
              onClick={() => onStatusChange(option.value)}
              sx={{ cursor: 'pointer' }}
            />
          ))}
        </Stack>

        <Stack direction="row" spacing={2} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Year</InputLabel>
            <Select
              value={year}
              label="Year"
              onChange={(e) => onYearChange(e.target.value)}
            >
              {years.map((y) => (
                <MenuItem key={y} value={y.toString()}>
                  {y}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            placeholder="Search by STO Number or PIC Name..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            size="small"
            fullWidth
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
        </Stack>
      </Stack>
    </Paper>
  );
}
