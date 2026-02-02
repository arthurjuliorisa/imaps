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
  CircularProgress,
  alpha,
  useTheme,
  Stack,
  Autocomplete,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { Save, Close } from '@mui/icons-material';
import { ChipInput } from './ChipInput';

export interface BeginningStockFormData {
  itemId?: string;
  item_code: string;
  item_name: string;
  item_type: string;
  uomId?: string;
  uom: string;
  beginningBalance: number;
  qty: number;
  beginningDate: Dayjs | null;
  balance_date: Dayjs | null;
  remarks?: string;
  ppkek_numbers?: string[];
}

interface ItemType {
  code: string;
  name: string;
}

interface BeginningStockFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: BeginningStockFormData) => Promise<void>;
  itemType: string;
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
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [itemTypesLoading, setItemTypesLoading] = useState(true);

  const [formData, setFormData] = useState<BeginningStockFormData>({
    itemId: undefined,
    item_code: '',
    item_name: '',
    item_type: '',
    uomId: undefined,
    uom: '',
    beginningBalance: 0,
    qty: 0,
    beginningDate: dayjs(),
    balance_date: dayjs(),
    remarks: '',
    ppkek_numbers: [],
  });

  // Load item types on mount
  useEffect(() => {
    const fetchItemTypes = async () => {
      setItemTypesLoading(true);
      try {
        const response = await fetch('/api/master/item-types');
        if (!response.ok) {
          throw new Error('Failed to fetch item types');
        }
        const result = await response.json();
        const itemTypesData = result.data || result;
        const types = itemTypesData.map((it: any) => ({
          code: it.item_type_code,
          name: it.name_id || it.name_en,
        }));
        setItemTypes(types);
      } catch (error) {
        console.error('Error fetching item types:', error);
        setItemTypes([]);
      } finally {
        setItemTypesLoading(false);
      }
    };

    if (open) {
      fetchItemTypes();
    }
  }, [open]);

  // Reset form when dialog opens or initialData changes
  useEffect(() => {
    if (open) {
      if (initialData && mode === 'edit') {
        setFormData(initialData);
      } else {
        setFormData({
          itemId: undefined,
          item_code: '',
          item_name: '',
          item_type: itemType || '',
          uomId: undefined,
          uom: '',
          beginningBalance: 0,
          qty: 0,
          beginningDate: dayjs(),
          balance_date: dayjs(),
          remarks: '',
          ppkek_numbers: [],
        });
      }
    }
  }, [open, initialData, mode, itemType]);

  const handleNumberChange = (value: string) => {
    if (value === '') {
      setFormData((prev) => ({
        ...prev,
        qty: 0,
      }));
      return;
    }

    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      setFormData((prev) => ({
        ...prev,
        qty: numValue,
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
    formData.balance_date !== null &&
    formData.item_type.trim() !== '' &&
    formData.item_code.trim() !== '' &&
    formData.item_name.trim() !== '' &&
    formData.uom.trim() !== '' &&
    formData.qty > 0 &&
    (formData.balance_date.isBefore(dayjs()) || formData.balance_date.isSame(dayjs(), 'day'));

  const getItemTypeLabel = () => {
    if (!formData.item_type) return 'Item Type';
    const selectedType = itemTypes.find((it) => it.code === formData.item_type);
    return selectedType ? selectedType.name : formData.item_type;
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
            {/* Item Type - Dropdown Selection */}
            <Autocomplete
              value={itemTypes.find((it) => it.code === formData.item_type) || null}
              onChange={(_, newValue) => {
                if (newValue) {
                  setFormData((prev) => ({ ...prev, item_type: newValue.code }));
                }
              }}
              options={itemTypes}
              getOptionLabel={(option) => `${option.code} - ${option.name}`}
              loading={itemTypesLoading}
              disabled={mode === 'edit' || itemTypesLoading}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Item Type"
                  required
                  placeholder="Select item type..."
                  helperText={mode === 'edit' ? 'Item type cannot be changed in edit mode' : 'Select the item type'}
                />
              )}
            />

            {/* Item Code - Manual Input */}
            <TextField
              fullWidth
              label="Item Code"
              value={formData.item_code}
              onChange={(e) => setFormData((prev) => ({ ...prev, item_code: e.target.value }))}
              disabled={mode === 'edit'}
              required
              placeholder="Enter item code..."
              helperText={mode === 'edit' ? 'Item cannot be changed in edit mode' : 'Enter the item code'}
            />

            {/* Item Name - Manual Input */}
            <TextField
              fullWidth
              label="Item Name"
              value={formData.item_name}
              onChange={(e) => setFormData((prev) => ({ ...prev, item_name: e.target.value }))}
              disabled={mode === 'edit'}
              required
              placeholder="Enter item name..."
              helperText={mode === 'edit' ? 'Item cannot be changed in edit mode' : 'Enter the item name'}
            />

            {/* UOM - Manual Input */}
            <TextField
              fullWidth
              label="Unit of Measure (UOM)"
              value={formData.uom}
              onChange={(e) => setFormData((prev) => ({ ...prev, uom: e.target.value }))}
              required
              placeholder="Enter UOM (e.g., PCS, KG, SET)..."
              helperText="Enter the unit of measure"
            />

            {/* Beginning Balance */}
            <TextField
              fullWidth
              label="Beginning Balance"
              type="number"
              value={formData.qty}
              onChange={(e) => handleNumberChange(e.target.value)}
              inputProps={{ min: 0.01, step: 0.01 }}
              required
              helperText="Enter the beginning balance quantity (must be greater than 0)"
            />

            {/* Balance Date */}
            <DatePicker
              label="Balance Date"
              value={formData.balance_date}
              onChange={(newValue) => setFormData((prev) => ({ ...prev, balance_date: newValue, beginningDate: newValue }))}
              maxDate={dayjs()}
              format="MM/DD/YYYY"
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                  helperText: 'Balance date cannot be in the future',
                },
              }}
            />

            {/* PPKEK Numbers - Tag/Chip Input */}
            <ChipInput
              label="PPKEK Numbers"
              value={formData.ppkek_numbers || []}
              onChange={(newValue) => setFormData((prev) => ({ ...prev, ppkek_numbers: newValue }))}
              placeholder="Type PPKEK number and press Enter or comma to add"
              helperText="Enter one or more PPKEK numbers (optional). Press Enter or comma to add."
            />

            {/* Remarks */}
            <TextField
              fullWidth
              label="Remarks"
              value={formData.remarks || ''}
              onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
              multiline
              rows={3}
              placeholder="Enter additional notes or remarks (optional)..."
              helperText="Optional notes about this beginning balance entry (max 1000 characters)"
              inputProps={{ maxLength: 1000 }}
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
