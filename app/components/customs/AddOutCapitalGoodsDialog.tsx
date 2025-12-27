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
  MenuItem,
  Alert,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { Save, Close } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface FormData {
  date: Dayjs | null;
  itemCode: string;
  itemName: string;
  itemType: string;
  uom: string;
  qty: number;
  currency: string;
  amount: number;
  recipientName: string;
  remarks: string;
}

interface AddOutCapitalGoodsDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CURRENCIES = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'];
const ITEM_TYPES = ['HIBE_M', 'HIBE_E', 'HIBE_T'];

export function AddOutCapitalGoodsDialog({
  open,
  onClose,
  onSuccess,
}: AddOutCapitalGoodsDialogProps) {
  const theme = useTheme();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    date: dayjs(),
    itemCode: '',
    itemName: '',
    itemType: '',
    uom: '',
    qty: 0,
    currency: 'USD',
    amount: 0,
    recipientName: '',
    remarks: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [stockCheckResult, setStockCheckResult] = useState<{
    currentStock: number;
    available: boolean;
    shortfall?: number;
  } | null>(null);
  const [checkingStock, setCheckingStock] = useState(false);

  const checkStockAvailability = async (itemCode: string, itemType: string, qty: number) => {
    if (!itemCode || !itemType || qty <= 0) {
      setStockCheckResult(null);
      return;
    }

    setCheckingStock(true);
    try {
      const response = await fetch('/api/customs/stock/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            {
              itemCode,
              itemType,
              qtyRequested: qty,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to check stock');
      }

      const result = await response.json();
      const itemResult = result.results[0];
      setStockCheckResult({
        currentStock: itemResult.currentStock,
        available: itemResult.available,
        shortfall: itemResult.shortfall,
      });
    } catch (error) {
      console.error('Error checking stock:', error);
      toast.error('Failed to check stock availability');
      setStockCheckResult(null);
    } finally {
      setCheckingStock(false);
    }
  };

  // Check stock when item code, item type, or quantity changes
  useEffect(() => {
    if (formData.itemCode && formData.itemType && formData.qty > 0) {
      checkStockAvailability(formData.itemCode, formData.itemType, formData.qty);
    } else {
      setStockCheckResult(null);
    }
  }, [formData.itemCode, formData.itemType, formData.qty]);

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!formData.date) {
      newErrors.date = 'Date is required';
    } else if (formData.date.startOf('day').isAfter(dayjs().startOf('day'))) {
      newErrors.date = 'Date cannot be in the future';
    }

    if (!formData.itemCode.trim()) {
      newErrors.itemCode = 'Item code is required';
    }

    if (!formData.itemName.trim()) {
      newErrors.itemName = 'Item name is required';
    }

    if (!formData.itemType) {
      newErrors.itemType = 'Item type is required';
    }

    if (!formData.uom.trim()) {
      newErrors.uom = 'UOM is required';
    }

    if (formData.qty <= 0) {
      newErrors.qty = 'Quantity must be greater than 0';
    }

    if (!formData.currency) {
      newErrors.currency = 'Currency is required';
    }

    if (formData.amount < 0) {
      newErrors.amount = 'Amount must be non-negative';
    }

    if (!formData.recipientName.trim()) {
      newErrors.recipientName = 'Recipient name is required';
    }

    if (formData.remarks.length > 1000) {
      newErrors.remarks = 'Remarks cannot exceed 1000 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
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

  const handleSubmit = async () => {
    if (!validateForm()) {
      toast.error('Please fix validation errors');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/customs/capital-goods-transactions/out', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: formData.date?.format('YYYY-MM-DD'),
          itemCode: formData.itemCode,
          itemName: formData.itemName,
          itemType: formData.itemType,
          uom: formData.uom,
          qty: formData.qty,
          currency: formData.currency,
          amount: formData.amount,
          recipientName: formData.recipientName,
          remarks: formData.remarks || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to submit entry');
      }

      toast.success('Outgoing capital goods transaction added successfully');
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
      itemCode: '',
      itemName: '',
      itemType: '',
      uom: '',
      qty: 0,
      currency: 'USD',
      amount: 0,
      recipientName: '',
      remarks: '',
    });
    setErrors({});
    setStockCheckResult(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const isFormValid =
    formData.date !== null &&
    !formData.date.isAfter(dayjs()) &&
    formData.itemCode.trim() !== '' &&
    formData.itemName.trim() !== '' &&
    formData.itemType !== '' &&
    formData.uom.trim() !== '' &&
    formData.qty > 0 &&
    formData.currency !== '' &&
    formData.amount >= 0 &&
    formData.recipientName.trim() !== '' &&
    formData.remarks.length <= 1000 &&
    stockCheckResult?.available === true;

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
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Box>
          <Typography component="div" fontWeight="bold" color="primary.main" sx={{ fontSize: '1.25rem' }}>
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
                  helperText: errors.date,
                },
              }}
            />

            <TextField
              fullWidth
              label="Item Code"
              value={formData.itemCode}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, itemCode: e.target.value }));
                setErrors((prev) => ({ ...prev, itemCode: undefined }));
              }}
              required
              error={!!errors.itemCode}
              helperText={errors.itemCode}
            />

            <TextField
              fullWidth
              label="Item Name"
              value={formData.itemName}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, itemName: e.target.value }));
                setErrors((prev) => ({ ...prev, itemName: undefined }));
              }}
              required
              error={!!errors.itemName}
              helperText={errors.itemName}
            />

            <TextField
              fullWidth
              select
              label="Item Type"
              value={formData.itemType}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, itemType: e.target.value }));
                setErrors((prev) => ({ ...prev, itemType: undefined }));
              }}
              required
              error={!!errors.itemType}
              helperText={errors.itemType}
            >
              {ITEM_TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              fullWidth
              label="UOM"
              value={formData.uom}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, uom: e.target.value }));
                setErrors((prev) => ({ ...prev, uom: undefined }));
              }}
              required
              error={!!errors.uom}
              helperText={errors.uom}
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

            {checkingStock && (
              <Alert severity="info" icon={<CircularProgress size={20} />}>
                Checking stock availability...
              </Alert>
            )}

            {!checkingStock && stockCheckResult && (
              <Alert
                severity={stockCheckResult.available ? 'success' : 'error'}
                sx={{ mt: 1 }}
              >
                {stockCheckResult.available ? (
                  <Typography variant="body2">
                    Stock tersedia: {stockCheckResult.currentStock.toLocaleString('id-ID', { minimumFractionDigits: 2 })} {formData.uom}
                  </Typography>
                ) : (
                  <Typography variant="body2">
                    Stock tidak mencukupi. Item {formData.itemCode} memiliki stock{' '}
                    {stockCheckResult.currentStock.toLocaleString('id-ID', { minimumFractionDigits: 2 })} {formData.uom}, tidak cukup untuk mengeluarkan{' '}
                    {formData.qty.toLocaleString('id-ID', { minimumFractionDigits: 2 })} {formData.uom}
                  </Typography>
                )}
              </Alert>
            )}

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
              label="Amount"
              type="number"
              value={formData.amount || ''}
              onChange={(e) => handleNumberChange('amount', e.target.value)}
              inputProps={{ min: 0, step: 0.01 }}
              required
              error={!!errors.amount}
              helperText={errors.amount || 'Must be non-negative'}
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
          color="primary"
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
