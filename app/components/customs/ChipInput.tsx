'use client';

import React, { useState, KeyboardEvent } from 'react';
import {
  TextField,
  Chip,
  Box,
  Stack,
  TextFieldProps,
} from '@mui/material';

interface ChipInputProps {
  label: string;
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  helperText?: string;
  required?: boolean;
  error?: boolean;
  disabled?: boolean;
}

export function ChipInput({
  label,
  value = [],
  onChange,
  placeholder = 'Type and press Enter to add',
  helperText,
  required = false,
  error = false,
  disabled = false,
}: ChipInputProps) {
  const [inputValue, setInputValue] = useState('');

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addChip();
    }
  };

  const addChip = () => {
    // Remove trailing comma and trim
    const trimmedValue = inputValue.trim().replace(/,+$/, '');

    if (trimmedValue && !value.includes(trimmedValue)) {
      onChange([...value, trimmedValue]);
      setInputValue('');
    } else if (trimmedValue && value.includes(trimmedValue)) {
      // Value already exists, just clear input
      setInputValue('');
    }
  };

  const handleDelete = (chipToDelete: string) => {
    onChange(value.filter((chip) => chip !== chipToDelete));
  };

  const handleBlur = () => {
    // Add chip on blur if there's text
    if (inputValue.trim()) {
      addChip();
    }
  };

  return (
    <Box>
      <TextField
        fullWidth
        label={label}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? placeholder : ''}
        helperText={helperText}
        required={required}
        error={error}
        disabled={disabled}
        InputProps={{
          startAdornment: value.length > 0 ? (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mr: 1 }}>
              {value.map((chip, index) => (
                <Chip
                  key={index}
                  label={chip}
                  onDelete={disabled ? undefined : () => handleDelete(chip)}
                  size="small"
                  sx={{
                    maxWidth: '200px',
                    '& .MuiChip-label': {
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  }}
                />
              ))}
            </Stack>
          ) : undefined,
        }}
      />
    </Box>
  );
}
