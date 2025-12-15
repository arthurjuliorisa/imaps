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
  scrapId: string;
  scrapCode: string;
  scrapName: string;
  incoming: number;
  remarks: string;
}

interface ManualEntryDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: FormData) => Promise<void>;
}

interface ScrapMaster {
  id: string;
  code: string;
  name: string;
  description?: string;
  items?: any[];
}

export function ManualEntryDialog({ open, onClose, onSubmit }: ManualEntryDialogProps) {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [scraps, setScraps] = useState<ScrapMaster[]>([]);
  const [loadingScraps, setLoadingScraps] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    date: dayjs(),
    scrapId: '',
    scrapCode: '',
    scrapName: '',
    incoming: 0,
    remarks: '',
  });

  // Fetch scraps when dialog opens
  useEffect(() => {
    if (open) {
      fetchScraps();
    }
  }, [open]);

  const fetchScraps = async () => {
    setLoadingScraps(true);
    try {
      const response = await fetch('/api/master/scrap');
      if (response.ok) {
        const data = await response.json();
        setScraps(data);
      }
    } catch (error) {
      console.error('Error fetching scraps:', error);
    } finally {
      setLoadingScraps(false);
    }
  };

  const handleScrapSelect = (scrap: ScrapMaster | null) => {
    if (scrap) {
      setFormData((prev) => ({
        ...prev,
        scrapId: scrap.id,
        scrapCode: scrap.code,
        scrapName: scrap.name,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        scrapId: '',
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
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit(formData);
      // Reset form after successful submission
      setFormData({
        date: dayjs(),
        scrapId: '',
        scrapCode: '',
        scrapName: '',
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
    formData.scrapId !== '' &&
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

            {/* Scrap Master Autocomplete */}
            <Autocomplete
              options={scraps}
              loading={loadingScraps}
              getOptionLabel={(option) => `${option.code} - ${option.name}`}
              onChange={(_event, newValue) => handleScrapSelect(newValue)}
              value={scraps.find((scrap) => scrap.id === formData.scrapId) || null}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Scrap"
                  placeholder="Search scrap master..."
                  required
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loadingScraps ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
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
