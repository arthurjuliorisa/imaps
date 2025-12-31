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
  Autocomplete,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { Save, Close } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface CapitalGoodsItem {
  id: number;
  itemCode: string;
  itemName: string;
  itemType: string;
  uom: string;
  isActive: boolean;
}

interface FormData {
  date: Dayjs | null;
  capitalGoodsItem: CapitalGoodsItem | null;
  itemCode: string;
  itemName: string;
  itemType: string;
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

interface AddOutCapitalGoodsDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CURRENCIES = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'];
const ITEM_TYPES = ['HIBE_M', 'HIBE_E', 'HIBE_T'];
const DOCUMENT_TYPES = ['BC25', 'BC27', 'BC41'];

export function AddOutCapitalGoodsDialog({
  open,
  onClose,
  onSuccess,
}: AddOutCapitalGoodsDialogProps) {
  const theme = useTheme();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [capitalGoodsItems, setCapitalGoodsItems] = useState<CapitalGoodsItem[]>([]);
  const [loadingCapitalGoodsItems, setLoadingCapitalGoodsItems] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    date: dayjs(),
    capitalGoodsItem: null,
    itemCode: '',
    itemName: '',
    itemType: '',
    uom: '',
    qty: 0,
    currency: 'USD',
    amount: 0,
    recipientName: '',
    remarks: '',
    ppkekNumber: '',
    registrationDate: null,
    documentType: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [stockCheckResult, setStockCheckResult] = useState<{
    currentStock: number;
    available: boolean;
    shortfall?: number;
  } | null>(null);
  const [checkingStock, setCheckingStock] = useState(false);

  // Fetch capital goods items from master
  useEffect(() => {
    if (open) {
      fetchCapitalGoodsItems();
    }
  }, [open]);

  const fetchCapitalGoodsItems = async () => {
    setLoadingCapitalGoodsItems(true);
    try {
      const response = await fetch('/api/master/capital-goods-items');
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Capital Goods] API Error ${response.status}:`, errorText);
        throw new Error(`Failed to fetch capital goods items (${response.status})`);
      }
      const data = await response.json();
      setCapitalGoodsItems(data);
      
      if (data.length === 0) {
        toast.warning('No capital goods items available in master');
      }
    } catch (error) {
      console.error('Error fetching capital goods items:', error);
      toast.error(`Failed to load capital goods items: ${error instanceof Error ? error.message : String(error)}`);
      setCapitalGoodsItems([]);
    } finally {
      setLoadingCapitalGoodsItems(false);
    }
  };

  /**
   * Pre-check stock availability when qty or date changes
   */
  const checkStockAvailability = async () => {
    // Only check if we have required data
    if (!formData.itemCode || !formData.itemType || !formData.qty || !formData.date) {
      setStockCheckResult(null);
      return;
    }

    setCheckingStock(true);
    try {
      // Format date correctly: use local date components to avoid timezone issues
      const dateObj = formData.date.toDate(); // Convert dayjs to JS Date
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      const response = await fetch('/api/customs/stock/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            {
              itemCode: formData.itemCode,
              itemType: formData.itemType,
              qtyRequested: formData.qty,
            },
          ],
          date: dateStr,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const itemResult = result.results[0];
        setStockCheckResult({
          currentStock: itemResult.currentStock,
          available: itemResult.available,
          shortfall: itemResult.shortfall,
        });
      } else {
        let errorData: any = null;
        const statusCode = response.status;
        const statusText = response.statusText;
        
        try {
          errorData = await response.json();
        } catch (e) {
          // Response body is not JSON, try getting text
          try {
            errorData = await response.text();
          } catch (e2) {
            errorData = null;
          }
        }
        
        const errorMsg = errorData?.message || errorData?.error || statusText || 'Failed to check stock';
        
        console.error(`[Stock Check] API Error (${statusCode} ${statusText}):`, errorMsg, {
          status: statusCode,
          statusText: statusText,
          data: errorData,
        });
        
        toast.error(`Stock check failed: ${errorMsg}`);
        setStockCheckResult(null);
      }
    } catch (error) {
      console.error('[Stock Check] Exception:', error instanceof Error ? error.message : String(error));
      const errorMessage = error instanceof Error ? error.message : 'Failed to check stock availability';
      toast.error(errorMessage);
      setStockCheckResult(null);
    } finally {
      setCheckingStock(false);
    }
  };

  /**
   * Trigger stock check when qty, date, or item changes
   * Add delay to avoid too many requests while user is typing
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      checkStockAvailability();
    }, 500); // 500ms delay after user stops typing

    return () => clearTimeout(timer);
  }, [formData.itemCode, formData.itemType, formData.qty, formData.date?.format('YYYY-MM-DD')]);

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!formData.date) {
      newErrors.date = 'Date is required';
    } else if (formData.date.isAfter(dayjs(), 'day')) {
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

    if (!formData.ppkekNumber.trim()) {
      newErrors.ppkekNumber = 'PPKEK Number is required';
    }

    if (!formData.registrationDate) {
      newErrors.registrationDate = 'Registration Date is required';
    }

    if (!formData.documentType) {
      newErrors.documentType = 'Document Type is required';
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
          ppkekNumber: formData.ppkekNumber || undefined,
          registrationDate: formData.registrationDate?.format('YYYY-MM-DD') || undefined,
          documentType: formData.documentType || undefined,
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
      capitalGoodsItem: null,
      itemCode: '',
      itemName: '',
      itemType: '',
      uom: '',
      qty: 0,
      currency: 'USD',
      amount: 0,
      recipientName: '',
      remarks: '',
      ppkekNumber: '',
      registrationDate: null,
      documentType: '',
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
                Customs Information
              </Typography>
              <Stack spacing={2} sx={{ mt: 2 }}>
                <TextField
                  fullWidth
                  label="PPKEK Number"
                  value={formData.ppkekNumber}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, ppkekNumber: e.target.value }));
                    setErrors((prev) => ({ ...prev, ppkekNumber: undefined }));
                  }}
                  placeholder="e.g., PPKEK-123456"
                  required
                  error={!!errors.ppkekNumber}
                  helperText={errors.ppkekNumber || 'Nomor pendaftaran PPKEK (customs registration number)'}
                />

                <DatePicker
                  label="Registration Date"
                  value={formData.registrationDate}
                  onChange={(newValue) => {
                    setFormData((prev) => ({ ...prev, registrationDate: newValue }));
                    setErrors((prev) => ({ ...prev, registrationDate: undefined }));
                  }}
                  maxDate={dayjs()}
                  slotProps={{
                    textField: {
                      fullWidth: true,
                      required: true,
                      error: !!errors.registrationDate,
                      helperText: errors.registrationDate || 'Customs registration date',
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
                    setErrors((prev) => ({ ...prev, documentType: undefined }));
                  }}
                  required
                  error={!!errors.documentType}
                  helperText={errors.documentType || 'Customs document type'}
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
              options={capitalGoodsItems}
              getOptionLabel={(option) => `${option.itemCode} - ${option.itemName}`}
              value={formData.capitalGoodsItem}
              onChange={(event, newValue) => {
                setFormData((prev) => ({
                  ...prev,
                  capitalGoodsItem: newValue,
                  itemCode: newValue?.itemCode || '',
                  itemName: newValue?.itemName || '',
                  itemType: newValue?.itemType || '',
                  uom: newValue?.uom || '',
                }));
                setErrors((prev) => ({
                  ...prev,
                  itemCode: undefined,
                  itemName: undefined,
                  itemType: undefined,
                  uom: undefined,
                }));
              }}
              loading={loadingCapitalGoodsItems}
              noOptionsText={capitalGoodsItems.length === 0 ? 'No items loaded' : 'No matching items'}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Item Code"
                  required
                  error={!!errors.itemCode}
                  helperText={errors.itemCode || `Select capital goods item from master (${capitalGoodsItems.length} items available)`}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loadingCapitalGoodsItems ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />

            <TextField
              fullWidth
              label="Item Name"
              value={formData.itemName}
              disabled
              required
              helperText="Auto-filled from selected item"
            />

            <TextField
              fullWidth
              label="Item Type"
              value={formData.itemType}
              disabled
              required
              helperText="Auto-filled from selected item"
            />

            <TextField
              fullWidth
              label="UOM"
              value={formData.uom}
              disabled
              required
              helperText="Auto-filled from selected item"
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

            {/* Stock Check Result Display */}
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
