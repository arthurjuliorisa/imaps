'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Autocomplete,
  CircularProgress,
  Stack,
  Typography,
  Paper,
  alpha,
  useTheme,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { OutgoingHeaderData } from './OutgoingDocumentForm';

interface Customer {
  id: string;
  code: string;
  name: string;
  address?: string;
}

interface Currency {
  id: string;
  code: string;
  name: string;
}

interface OutgoingDocumentHeaderProps {
  data: OutgoingHeaderData;
  onChange: (data: OutgoingHeaderData) => void;
}

export function OutgoingDocumentHeader({ data, onChange }: OutgoingDocumentHeaderProps) {
  const theme = useTheme();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingCurrencies, setLoadingCurrencies] = useState(false);

  useEffect(() => {
    fetchCustomers();
    fetchCurrencies();
  }, []);

  const fetchCustomers = async () => {
    setLoadingCustomers(true);
    try {
      const response = await fetch('/api/master/customer?limit=1000');
      if (response.ok) {
        const result = await response.json();
        setCustomers(Array.isArray(result) ? result : result.data || []);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
    } finally {
      setLoadingCustomers(false);
    }
  };

  const fetchCurrencies = async () => {
    setLoadingCurrencies(true);
    try {
      const response = await fetch('/api/master/currency?limit=1000');
      if (response.ok) {
        const result = await response.json();
        setCurrencies(Array.isArray(result) ? result : result.data || []);
      }
    } catch (error) {
      console.error('Error fetching currencies:', error);
    } finally {
      setLoadingCurrencies(false);
    }
  };

  const handleCustomerSelect = (customer: Customer | null) => {
    onChange({
      ...data,
      recipientId: customer?.id || '',
      recipientCode: customer?.code || '',
      recipientName: customer?.name || '',
    });
  };

  const handleCurrencySelect = (currency: Currency | null) => {
    onChange({
      ...data,
      currencyId: currency?.id || '',
      currencyCode: currency?.code || '',
    });
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box>
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'primary.main', mb: 3 }}>
          Document Information
        </Typography>

        <Paper sx={{ p: 3, bgcolor: alpha(theme.palette.background.default, 0.5) }}>
          <Stack spacing={3}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 3 }}>
              <TextField
                fullWidth
                label="Document Code"
                value={data.docCode}
                onChange={(e) => onChange({ ...data, docCode: e.target.value })}
                placeholder="e.g., PEB, PPKEK"
                required
                helperText="Customs document code (e.g., PEB for export)"
              />

              <TextField
                fullWidth
                label="Document Number"
                value={data.docNumber}
                onChange={(e) => onChange({ ...data, docNumber: e.target.value })}
                placeholder="DOC-2024-001"
                required
                helperText="Internal document number"
              />

              <DatePicker
                label="Document Date"
                value={data.docDate}
                onChange={(newValue) => onChange({ ...data, docDate: newValue })}
                maxDate={dayjs()}
                slotProps={{
                  textField: {
                    fullWidth: true,
                    required: true,
                    helperText: 'Document date cannot be in the future',
                  },
                }}
              />

              <TextField
                fullWidth
                label="Company Code"
                value={data.companyCode}
                onChange={(e) => onChange({ ...data, companyCode: e.target.value })}
                placeholder="DEFAULT"
                helperText="Company identifier for multi-company setup"
              />
            </Box>

            <Box
              sx={{
                p: 2,
                bgcolor: alpha(theme.palette.info.main, 0.08),
                borderRadius: 1,
                border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
              }}
            >
              <Typography variant="subtitle2" fontWeight="bold" color="info.main" gutterBottom>
                PPKEK Registration
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Enter the PPKEK (Pusat Pengelolaan Kawasan Ekonomi Khusus) registration details
              </Typography>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 3 }}>
              <TextField
                fullWidth
                label="Register Number"
                value={data.registerNumber}
                onChange={(e) => onChange({ ...data, registerNumber: e.target.value })}
                placeholder="REG-2024-001"
                required
                helperText="PPKEK registration number"
              />

              <DatePicker
                label="Register Date"
                value={data.registerDate}
                onChange={(newValue) => onChange({ ...data, registerDate: newValue })}
                maxDate={dayjs()}
                slotProps={{
                  textField: {
                    fullWidth: true,
                    required: true,
                    helperText: 'Registration date cannot be in the future',
                  },
                }}
              />
            </Box>

            <Autocomplete
              options={customers}
              loading={loadingCustomers}
              getOptionLabel={(option) => `${option.code} - ${option.name}`}
              onChange={(_event, newValue) => handleCustomerSelect(newValue)}
              value={customers.find((c) => c.id === data.recipientId) || null}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Recipient (Customer)"
                  placeholder="Search customer..."
                  required
                  helperText="Select the customer receiving the goods"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loadingCustomers ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />

            <Autocomplete
              options={currencies}
              loading={loadingCurrencies}
              getOptionLabel={(option) => `${option.code} - ${option.name}`}
              onChange={(_event, newValue) => handleCurrencySelect(newValue)}
              value={currencies.find((c) => c.id === data.currencyId) || null}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Currency"
                  placeholder="Search currency..."
                  required
                  helperText="Transaction currency"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loadingCurrencies ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />

            <TextField
              fullWidth
              label="Remarks"
              multiline
              rows={3}
              value={data.remarks}
              onChange={(e) => onChange({ ...data, remarks: e.target.value })}
              placeholder="Enter any additional notes (optional)"
              inputProps={{ maxLength: 1000 }}
              helperText={`${data.remarks.length}/1000 characters`}
            />
          </Stack>
        </Paper>
      </Box>
    </LocalizationProvider>
  );
}
