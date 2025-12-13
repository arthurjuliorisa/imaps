'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  Autocomplete,
  TextField,
  Box,
  Typography,
  Chip,
  CircularProgress,
  InputAdornment,
} from '@mui/material';
import {
  Search as SearchIcon,
  Inventory as InventoryIcon,
} from '@mui/icons-material';
import { ItemOption, ItemTypeCode } from '@/types/stock-calculation';

/**
 * Item Autocomplete Props
 */
export interface ItemAutocompleteProps {
  value?: ItemOption | ItemOption[] | null;
  onChange: (value: ItemOption | ItemOption[] | null) => void;
  onInputChange?: (value: string) => void;

  // Options
  options: ItemOption[];
  loading?: boolean;
  disabled?: boolean;

  // Filtering
  filterByType?: ItemTypeCode[];
  excludeIds?: string[];

  // Multi-select
  multiple?: boolean;
  limitTags?: number;

  // Field configuration
  label?: string;
  placeholder?: string;
  helperText?: string;
  error?: boolean;
  required?: boolean;

  // Display customization
  showType?: boolean;
  showHsCode?: boolean;
  showSpecification?: boolean;

  // Async search
  onSearch?: (query: string) => Promise<ItemOption[]>;
  searchDelay?: number;

  // Size
  size?: 'small' | 'medium';
  fullWidth?: boolean;
}

/**
 * Item Type Colors
 */
const itemTypeColors: Record<ItemTypeCode, string> = {
  RM: '#1976d2',      // Blue
  WIP: '#ed6c02',     // Orange
  FG: '#2e7d32',      // Green
  SCRAP: '#d32f2f',   // Red
  WASTE: '#757575',   // Grey
};

/**
 * Item Type Labels
 */
const itemTypeLabels: Record<ItemTypeCode, string> = {
  RM: 'Raw Material',
  WIP: 'Work In Progress',
  FG: 'Finished Good',
  SCRAP: 'Scrap',
  WASTE: 'Waste',
};

/**
 * ItemAutocomplete Component
 *
 * A specialized autocomplete component for selecting items with:
 * - Single or multiple selection
 * - Type filtering
 * - Rich option display (code, name, type, HS code)
 * - Async search support
 * - Loading states
 * - Keyboard navigation
 * - Responsive design
 *
 * Usage:
 * ```tsx
 * <ItemAutocomplete
 *   value={selectedItem}
 *   onChange={setSelectedItem}
 *   options={items}
 *   label="Select Item"
 *   filterByType={['RM', 'WIP']}
 *   showType
 *   showHsCode
 * />
 * ```
 */
export default function ItemAutocomplete({
  value,
  onChange,
  onInputChange,
  options,
  loading = false,
  disabled = false,
  filterByType,
  excludeIds = [],
  multiple = false,
  limitTags = 2,
  label = 'Select Item',
  placeholder = 'Search by code or name...',
  helperText,
  error = false,
  required = false,
  showType = true,
  showHsCode = false,
  showSpecification = false,
  onSearch,
  searchDelay = 300,
  size = 'medium',
  fullWidth = true,
}: ItemAutocompleteProps) {
  const [inputValue, setInputValue] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ItemOption[]>([]);

  // Filter options based on type and exclusions
  const filteredOptions = useMemo(() => {
    let filtered = options;

    // Filter by item type
    if (filterByType && filterByType.length > 0) {
      filtered = filtered.filter((option) =>
        filterByType.includes(option.type)
      );
    }

    // Exclude specific IDs
    if (excludeIds.length > 0) {
      filtered = filtered.filter((option) => !excludeIds.includes(option.id));
    }

    return filtered;
  }, [options, filterByType, excludeIds]);

  // Use search results if async search is active
  const displayOptions = searchResults.length > 0 ? searchResults : filteredOptions;

  // Handle input change with debounced search
  const handleInputChange = useCallback(
    (event: React.SyntheticEvent, newValue: string) => {
      setInputValue(newValue);

      if (onInputChange) {
        onInputChange(newValue);
      }

      // Trigger async search if provided
      if (onSearch && newValue.length >= 2) {
        setSearchLoading(true);

        const timeoutId = setTimeout(async () => {
          try {
            const results = await onSearch(newValue);
            setSearchResults(results);
          } catch (error) {
            console.error('Search error:', error);
            setSearchResults([]);
          } finally {
            setSearchLoading(false);
          }
        }, searchDelay);

        return () => clearTimeout(timeoutId);
      } else if (newValue.length < 2) {
        setSearchResults([]);
      }
    },
    [onInputChange, onSearch, searchDelay]
  );

  // Render option
  const renderOption = (props: React.HTMLAttributes<HTMLLIElement>, option: ItemOption) => (
    <li {...props} key={option.id}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, width: '100%' }}>
        {/* Icon */}
        <InventoryIcon
          sx={{
            mt: 0.5,
            fontSize: 20,
            color: itemTypeColors[option.type],
            flexShrink: 0,
          }}
        />

        {/* Content */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Code and Name */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{
                color: 'text.primary',
              }}
            >
              {option.code}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {option.name}
            </Typography>
          </Box>

          {/* Additional Info */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {/* Type Badge */}
            {showType && (
              <Chip
                label={option.type}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.75rem',
                  bgcolor: itemTypeColors[option.type],
                  color: 'white',
                  fontWeight: 600,
                }}
              />
            )}

            {/* HS Code */}
            {showHsCode && option.hsCode && (
              <Typography variant="caption" color="text.secondary">
                HS: {option.hsCode}
              </Typography>
            )}

            {/* Specification */}
            {showSpecification && option.specification && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {option.specification}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
    </li>
  );

  // Get option label
  const getOptionLabel = (option: ItemOption) => {
    return `${option.code} - ${option.name}`;
  };

  // Check if option is equal to value
  const isOptionEqualToValue = (option: ItemOption, value: ItemOption) => {
    return option.id === value.id;
  };

  // Render tags for multiple selection
  const renderTags = (tagValue: ItemOption[], getTagProps: any) => {
    return tagValue.map((option, index) => (
      <Chip
        {...getTagProps({ index })}
        key={option.id}
        label={option.code}
        size="small"
        sx={{
          bgcolor: itemTypeColors[option.type],
          color: 'white',
          fontWeight: 600,
          '& .MuiChip-deleteIcon': {
            color: 'rgba(255, 255, 255, 0.7)',
            '&:hover': {
              color: 'white',
            },
          },
        }}
      />
    ));
  };

  const isLoading = loading || searchLoading;

  return (
    <Autocomplete
      value={value}
      onChange={(event, newValue) => onChange(newValue)}
      inputValue={inputValue}
      onInputChange={handleInputChange}
      options={displayOptions}
      loading={isLoading}
      disabled={disabled}
      multiple={multiple}
      limitTags={limitTags}
      size={size}
      fullWidth={fullWidth}
      getOptionLabel={getOptionLabel}
      isOptionEqualToValue={isOptionEqualToValue}
      renderOption={renderOption}
      renderTags={multiple ? renderTags : undefined}
      getOptionDisabled={(option) => option.disabled || false}
      filterOptions={(options, state) => {
        // If async search is active, don't filter
        if (onSearch && searchResults.length > 0) {
          return options;
        }

        // Default filtering by input value
        const inputValue = state.inputValue.toLowerCase();
        return options.filter(
          (option) =>
            option.code.toLowerCase().includes(inputValue) ||
            option.name.toLowerCase().includes(inputValue) ||
            (option.specification &&
              option.specification.toLowerCase().includes(inputValue))
        );
      }}
      noOptionsText={
        inputValue.length < 2 && onSearch
          ? 'Type at least 2 characters to search'
          : 'No items found'
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          helperText={helperText}
          error={error}
          required={required}
          slotProps={{
            input: {
              ...params.InputProps,
              startAdornment: (
                <>
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                  {params.InputProps.startAdornment}
                </>
              ),
              endAdornment: (
                <>
                  {isLoading ? (
                    <CircularProgress color="inherit" size={20} />
                  ) : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
      sx={{
        '& .MuiAutocomplete-listbox': {
          maxHeight: 400,
        },
      }}
    />
  );
}
