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
  MenuItem,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { Save, Close } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface FormData {
  date: Dayjs | null;
  recipientName: string;
  documentNumber: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qty: number;
  currency: string;
  valueAmount: number;
  remarks: string;
}

interface CapitalGoodsManualEntryDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface CapitalGoodsItem {
  id: string;
  code: string;
  name: string;
  description?: string;
}

const CURRENCIES = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'];

export function CapitalGoodsManualEntryDialog({
  open,
  onClose,
  onSuccess,
}: CapitalGoodsManualEntryDialogProps) {
  const theme = useTheme();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CapitalGoodsItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    date: dayjs(),
    recipientName: '',
    documentNumber: '',
    itemId: '',
    itemCode: '',
    itemName: '',
    qty: 0,
    currency: 'USD',
    valueAmount: 0,
    remarks: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  useEffect(() => {
    if (open) {
      fetchItems();
    }
  }, [open]);

  const fetchItems = async () => {
    setLoadingItems(true);
    try {
      const response = await fetch('/api/master/capital-goods');
      if (response.ok) {
        const data = await response.json();
        setItems(data);
      } else {
        toast.error('Failed to load capital goods items');
      }
    } catch (error) {
      console.error('Error fetching capital goods items:', error);
      toast.error('Failed to load capital goods items');
    } finally {
      setLoadingItems(false);
    }
  };

  const handleItemSelect = (item: CapitalGoodsItem | null) => {
    if (item) {
      setFormData((prev) => ({
        ...prev,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
      }));
      setErrors((prev) => ({ ...prev, itemId: undefined }));
    } else {
      setFormData((prev) => ({
        ...prev,
        itemId: '',
        itemCode: '',
        itemName: '',
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
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!formData.date) {
      newErrors.date = 'Date is required';
    } else if (formData.date.isAfter(dayjs())) {
      newErrors.date = 'Date cannot be in the future';
    }

    if (!formData.recipientName.trim()) {
      newErrors.recipientName = 'Recipient name is required';
    }

    if (!formData.itemId) {
      newErrors.itemId = 'Item is required';
    }

    if (formData.qty <= 0) {
      newErrors.qty = 'Quantity must be greater than 0';
    }

    if (!formData.currency) {
      newErrors.currency = 'Currency is required';
    }

    if (formData.valueAmount <= 0) {
      newErrors.valueAmount = 'Value amount must be greater than 0';
    }

    if (formData.remarks.length > 1000) {
      newErrors.remarks = 'Remarks cannot exceed 1000 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      toast.error('Please fix validation errors');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/customs/capital-goods/outgoing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: formData.date?.format('YYYY-MM-DD'),
          recipientName: formData.recipientName,
          documentNumber: formData.documentNumber || undefined,
          items: [
            {
              itemCode: formData.itemCode,
              qty: formData.qty,
              currency: formData.currency,
              valueAmount: formData.valueAmount,
              remarks: formData.remarks || undefined,
            },
          ],
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to submit entry');
      }

      toast.success('Capital goods outgoing entry added successfully');
      resetForm();
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error submitting form:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to submit entry');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      date: dayjs(),
      recipientName: '',
      documentNumber: '',
      itemId: '',
      itemCode: '',
      itemName: '',
      qty: 0,
      currency: 'USD',
      valueAmount: 0,
      remarks: '',
    });
    setErrors({});
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const isFormValid =
    formData.date !== null &&
    !formData.date.isAfter(dayjs()) &&
    formData.recipientName.trim() !== '' &&
    formData.itemId !== '' &&
    formData.qty > 0 &&
    formData.currency !== '' &&
    formData.valueAmount > 0 &&
    formData.remarks.length <= 1000;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
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
          bgcolor: alpha(theme.palette.success.main, 0.08),
          borderBottom: `1px solid ${alpha(theme.palette.success.main, 0.1)}`,
        }}
      >
        <Box>
          <Typography component="div" fontWeight="bold" color="success.main" sx={{ fontSize: '1.25rem' }}>
            Add Outgoing Capital Goods
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Record outgoing capital goods transaction
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ mt: 3 }}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Stack spacing={3}>
            <DatePicker
              label="Date"
              value={formData.date}
              onChange={(newValue) => {
                setFormData((prev) => ({ ...prev, date: newValue }));
                setErrors((prev) => ({ ...prev, date: undefined }));
              }}
              maxDate={dayjs()}
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                  error: !!errors.date,
                  helperText: errors.date || 'Date cannot be in the future',
                },
              }}
            />

            <TextField
              fullWidth
              label="Recipient Name"
              value={formData.recipientName}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, recipientName: e.target.value }));
                setErrors((prev) => ({ ...prev, recipientName: undefined }));
              }}
              required
              error={!!errors.recipientName}
              helperText={errors.recipientName}
            />

            <TextField
              fullWidth
              label="Document Number"
              value={formData.documentNumber}
              onChange={(e) => setFormData((prev) => ({ ...prev, documentNumber: e.target.value }))}
              helperText="Optional"
            />

            <Autocomplete
              options={items}
              loading={loadingItems}
              getOptionLabel={(option) => `${option.code} - ${option.name}`}
              onChange={(_event, newValue) => handleItemSelect(newValue)}
              value={items.find((item) => item.id === formData.itemId) || null}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Item"
                  placeholder="Search capital goods item..."
                  required
                  error={!!errors.itemId}
                  helperText={errors.itemId}
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

            <TextField
              fullWidth
              label="Quantity"
              type="number"
              value={formData.qty || ''}
              onChange={(e) => handleNumberChange('qty', e.target.value)}
              inputProps={{ min: 0.01, step: 0.01 }}
              required
              error={!!errors.qty}
              helperText={errors.qty || 'Must be greater than 0'}
            />

            <TextField
              fullWidth
              select
              label="Currency"
              value={formData.currency}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, currency: e.target.value }));
                setErrors((prev) => ({ ...prev, currency: undefined }));
              }}
              required
              error={!!errors.currency}
              helperText={errors.currency}
            >
              {CURRENCIES.map((currency) => (
                <MenuItem key={currency} value={currency}>
                  {currency}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              fullWidth
              label="Value Amount"
              type="number"
              value={formData.valueAmount || ''}
              onChange={(e) => handleNumberChange('valueAmount', e.target.value)}
              inputProps={{ min: 0.01, step: 0.01 }}
              required
              error={!!errors.valueAmount}
              helperText={errors.valueAmount || 'Must be greater than 0'}
            />

            <TextField
              fullWidth
              label="Remarks"
              multiline
              rows={3}
              value={formData.remarks}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, remarks: e.target.value }));
                setErrors((prev) => ({ ...prev, remarks: undefined }));
              }}
              placeholder="Enter any additional notes (optional)"
              error={!!errors.remarks}
              helperText={
                errors.remarks || `${formData.remarks.length}/1000 characters`
              }
            />

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
                This transaction will record the outgoing quantity of capital goods. The system will automatically update the stock balance.
              </Typography>
            </Box>
          </Stack>
        </LocalizationProvider>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          onClick={handleClose}
          startIcon={<Close />}
          disabled={loading}
          sx={{ textTransform: 'none' }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          color="success"
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
