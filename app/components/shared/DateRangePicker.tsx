'use client';

import React, { useState, useCallback } from 'react';
import {
  Box,
  TextField,
  Stack,
  Typography,
  Paper,
  Popover,
  Button,
  FormHelperText,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import {
  CalendarMonth as CalendarIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import dayjs, { Dayjs } from 'dayjs';
import { DateRange } from '@/types/stock-calculation';

/**
 * Date Range Picker Props
 */
export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;

  // Field configuration
  label?: string;
  helperText?: string;
  error?: boolean;
  disabled?: boolean;
  required?: boolean;

  // Validation
  minDate?: Date;
  maxDate?: Date;
  disableFuture?: boolean;
  disablePast?: boolean;

  // Display
  format?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;

  // Quick presets
  showPresets?: boolean;
}

/**
 * Date Range Preset
 */
interface DateRangePreset {
  label: string;
  getValue: () => DateRange;
}

/**
 * DateRangePicker Component
 *
 * A date range selector component that provides:
 * - Start and end date selection
 * - Quick preset options (Today, This Week, This Month, etc.)
 * - Date validation
 * - Formatted display
 * - Responsive design
 *
 * Usage:
 * ```tsx
 * <DateRangePicker
 *   value={dateRange}
 *   onChange={setDateRange}
 *   label="Document Date Range"
 *   showPresets
 * />
 * ```
 */
export default function DateRangePicker({
  value,
  onChange,
  label = 'Date Range',
  helperText,
  error = false,
  disabled = false,
  required = false,
  minDate,
  maxDate,
  disableFuture = false,
  disablePast = false,
  format = 'MM/DD/YYYY',
  size = 'medium',
  fullWidth = true,
  showPresets = false,
}: DateRangePickerProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [tempStartDate, setTempStartDate] = useState<Dayjs | null>(
    value.startDate ? dayjs(value.startDate) : null
  );
  const [tempEndDate, setTempEndDate] = useState<Dayjs | null>(
    value.endDate ? dayjs(value.endDate) : null
  );

  const open = Boolean(anchorEl);

  // Quick date presets
  const presets: DateRangePreset[] = [
    {
      label: 'Today',
      getValue: () => ({
        startDate: dayjs().startOf('day').toDate(),
        endDate: dayjs().endOf('day').toDate(),
      }),
    },
    {
      label: 'Yesterday',
      getValue: () => ({
        startDate: dayjs().subtract(1, 'day').startOf('day').toDate(),
        endDate: dayjs().subtract(1, 'day').endOf('day').toDate(),
      }),
    },
    {
      label: 'This Week',
      getValue: () => ({
        startDate: dayjs().startOf('week').toDate(),
        endDate: dayjs().endOf('week').toDate(),
      }),
    },
    {
      label: 'Last Week',
      getValue: () => ({
        startDate: dayjs().subtract(1, 'week').startOf('week').toDate(),
        endDate: dayjs().subtract(1, 'week').endOf('week').toDate(),
      }),
    },
    {
      label: 'This Month',
      getValue: () => ({
        startDate: dayjs().startOf('month').toDate(),
        endDate: dayjs().endOf('month').toDate(),
      }),
    },
    {
      label: 'Last Month',
      getValue: () => ({
        startDate: dayjs().subtract(1, 'month').startOf('month').toDate(),
        endDate: dayjs().subtract(1, 'month').endOf('month').toDate(),
      }),
    },
    {
      label: 'This Year',
      getValue: () => ({
        startDate: dayjs().startOf('year').toDate(),
        endDate: dayjs().endOf('year').toDate(),
      }),
    },
    {
      label: 'Last Year',
      getValue: () => ({
        startDate: dayjs().subtract(1, 'year').startOf('year').toDate(),
        endDate: dayjs().subtract(1, 'year').endOf('year').toDate(),
      }),
    },
  ];

  // Handle opening the popover
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!disabled) {
      setAnchorEl(event.currentTarget);
      setTempStartDate(value.startDate ? dayjs(value.startDate) : null);
      setTempEndDate(value.endDate ? dayjs(value.endDate) : null);
    }
  };

  // Handle closing the popover
  const handleClose = () => {
    setAnchorEl(null);
  };

  // Handle applying the date range
  const handleApply = useCallback(() => {
    onChange({
      startDate: tempStartDate?.toDate() || null,
      endDate: tempEndDate?.toDate() || null,
    });
    handleClose();
  }, [tempStartDate, tempEndDate, onChange]);

  // Handle clearing the date range
  const handleClear = useCallback(() => {
    setTempStartDate(null);
    setTempEndDate(null);
    onChange({
      startDate: null,
      endDate: null,
    });
    handleClose();
  }, [onChange]);

  // Handle preset selection
  const handlePresetClick = (preset: DateRangePreset) => {
    const range = preset.getValue();
    setTempStartDate(dayjs(range.startDate));
    setTempEndDate(dayjs(range.endDate));
  };

  // Format display value
  const displayValue = () => {
    if (value.startDate && value.endDate) {
      return `${dayjs(value.startDate).format(format)} - ${dayjs(
        value.endDate
      ).format(format)}`;
    } else if (value.startDate) {
      return `${dayjs(value.startDate).format(format)} - ...`;
    } else if (value.endDate) {
      return `... - ${dayjs(value.endDate).format(format)}`;
    }
    return '';
  };

  // Validate date range
  const isValidRange =
    !tempStartDate ||
    !tempEndDate ||
    tempStartDate.isBefore(tempEndDate) ||
    tempStartDate.isSame(tempEndDate, 'day');

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ width: fullWidth ? '100%' : 'auto' }}>
        {/* Label */}
        {label && (
          <Typography
            variant="body2"
            color={error ? 'error' : 'text.secondary'}
            sx={{ mb: 0.5, fontWeight: 500 }}
          >
            {label}
            {required && (
              <Typography component="span" color="error">
                {' *'}
              </Typography>
            )}
          </Typography>
        )}

        {/* Display Field */}
        <TextField
          value={displayValue()}
          onClick={handleClick}
          placeholder="Select date range"
          size={size}
          fullWidth={fullWidth}
          disabled={disabled}
          error={error}
          slotProps={{
            input: {
              readOnly: true,
              startAdornment: (
                <CalendarIcon
                  sx={{
                    mr: 1,
                    color: error ? 'error.main' : 'action.active',
                  }}
                />
              ),
              endAdornment: value.startDate || value.endDate ? (
                <CloseIcon
                  sx={{
                    cursor: disabled ? 'default' : 'pointer',
                    color: 'action.active',
                    '&:hover': disabled
                      ? {}
                      : {
                          color: 'action.hover',
                        },
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!disabled) {
                      handleClear();
                    }
                  }}
                />
              ) : undefined,
            },
          }}
          sx={{
            cursor: disabled ? 'default' : 'pointer',
            '& .MuiInputBase-input': {
              cursor: disabled ? 'default' : 'pointer',
            },
          }}
        />

        {/* Helper Text */}
        {helperText && (
          <FormHelperText error={error}>{helperText}</FormHelperText>
        )}

        {/* Popover with Date Pickers */}
        <Popover
          open={open}
          anchorEl={anchorEl}
          onClose={handleClose}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'left',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'left',
          }}
          slotProps={{
            paper: {
              sx: {
                mt: 1,
                p: 2,
                minWidth: showPresets ? 600 : 400,
              },
            },
          }}
        >
          <Stack direction={showPresets ? 'row' : 'column'} spacing={2}>
            {/* Quick Presets */}
            {showPresets && (
              <Paper
                variant="outlined"
                sx={{
                  p: 1,
                  minWidth: 150,
                  bgcolor: 'grey.50',
                }}
              >
                <Typography
                  variant="subtitle2"
                  fontWeight={600}
                  sx={{ mb: 1, px: 1 }}
                >
                  Quick Select
                </Typography>
                <Stack spacing={0.5}>
                  {presets.map((preset) => (
                    <Button
                      key={preset.label}
                      variant="text"
                      size="small"
                      onClick={() => handlePresetClick(preset)}
                      sx={{
                        justifyContent: 'flex-start',
                        textTransform: 'none',
                        fontWeight: 400,
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </Stack>
              </Paper>
            )}

            {/* Date Pickers */}
            <Box>
              <Stack spacing={2}>
                {/* Start Date */}
                <DatePicker
                  label="Start Date"
                  value={tempStartDate}
                  onChange={(newValue) => setTempStartDate(newValue)}
                  minDate={minDate ? dayjs(minDate) : undefined}
                  maxDate={
                    tempEndDate
                      ? tempEndDate
                      : maxDate
                      ? dayjs(maxDate)
                      : undefined
                  }
                  disableFuture={disableFuture}
                  disablePast={disablePast}
                  format={format}
                  slotProps={{
                    textField: {
                      size,
                      fullWidth: true,
                    },
                  }}
                />

                {/* End Date */}
                <DatePicker
                  label="End Date"
                  value={tempEndDate}
                  onChange={(newValue) => setTempEndDate(newValue)}
                  minDate={
                    tempStartDate
                      ? tempStartDate
                      : minDate
                      ? dayjs(minDate)
                      : undefined
                  }
                  maxDate={maxDate ? dayjs(maxDate) : undefined}
                  disableFuture={disableFuture}
                  disablePast={disablePast}
                  format={format}
                  slotProps={{
                    textField: {
                      size,
                      fullWidth: true,
                      error: !isValidRange,
                      helperText: !isValidRange
                        ? 'End date must be after start date'
                        : undefined,
                    },
                  }}
                />

                {/* Action Buttons */}
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button variant="outlined" size="small" onClick={handleClear}>
                    Clear
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleApply}
                    disabled={!isValidRange}
                  >
                    Apply
                  </Button>
                </Stack>
              </Stack>
            </Box>
          </Stack>
        </Popover>
      </Box>
    </LocalizationProvider>
  );
}
