'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Grid,
  Typography,
  Autocomplete,
  CircularProgress,
  alpha,
  useTheme,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { IncomingDocumentHeaderData } from './IncomingDocumentForm';

interface Supplier {
  id: string;
  code: string;
  name: string;
  address?: string;
}

interface IncomingDocumentHeaderProps {
  data: IncomingDocumentHeaderData;
  onChange: (data: IncomingDocumentHeaderData) => void;
}

export function IncomingDocumentHeader({ data, onChange }: IncomingDocumentHeaderProps) {
  const theme = useTheme();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    setLoadingSuppliers(true);
    try {
      const response = await fetch('/api/master/supplier?limit=1000');
      if (response.ok) {
        const result = await response.json();
        setSuppliers(Array.isArray(result) ? result : result.data || []);
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    } finally {
      setLoadingSuppliers(false);
    }
  };

  const handleChange = (field: keyof IncomingDocumentHeaderData, value: any) => {
    onChange({ ...data, [field]: value });
  };

  const handleSupplierChange = (supplier: Supplier | null) => {
    if (supplier) {
      onChange({
        ...data,
        shipperId: supplier.id,
        shipperName: supplier.name,
      });
    } else {
      onChange({
        ...data,
        shipperId: '',
        shipperName: '',
      });
    }
  };

  const handleDateChange = (field: 'registerDate' | 'docDate', value: Dayjs | null) => {
    onChange({
      ...data,
      [field]: value ? value.toDate() : null,
    });
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom fontWeight={600} color="primary">
        Document Header Information
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Enter the customs document header details
      </Typography>

      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Grid container spacing={3}>
          {/* Document Code */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="Document Code"
              value={data.docCode}
              onChange={(e) => handleChange('docCode', e.target.value)}
              required
              placeholder="e.g., BC 2.3"
              helperText="Enter the document type code"
              inputProps={{ maxLength: 50 }}
            />
          </Grid>

          {/* PPKEK / Register Number */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="PPKEK / Register Number"
              value={data.registerNumber}
              onChange={(e) => handleChange('registerNumber', e.target.value)}
              required
              placeholder="e.g., 000001/KPU-01/2024"
              helperText="Enter the PPKEK/register number"
              inputProps={{ maxLength: 100 }}
            />
          </Grid>

          {/* Register Date */}
          <Grid size={{ xs: 12, md: 6 }}>
            <DatePicker
              label="Register Date"
              value={data.registerDate ? dayjs(data.registerDate) : null}
              onChange={(value) => handleDateChange('registerDate', value)}
              maxDate={dayjs()}
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                  helperText: 'Date cannot be in the future',
                },
              }}
            />
          </Grid>

          {/* Document Number */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="Document Number"
              value={data.docNumber}
              onChange={(e) => handleChange('docNumber', e.target.value)}
              required
              placeholder="e.g., 123456"
              helperText="Enter the document number"
              inputProps={{ maxLength: 100 }}
            />
          </Grid>

          {/* Document Date */}
          <Grid size={{ xs: 12, md: 6 }}>
            <DatePicker
              label="Document Date"
              value={data.docDate ? dayjs(data.docDate) : null}
              onChange={(value) => handleDateChange('docDate', value)}
              maxDate={dayjs()}
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                  helperText: 'Date cannot be in the future',
                },
              }}
            />
          </Grid>

          {/* Shipper */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Autocomplete
              options={suppliers}
              loading={loadingSuppliers}
              getOptionLabel={(option) => `${option.code} - ${option.name}`}
              onChange={(_event, newValue) => handleSupplierChange(newValue)}
              value={suppliers.find((s) => s.id === data.shipperId) || null}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Shipper / Supplier"
                  placeholder="Search shipper..."
                  required
                  helperText="Select the shipper/supplier"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loadingSuppliers ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
          </Grid>

          {/* Info Box */}
          <Grid size={{ xs: 12 }}>
            <Box
              sx={{
                p: 2,
                bgcolor: alpha(theme.palette.info.main, 0.08),
                borderRadius: 1,
                border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
              }}
            >
              <Typography variant="subtitle2" fontWeight="bold" color="info.main" gutterBottom>
                Information
              </Typography>
              <Typography variant="body2" color="text.secondary">
                All fields marked with <strong>*</strong> are required. Ensure all information matches the official customs documents.
              </Typography>
            </Box>
          </Grid>
        </Grid>
      </LocalizationProvider>
    </Box>
  );
}
