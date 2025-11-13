'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Autocomplete,
  CircularProgress,
  alpha,
  useTheme,
  Stack,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { Save, Close } from '@mui/icons-material';

export interface BeginningStockFormData {
  itemId: string;
  itemCode: string;
  itemName: string;
  uomId: string;
  uom: string;
  beginningBalance: number;
  beginningDate: Dayjs | null;
  remarks: string;
}

interface Item {
  id: string;
  code: string;
  name: string;
  type: string;
  uom?: {
    id: string;
    code: string;
    name: string;
  };
}

interface UOM {
  id: string;
  code: string;
  name: string;
}

interface BeginningStockFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: BeginningStockFormData) => Promise<void>;
  itemType: 'RAW_MATERIAL' | 'FINISH_GOOD' | 'CAPITAL_GOODS';
  initialData?: BeginningStockFormData | null;
  mode: 'add' | 'edit';
}

export function BeginningStockForm({
  open,
  onClose,
  onSubmit,
  itemType,
  initialData = null,
  mode = 'add',
}: BeginningStockFormProps) {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [uoms, setUoms] = useState<UOM[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [formData, setFormData] = useState<BeginningStockFormData>({
    itemId: '',
    itemCode: '',
    itemName: '',
    uomId: '',
    uom: '',
    beginningBalance: 0,
    beginningDate: dayjs(),
    remarks: '',
  });

  // Reset form when dialog opens or initialData changes
  useEffect(() => {
    if (open) {
      // Fix Bug #1: Load data first, then set form values to avoid race condition
      const loadData = async () => {
        await Promise.all([fetchItems(), fetchUOMs()]);

        if (initialData && mode === 'edit') {
          setFormData(initialData);
        } else {
          setFormData({
            itemId: '',
            itemCode: '',
            itemName: '',
            uomId: '',
            uom: '',
            beginningBalance: 0,
            beginningDate: dayjs(),
            remarks: '',
          });
        }
      };
      loadData();
    }
  }, [open, initialData, mode]);

  const fetchItems = async () => {
    setLoadingItems(true);
    try {
      const response = await fetch(`/api/master/item?type=${itemType}`);
      if (response.ok) {
        const data = await response.json();
        setItems(data);
      }
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoadingItems(false);
    }
  };

  const fetchUOMs = async () => {
    try {
      const response = await fetch('/api/master/uom');
      if (response.ok) {
        const data = await response.json();
        setUoms(data);
      }
    } catch (error) {
      console.error('Error fetching UOMs:', error);
    }
  };

  const handleItemSelect = (item: Item | null) => {
    if (item) {
      setFormData((prev) => ({
        ...prev,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        uomId: item.uom?.id || '',
        uom: item.uom?.code || '',
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        itemId: '',
        itemCode: '',
        itemName: '',
        uomId: '',
        uom: '',
      }));
    }
  };

  const handleNumberChange = (value: string) => {
    // Fix Bug #8: Don't convert empty to 0, keep it as is for proper validation feedback
    if (value === '') {
      setFormData((prev) => ({
        ...prev,
        beginningBalance: 0,
      }));
      return;
    }

    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      setFormData((prev) => ({
        ...prev,
        beginningBalance: numValue,
      }));
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit(formData);
      // Fix Bug #7: Don't close here, let parent handle success
      // onClose will be called by parent after successful submission
    } catch (error) {
      console.error('Error submitting form:', error);
      // Error is already shown by parent via toast
    } finally {
      setLoading(false);
    }
  };

  const isFormValid =
    formData.beginningDate !== null &&
    formData.itemId !== '' &&
    formData.uomId !== '' &&
    formData.beginningBalance > 0 &&
    (formData.beginningDate.isBefore(dayjs()) || formData.beginningDate.isSame(dayjs(), 'day'));

  const getItemTypeLabel = () => {
    switch (itemType) {
      case 'RAW_MATERIAL':
        return 'Raw Material';
      case 'FINISH_GOOD':
        return 'Finish Good';
      case 'CAPITAL_GOODS':
        return 'Capital Goods';
      default:
        return 'Item';
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
        },
      }}
    >
      <DialogTitle
        sx={{
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Box>
          <Typography component="div" fontWeight="bold" color="primary" sx={{ fontSize: '1.25rem' }}>
            {mode === 'add' ? 'Add' : 'Edit'} Beginning Stock - {getItemTypeLabel()}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {mode === 'add' ? 'Record' : 'Update'} beginning balance data for {getItemTypeLabel().toLowerCase()}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ mt: 3 }}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Stack spacing={3}>
            {/* Item Selection - Disabled in edit mode */}
            <Autocomplete
              options={items}
              loading={loadingItems}
              getOptionLabel={(option) => `${option.code} - ${option.name}`}
              onChange={(_event, newValue) => handleItemSelect(newValue)}
              value={items.find((item) => item.id === formData.itemId) || null}
              disabled={mode === 'edit'}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={`${getItemTypeLabel()} Item`}
                  placeholder="Search item..."
                  required
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loadingItems ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                  helperText={mode === 'edit' ? 'Item cannot be changed in edit mode' : ''}
                />
              )}
            />

            {/* UOM - Auto-filled from selected item */}
            <Autocomplete
              options={uoms}
              value={uoms.find((u) => u.id === formData.uomId) || null}
              onChange={(_event, newValue) =>
                setFormData((prev) => ({
                  ...prev,
                  uomId: newValue?.id || '',
                  uom: newValue?.code || '',
                }))
              }
              getOptionLabel={(option) => `${option.code} - ${option.name}`}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Unit of Measure (UOM)"
                  required
                  helperText="Auto-filled from selected item"
                />
              )}
              disabled={true}
            />

            {/* Beginning Balance */}
            <TextField
              fullWidth
              label="Beginning Balance"
              type="number"
              value={formData.beginningBalance}
              onChange={(e) => handleNumberChange(e.target.value)}
              inputProps={{ min: 0.01, step: 0.01 }}
              required
              helperText="Enter the beginning balance quantity (must be greater than 0)"
            />

            {/* Beginning Date */}
            <DatePicker
              label="Beginning Date"
              value={formData.beginningDate}
              onChange={(newValue) => setFormData((prev) => ({ ...prev, beginningDate: newValue }))}
              maxDate={dayjs()}
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                  helperText: 'Beginning date cannot be in the future',
                },
              }}
            />

            {/* Remarks */}
            <TextField
              fullWidth
              label="Remarks"
              multiline
              rows={3}
              value={formData.remarks}
              onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
              placeholder="Enter any additional notes (optional)"
              inputProps={{ maxLength: 1000 }}
              helperText={`${formData.remarks.length}/1000 characters`}
            />

            {/* Info Box */}
            <Box
              sx={{
                p: 2,
                bgcolor: alpha(theme.palette.info.main, 0.08),
                borderRadius: 1,
                border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
              }}
            >
              <Typography variant="subtitle2" fontWeight="bold" color="info.main" gutterBottom>
                Note
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This beginning balance will be used as the starting point for mutation calculations. Ensure the data is accurate.
              </Typography>
            </Box>
          </Stack>
        </LocalizationProvider>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          onClick={onClose}
          startIcon={<Close />}
          disabled={loading}
          sx={{ textTransform: 'none' }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          startIcon={loading ? <CircularProgress size={20} /> : <Save />}
          disabled={!isFormValid || loading}
          sx={{
            textTransform: 'none',
            borderRadius: 2,
            px: 3,
          }}
        >
          {loading ? 'Saving...' : mode === 'add' ? 'Save Entry' : 'Update Entry'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
