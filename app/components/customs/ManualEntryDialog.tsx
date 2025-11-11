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

interface FormData {
  date: Dayjs | null;
  itemId: string;
  itemCode: string;
  itemName: string;
  uomId: string;
  uom: string;
  incoming: number;
  remarks: string;
}

interface ManualEntryDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: FormData) => Promise<void>;
}

interface Item {
  id: string;
  code: string;
  name: string;
  uomId: string;
  uom: {
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

export function ManualEntryDialog({ open, onClose, onSubmit }: ManualEntryDialogProps) {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [uoms, setUoms] = useState<UOM[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    date: dayjs(),
    itemId: '',
    itemCode: '',
    itemName: '',
    uomId: '',
    uom: '',
    incoming: 0,
    remarks: '',
  });

  // Fetch items and UOMs when dialog opens
  useEffect(() => {
    if (open) {
      fetchItems();
      fetchUOMs();
    }
  }, [open]);

  const fetchItems = async () => {
    setLoadingItems(true);
    try {
      const response = await fetch('/api/master/item?type=SCRAP');
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
        uomId: item.uom.id,
        uom: item.uom.code,
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

  const handleNumberChange = (field: keyof FormData, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    if (!isNaN(numValue)) {
      setFormData((prev) => ({
        ...prev,
        [field]: numValue,
      }));
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit(formData);
      // Reset form after successful submission
      setFormData({
        date: dayjs(),
        itemId: '',
        itemCode: '',
        itemName: '',
        uomId: '',
        uom: '',
        incoming: 0,
        remarks: '',
      });
      onClose();
    } catch (error) {
      console.error('Error submitting form:', error);
    } finally {
      setLoading(false);
    }
  };

  const isFormValid =
    formData.date !== null &&
    formData.itemId !== '' &&
    formData.uomId !== '' &&
    formData.incoming > 0;

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
            Add Incoming Scrap
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Record incoming scrap quantity
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ mt: 3 }}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Stack spacing={3}>
            {/* Date Picker */}
            <DatePicker
              label="Date"
              value={formData.date}
              onChange={(newValue) => setFormData((prev) => ({ ...prev, date: newValue }))}
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                },
              }}
            />

            {/* Item Autocomplete */}
            <Autocomplete
              options={items}
              loading={loadingItems}
              getOptionLabel={(option) => `${option.code} - ${option.name}`}
              onChange={(event, newValue) => handleItemSelect(newValue)}
              value={items.find((item) => item.id === formData.itemId) || null}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Item"
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
                />
              )}
            />

            {/* UOM Autocomplete - Auto-filled from selected item */}
            <Autocomplete
              options={uoms}
              value={uoms.find((u) => u.id === formData.uomId) || null}
              onChange={(event, newValue) =>
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

            {/* Incoming Quantity */}
            <TextField
              fullWidth
              label="Incoming Quantity"
              type="number"
              value={formData.incoming}
              onChange={(e) => handleNumberChange('incoming', e.target.value)}
              inputProps={{ min: 0.01, step: 0.01 }}
              required
              helperText="Enter the quantity of incoming scrap (must be greater than 0)"
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
                The system will automatically calculate the Beginning balance from the previous day's Ending balance, and compute the new Ending balance as: Beginning + Incoming.
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
          {loading ? 'Saving...' : 'Save Entry'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
