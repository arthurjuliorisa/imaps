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

interface FormData {
  date: Dayjs | null;
  scrapItemId: string;
  scrapCode: string;
  scrapName: string;
  qty: number;
  currency: string;
  amount: number;
  remarks: string;
}

interface ScrapIncomingDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: FormData) => Promise<void>;
}

interface ScrapItem {
  id: string;
  scrapCode: string;
  scrapName: string;
  uom: string;
}

const CURRENCIES = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'];

export function ScrapIncomingDialog({ open, onClose, onSubmit }: ScrapIncomingDialogProps) {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [scrapItems, setScrapItems] = useState<ScrapItem[]>([]);
  const [loadingScrapItems, setLoadingScrapItems] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    date: dayjs(),
    scrapItemId: '',
    scrapCode: '',
    scrapName: '',
    qty: 0,
    currency: 'USD',
    amount: 0,
    remarks: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      fetchScrapItems();
      setErrors({});
    }
  }, [open]);

  const fetchScrapItems = async () => {
    setLoadingScrapItems(true);
    try {
      const response = await fetch('/api/master/scrap-items');
      if (response.ok) {
        const data = await response.json();
        setScrapItems(data);
      }
    } catch (error) {
      console.error('Error fetching scrap items:', error);
    } finally {
      setLoadingScrapItems(false);
    }
  };

  const handleScrapItemSelect = (scrapItem: ScrapItem | null) => {
    if (scrapItem) {
      setFormData((prev) => ({
        ...prev,
        scrapItemId: scrapItem.id,
        scrapCode: scrapItem.scrapCode,
        scrapName: scrapItem.scrapName,
      }));
      setErrors((prev) => ({ ...prev, scrapItemId: '' }));
    } else {
      setFormData((prev) => ({
        ...prev,
        scrapItemId: '',
        scrapCode: '',
        scrapName: '',
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
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.date) {
      newErrors.date = 'Date is required';
    } else if (formData.date.isAfter(dayjs(), 'day')) {
      newErrors.date = 'Date cannot be in the future';
    }

    if (!formData.scrapItemId) {
      newErrors.scrapItemId = 'Scrap item is required';
    }

    if (!formData.qty || formData.qty <= 0) {
      newErrors.qty = 'Quantity must be greater than 0';
    }

    if (!formData.currency) {
      newErrors.currency = 'Currency is required';
    }

    if (formData.amount < 0) {
      newErrors.amount = 'Amount must be non-negative';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      await onSubmit(formData);
      setFormData({
        date: dayjs(),
        scrapItemId: '',
        scrapCode: '',
        scrapName: '',
        qty: 0,
        currency: 'USD',
        amount: 0,
        remarks: '',
      });
      setErrors({});
      onClose();
    } catch (error) {
      console.error('Error submitting form:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      date: dayjs(),
      scrapItemId: '',
      scrapCode: '',
      scrapName: '',
      qty: 0,
      currency: 'USD',
      amount: 0,
      remarks: '',
    });
    setErrors({});
    onClose();
  };

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
            Add Incoming Scrap
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Record incoming scrap transaction
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
                setErrors((prev) => ({ ...prev, date: '' }));
              }}
              maxDate={dayjs()}
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                  error: !!errors.date,
                  helperText: errors.date,
                },
              }}
            />

            <Autocomplete
              options={scrapItems}
              loading={loadingScrapItems}
              getOptionLabel={(option) => `${option.scrapCode} - ${option.scrapName}`}
              onChange={(_event, newValue) => handleScrapItemSelect(newValue)}
              value={scrapItems.find((item) => item.id === formData.scrapItemId) || null}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Scrap Item"
                  placeholder="Search scrap item..."
                  required
                  error={!!errors.scrapItemId}
                  helperText={errors.scrapItemId}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loadingScrapItems ? <CircularProgress color="inherit" size={20} /> : null}
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
              helperText={errors.qty || 'Enter quantity (must be greater than 0)'}
            />

            <TextField
              fullWidth
              select
              label="Currency"
              value={formData.currency}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, currency: e.target.value }));
                setErrors((prev) => ({ ...prev, currency: '' }));
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
              label="Amount"
              type="number"
              value={formData.amount || ''}
              onChange={(e) => handleNumberChange('amount', e.target.value)}
              inputProps={{ min: 0, step: 0.01 }}
              required
              error={!!errors.amount}
              helperText={errors.amount || 'Enter transaction amount'}
            />

            <TextField
              fullWidth
              label="Remarks"
              multiline
              rows={3}
              value={formData.remarks}
              onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
              placeholder="Enter any additional notes (optional)"
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
                This transaction will be recorded as incoming scrap and will affect the stock balance calculations.
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
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <Save />}
          disabled={loading}
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
