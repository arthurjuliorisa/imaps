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
  Autocomplete,
  Alert,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { Save, Close } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface ScrapItem {
  id: number;
  scrapCode: string;
  scrapName: string;
  scrapDescription?: string;
  uom: string;
  isActive: boolean;
}

interface FormData {
  date: Dayjs | null;
  scrapItem: ScrapItem | null;
  scrapCode: string;
  scrapName: string;
  uom: string;
  qty: number;
  currency: string;
  amount: number;
  recipientName: string;
  remarks: string;
  ppkekNumber: string;
  registrationDate: Dayjs | null;
  documentType: string;
}

interface AddOutScrapDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CURRENCIES = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'];
const DOCUMENT_TYPES = ['BC25', 'BC27', 'BC41'];

export function AddOutScrapDialog({
  open,
  onClose,
  onSuccess,
}: AddOutScrapDialogProps) {
  const theme = useTheme();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [scrapItems, setScrapItems] = useState<ScrapItem[]>([]);
  const [loadingScrapItems, setLoadingScrapItems] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    date: dayjs(),
    scrapItem: null,
    scrapCode: '',
    scrapName: '',
    uom: '',
    qty: 0,
    currency: 'USD',
    amount: 0,
    recipientName: '',
    remarks: '',
    ppkekNumber: '',
    registrationDate: null,
    documentType: 'BC27',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [stockCheckResult, setStockCheckResult] = useState<{
    currentStock: number;
    available: boolean;
    shortfall?: number;
  } | null>(null);
  const [checkingStock, setCheckingStock] = useState(false);

  // Fetch scrap items from master
  useEffect(() => {
    if (open) {
      fetchScrapItems();
    }
  }, [open]);

  const fetchScrapItems = async () => {
    setLoadingScrapItems(true);
    try {
      const response = await fetch('/api/master/scrap-items');
      if (!response.ok) {
        throw new Error('Failed to fetch scrap items');
      }
      const data = await response.json();
      setScrapItems(data);
    } catch (error) {
      console.error('Error fetching scrap items:', error);
      toast.error('Failed to load scrap items');
    } finally {
      setLoadingScrapItems(false);
    }
  };

  const checkStockAvailability = async (itemCode: string, qty: number) => {
    if (!itemCode || qty <= 0) {
      setStockCheckResult(null);
      return;
    }

    // Need transaction date for stock validation
    if (!formData.date) {
      setStockCheckResult(null);
      return;
    }

    setCheckingStock(true);
    try {
      // Format date correctly to avoid timezone issues
      const dateObj = formData.date.toDate();
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      console.log('[Stock Check] Checking stock:', {
        itemCode,
        qty,
        dateStr,
        formDateFormatted: formData.date.format('YYYY-MM-DD'),
      });

      const response = await fetch('/api/customs/stock/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            {
              itemCode,
              itemType: 'SCRAP',
              qtyRequested: qty,
            },
          ],
          date: dateStr,
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

  // Check stock when scrap item, quantity, or date changes
  useEffect(() => {
    if (formData.scrapCode && formData.qty > 0 && formData.date) {
      checkStockAvailability(formData.scrapCode, formData.qty);
    } else {
      setStockCheckResult(null);
    }
  }, [formData.scrapCode, formData.qty, formData.date?.format('YYYY-MM-DD')]);

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!formData.date) {
      newErrors.date = 'Date is required';
    } else if (formData.date.startOf('day').isAfter(dayjs().startOf('day'))) {
      newErrors.date = 'Date cannot be in the future';
    }

    if (!formData.scrapCode.trim()) {
      newErrors.scrapCode = 'Scrap code is required';
    }

    if (!formData.scrapName.trim()) {
      newErrors.scrapName = 'Scrap name is required';
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
      const response = await fetch('/api/customs/scrap-transactions/out', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: formData.date?.format('YYYY-MM-DD'),
          scrapCode: formData.scrapCode,
          scrapName: formData.scrapName,
          uom: formData.uom,
          qty: formData.qty,
          currency: formData.currency,
          amount: formData.amount,
          recipientName: formData.recipientName,
          remarks: formData.remarks || undefined,
          ppkekNumber: formData.ppkekNumber || undefined,
          registrationDate: formData.registrationDate?.format('YYYY-MM-DD') || undefined,
          documentType: formData.documentType || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to submit entry');
      }

      toast.success('Outgoing scrap transaction added successfully');
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
      scrapItem: null,
      scrapCode: '',
      scrapName: '',
      uom: '',
      qty: 0,
      currency: 'USD',
      amount: 0,
      recipientName: '',
      remarks: '',
      ppkekNumber: '',
      registrationDate: null,
      documentType: 'BC27',
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
    formData.scrapCode.trim() !== '' &&
    formData.scrapName.trim() !== '' &&
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
          bgcolor: alpha(theme.palette.error.main, 0.08),
          borderBottom: `1px solid ${alpha(theme.palette.error.main, 0.1)}`,
        }}
      >
        <Box>
          <Typography component="div" fontWeight="bold" color="error.main" sx={{ fontSize: '1.25rem' }}>
            Add Outgoing Scrap
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Record outgoing scrap transaction
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

            {/* Customs Information Section */}
            <Box
              sx={{
                p: 2,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: alpha(theme.palette.primary.main, 0.02),
              }}
            >
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                Customs Information (Optional)
              </Typography>
              <Stack spacing={2} sx={{ mt: 2 }}>
                <TextField
                  fullWidth
                  label="PPKEK Number"
                  value={formData.ppkekNumber}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, ppkekNumber: e.target.value }));
                  }}
                  placeholder="e.g., PPKEK-123456"
                  helperText="Nomor pendaftaran PPKEK (customs registration number)"
                />

                <DatePicker
                  label="Registration Date"
                  value={formData.registrationDate}
                  onChange={(newValue) => {
                    setFormData((prev) => ({ ...prev, registrationDate: newValue }));
                  }}
                  maxDate={dayjs()}
                  slotProps={{
                    textField: {
                      fullWidth: true,
                      helperText: 'Customs registration date',
                    },
                  }}
                />

                <TextField
                  fullWidth
                  select
                  label="Document Type"
                  value={formData.documentType}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, documentType: e.target.value }));
                  }}
                  helperText="Customs document type"
                >
                  {DOCUMENT_TYPES.map((docType) => (
                    <MenuItem key={docType} value={docType}>
                      {docType}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Box>

            <Autocomplete
              options={scrapItems}
              getOptionLabel={(option) => `${option.scrapCode} - ${option.scrapName}`}
              value={formData.scrapItem}
              onChange={(event, newValue) => {
                setFormData((prev) => ({
                  ...prev,
                  scrapItem: newValue,
                  scrapCode: newValue?.scrapCode || '',
                  scrapName: newValue?.scrapName || '',
                  uom: newValue?.uom || '',
                }));
                setErrors((prev) => ({
                  ...prev,
                  scrapCode: undefined,
                  scrapName: undefined,
                  uom: undefined,
                }));
              }}
              loading={loadingScrapItems}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Scrap Code"
                  required
                  error={!!errors.scrapCode}
                  helperText={errors.scrapCode || 'Select scrap item from master'}
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
              label="Scrap Name"
              value={formData.scrapName}
              disabled
              required
              helperText="Auto-filled from selected scrap item"
            />

            <TextField
              fullWidth
              label="UOM"
              value={formData.uom}
              disabled
              required
              helperText="Auto-filled from selected scrap item"
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
                    Stock tidak mencukupi. Item {formData.scrapCode} memiliki stock{' '}
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
                bgcolor: alpha(theme.palette.warning.main, 0.08),
                borderRadius: 1,
                border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
              }}
            >
              <Typography variant="subtitle2" fontWeight="bold" color="warning.main" gutterBottom>
                Note
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This transaction will record the outgoing quantity of scrap. The system will automatically update the stock balance.
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
          color="error"
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
