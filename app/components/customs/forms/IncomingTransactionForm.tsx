'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Stepper,
  Step,
  StepLabel,
  Button,
  Typography,
  Grid,
  TextField,
  MenuItem,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Autocomplete,
  alpha,
  useTheme,
  Stack,
  Chip,
  Divider,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import {
  Save,
  NavigateNext,
  NavigateBefore,
  Description,
  Inventory,
  CheckCircle,
  Add,
  Delete,
  Close,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { useToast } from '@/app/components/ToastProvider';
import { createIncomingTransaction } from '@/lib/api';
import { formatQty, formatAmount } from '@/lib/utils/format';
import {
  CustomsDocumentType,
  ItemTypeCode,
  Currency,
} from '@/types/core';
import type {
  IncomingTransactionRequest,
} from '@/types/core';

interface FormHeaderData {
  wms_id: string;
  company_code: string;
  customs_document_type: CustomsDocumentType;
  incoming_evidence_number: string;
  customs_registration_date: Dayjs | null;
  owner: string;
  incoming_date: Dayjs | null;
  ppkek_number: string;
  invoice_number: string;
  invoice_date: Dayjs | null;
  shipper_name: string;
}

interface FormDetailData {
  id: string;
  item_type: ItemTypeCode;
  item_code: string;
  item_name: string;
  uom: string;
  qty: number;
  currency: Currency;
  amount: number;
  hs_code: string;
}

const steps = [
  { label: 'Document Header', icon: <Description /> },
  { label: 'Item Details', icon: <Inventory /> },
  { label: 'Review & Submit', icon: <CheckCircle /> },
];

const CUSTOMS_DOC_TYPES: CustomsDocumentType[] = [
  CustomsDocumentType.BC23,
  CustomsDocumentType.BC27,
  CustomsDocumentType.BC40
];
const ITEM_TYPES: ItemTypeCode[] = [
  ItemTypeCode.ROH,
  ItemTypeCode.HALB,
  ItemTypeCode.FERT,
  ItemTypeCode.HIBE,
  ItemTypeCode.HIBE_M,
  ItemTypeCode.HIBE_E,
  ItemTypeCode.HIBE_T,
  ItemTypeCode.SCRAP
];
const CURRENCIES: Currency[] = [
  Currency.IDR,
  Currency.USD,
  Currency.EUR,
  Currency.JPY,
  Currency.CNY
];

export function IncomingTransactionForm() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const [header, setHeader] = useState<FormHeaderData>({
    wms_id: '',
    company_code: '',
    customs_document_type: CustomsDocumentType.BC23,
    incoming_evidence_number: '',
    customs_registration_date: null,
    owner: '',
    incoming_date: dayjs(),
    ppkek_number: '',
    invoice_number: '',
    invoice_date: dayjs(),
    shipper_name: '',
  });

  const [details, setDetails] = useState<FormDetailData[]>([]);

  const handleNext = () => {
    // Validate current step
    if (activeStep === 0) {
      if (!validateHeader()) {
        return;
      }
    } else if (activeStep === 1) {
      if (details.length === 0) {
        toast.error('Please add at least one item');
        return;
      }
      if (!validateDetails()) {
        return;
      }
    }
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  const validateHeader = (): boolean => {
    if (!header.wms_id.trim()) {
      toast.error('WMS ID is required');
      return false;
    }
    if (!header.company_code.trim()) {
      toast.error('Company Code is required');
      return false;
    }
    if (!header.incoming_evidence_number.trim()) {
      toast.error('Incoming Evidence Number is required');
      return false;
    }
    if (!header.customs_registration_date) {
      toast.error('Customs Registration Date is required');
      return false;
    }
    if (!header.owner.trim()) {
      toast.error('Owner is required');
      return false;
    }
    if (!header.incoming_date) {
      toast.error('Incoming Date is required');
      return false;
    }
    if (!header.invoice_number.trim()) {
      toast.error('Invoice Number is required');
      return false;
    }
    if (!header.invoice_date) {
      toast.error('Invoice Date is required');
      return false;
    }
    if (!header.shipper_name.trim()) {
      toast.error('Shipper Name is required');
      return false;
    }
    return true;
  };

  const validateDetails = (): boolean => {
    for (let i = 0; i < details.length; i++) {
      const detail = details[i];
      if (!detail.item_code.trim()) {
        toast.error(`Item ${i + 1}: Item Code is required`);
        return false;
      }
      if (!detail.item_name.trim()) {
        toast.error(`Item ${i + 1}: Item Name is required`);
        return false;
      }
      if (!detail.uom.trim()) {
        toast.error(`Item ${i + 1}: UOM is required`);
        return false;
      }
      if (detail.qty <= 0) {
        toast.error(`Item ${i + 1}: Quantity must be greater than 0`);
        return false;
      }
      if (detail.amount < 0) {
        toast.error(`Item ${i + 1}: Amount cannot be negative`);
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const requestData: IncomingTransactionRequest = {
        header: {
          wms_id: header.wms_id,
          company_code: parseInt(header.company_code),
          owner: parseInt(header.owner),
          customs_document_type: header.customs_document_type,
          ppkek_number: header.ppkek_number,
          customs_registration_date: header.customs_registration_date!.toDate(),
          incoming_evidence_number: header.incoming_evidence_number,
          incoming_date: header.incoming_date!.toDate(),
          invoice_number: header.invoice_number,
          invoice_date: header.invoice_date!.toDate(),
          shipper_name: header.shipper_name,
          timestamp: new Date(),
        },
        details: details.map((detail) => ({
          incoming_good_id: 0,
          incoming_good_company: parseInt(header.company_code),
          incoming_good_date: header.incoming_date!.toDate(),
          item_type: detail.item_type,
          item_code: detail.item_code,
          item_name: detail.item_name,
          uom: detail.uom,
          qty: detail.qty,
          currency: detail.currency,
          amount: detail.amount,
          hs_code: detail.hs_code || undefined,
        })),
      };

      await createIncomingTransaction(requestData);
      toast.success('Incoming transaction created successfully');
      router.push('/customs/incoming');
    } catch (error) {
      console.error('Error creating transaction:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create transaction');
    } finally {
      setLoading(false);
    }
  };

  const addDetail = () => {
    setDetails([
      ...details,
      {
        id: `temp-${Date.now()}`,
        item_type: ItemTypeCode.ROH,
        item_code: '',
        item_name: '',
        uom: '',
        qty: 0,
        currency: Currency.IDR,
        amount: 0,
        hs_code: '',
      },
    ]);
  };

  const removeDetail = (id: string) => {
    setDetails(details.filter((d) => d.id !== id));
  };

  const updateDetail = (id: string, field: keyof FormDetailData, value: any) => {
    setDetails(details.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Document Header Information
            </Typography>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="WMS ID"
                  value={header.wms_id}
                  onChange={(e) => setHeader({ ...header, wms_id: e.target.value })}
                  helperText="Unique identifier for this transaction"
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="Company Code"
                  value={header.company_code}
                  onChange={(e) => setHeader({ ...header, company_code: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  required
                  select
                  label="Customs Document Type"
                  value={header.customs_document_type}
                  onChange={(e) =>
                    setHeader({ ...header, customs_document_type: e.target.value as CustomsDocumentType })
                  }
                >
                  {CUSTOMS_DOC_TYPES.map((type) => (
                    <MenuItem key={type} value={type}>
                      {type}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="Incoming Evidence Number"
                  value={header.incoming_evidence_number}
                  onChange={(e) => setHeader({ ...header, incoming_evidence_number: e.target.value })}
                  helperText="Document number for incoming goods"
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <LocalizationProvider dateAdapter={AdapterDayjs}>
                  <DatePicker
                    label="Customs Registration Date *"
                    value={header.customs_registration_date}
                    onChange={(date) => setHeader({ ...header, customs_registration_date: date })}
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        required: true,
                      },
                    }}
                  />
                </LocalizationProvider>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="Owner"
                  value={header.owner}
                  onChange={(e) => setHeader({ ...header, owner: e.target.value })}
                  helperText="Owner company code"
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <LocalizationProvider dateAdapter={AdapterDayjs}>
                  <DatePicker
                    label="Incoming Date *"
                    value={header.incoming_date}
                    onChange={(date) => setHeader({ ...header, incoming_date: date })}
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        required: true,
                      },
                    }}
                  />
                </LocalizationProvider>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="Invoice Number"
                  value={header.invoice_number}
                  onChange={(e) => setHeader({ ...header, invoice_number: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <LocalizationProvider dateAdapter={AdapterDayjs}>
                  <DatePicker
                    label="Invoice Date *"
                    value={header.invoice_date}
                    onChange={(date) => setHeader({ ...header, invoice_date: date })}
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        required: true,
                      },
                    }}
                  />
                </LocalizationProvider>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="Shipper Name"
                  value={header.shipper_name}
                  onChange={(e) => setHeader({ ...header, shipper_name: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  label="PPKEK Number"
                  value={header.ppkek_number}
                  onChange={(e) => setHeader({ ...header, ppkek_number: e.target.value })}
                  helperText="Optional"
                />
              </Grid>
            </Grid>
          </Box>
        );

      case 1:
        return (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography variant="h6">Item Details</Typography>
              <Button variant="contained" startIcon={<Add />} onClick={addDetail}>
                Add Item
              </Button>
            </Box>

            {details.length === 0 ? (
              <Paper
                sx={{
                  p: 8,
                  textAlign: 'center',
                  bgcolor: alpha(theme.palette.grey[500], 0.05),
                }}
              >
                <Inventory sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  No items added yet
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Click the "Add Item" button to start adding items to this transaction
                </Typography>
              </Paper>
            ) : (
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                      <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Item Type</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Item Code*</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Item Name*</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>UOM*</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Qty*</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Currency*</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Amount*</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>HS Code</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {details.map((detail, index) => (
                      <TableRow key={detail.id}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>
                          <TextField
                            select
                            size="small"
                            value={detail.item_type}
                            onChange={(e) =>
                              updateDetail(detail.id, 'item_type', e.target.value as ItemTypeCode)
                            }
                            sx={{ minWidth: 100 }}
                          >
                            {ITEM_TYPES.map((type) => (
                              <MenuItem key={type} value={type}>
                                {type}
                              </MenuItem>
                            ))}
                          </TextField>
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            value={detail.item_code}
                            onChange={(e) => updateDetail(detail.id, 'item_code', e.target.value)}
                            sx={{ minWidth: 120 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            value={detail.item_name}
                            onChange={(e) => updateDetail(detail.id, 'item_name', e.target.value)}
                            sx={{ minWidth: 200 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            value={detail.uom}
                            onChange={(e) => updateDetail(detail.id, 'uom', e.target.value)}
                            sx={{ minWidth: 80 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            type="number"
                            size="small"
                            value={detail.qty}
                            onChange={(e) => updateDetail(detail.id, 'qty', parseFloat(e.target.value) || 0)}
                            sx={{ minWidth: 100 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            select
                            size="small"
                            value={detail.currency}
                            onChange={(e) => updateDetail(detail.id, 'currency', e.target.value as Currency)}
                            sx={{ minWidth: 80 }}
                          >
                            {CURRENCIES.map((curr) => (
                              <MenuItem key={curr} value={curr}>
                                {curr}
                              </MenuItem>
                            ))}
                          </TextField>
                        </TableCell>
                        <TableCell>
                          <TextField
                            type="number"
                            size="small"
                            value={detail.amount}
                            onChange={(e) => updateDetail(detail.id, 'amount', parseFloat(e.target.value) || 0)}
                            sx={{ minWidth: 120 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            value={detail.hs_code}
                            onChange={(e) => updateDetail(detail.id, 'hs_code', e.target.value)}
                            sx={{ minWidth: 120 }}
                          />
                        </TableCell>
                        <TableCell>
                          <IconButton size="small" color="error" onClick={() => removeDetail(detail.id)}>
                            <Delete />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        );

      case 2:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Review & Submit
            </Typography>

            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Document Header
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Grid container spacing={2}>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">WMS ID</Typography>
                  <Typography variant="body1" fontWeight={500}>{header.wms_id}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Company Code</Typography>
                  <Typography variant="body1" fontWeight={500}>{header.company_code}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Customs Document Type</Typography>
                  <Chip label={header.customs_document_type} size="small" color="primary" />
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Incoming Evidence Number</Typography>
                  <Typography variant="body1" fontWeight={500}>{header.incoming_evidence_number}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Customs Registration Date</Typography>
                  <Typography variant="body1" fontWeight={500}>
                    {header.customs_registration_date?.format('MM/DD/YYYY')}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Owner</Typography>
                  <Typography variant="body1" fontWeight={500}>{header.owner}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Incoming Date</Typography>
                  <Typography variant="body1" fontWeight={500}>
                    {header.incoming_date?.format('MM/DD/YYYY')}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Invoice Number</Typography>
                  <Typography variant="body1" fontWeight={500}>{header.invoice_number}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Invoice Date</Typography>
                  <Typography variant="body1" fontWeight={500}>
                    {header.invoice_date?.format('MM/DD/YYYY')}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Shipper Name</Typography>
                  <Typography variant="body1" fontWeight={500}>{header.shipper_name}</Typography>
                </Grid>
                {header.ppkek_number && (
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">PPKEK Number</Typography>
                    <Typography variant="body1" fontWeight={500}>{header.ppkek_number}</Typography>
                  </Grid>
                )}
              </Grid>
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Item Details ({details.length} items)
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                      <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Qty</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>UOM</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {details.map((detail, index) => (
                      <TableRow key={detail.id}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>
                          <Chip label={detail.item_type} size="small" />
                        </TableCell>
                        <TableCell>{detail.item_code}</TableCell>
                        <TableCell>{detail.item_name}</TableCell>
                        <TableCell>{formatQty(detail.qty)}</TableCell>
                        <TableCell>{detail.uom}</TableCell>
                        <TableCell align="right">
                          {detail.currency} {formatAmount(detail.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box>
      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {steps.map((step, index) => (
          <Step key={step.label}>
            <StepLabel icon={step.icon}>{step.label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Paper sx={{ p: 3, mb: 3 }}>
        {renderStepContent()}
      </Paper>

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button
          variant="outlined"
          startIcon={<Close />}
          onClick={() => router.push('/customs/incoming')}
        >
          Cancel
        </Button>

        <Box sx={{ display: 'flex', gap: 2 }}>
          {activeStep > 0 && (
            <Button
              variant="outlined"
              startIcon={<NavigateBefore />}
              onClick={handleBack}
            >
              Back
            </Button>
          )}

          {activeStep < steps.length - 1 ? (
            <Button
              variant="contained"
              endIcon={<NavigateNext />}
              onClick={handleNext}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="contained"
              startIcon={<Save />}
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? 'Submitting...' : 'Submit'}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
