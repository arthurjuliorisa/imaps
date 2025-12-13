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
import {
  CustomsDocumentTypeIncoming,
  ItemTypeCode,
  CurrencyCode,
} from '@/types/v2.4.2';
import type {
  IncomingTransactionRequest,
} from '@/types/v2.4.2';

interface FormHeaderData {
  wms_id: string;
  company_code: string;
  customs_doc_type: CustomsDocumentTypeIncoming;
  customs_doc_number: string;
  customs_doc_date: Dayjs | null;
  owner: string;
  transaction_date: Dayjs | null;
  ppkek_number: string;
  remarks: string;
}

interface FormDetailData {
  id: string;
  item_type_code: ItemTypeCode;
  item_code: string;
  item_name: string;
  uom: string;
  qty: number;
  currency: CurrencyCode;
  amount: number;
  ppkek_number: string;
  hs_code: string;
  origin_country: string;
}

const steps = [
  { label: 'Document Header', icon: <Description /> },
  { label: 'Item Details', icon: <Inventory /> },
  { label: 'Review & Submit', icon: <CheckCircle /> },
];

const CUSTOMS_DOC_TYPES: CustomsDocumentTypeIncoming[] = [
  CustomsDocumentTypeIncoming.BC23,
  CustomsDocumentTypeIncoming.BC27,
  CustomsDocumentTypeIncoming.BC40
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
const CURRENCIES: CurrencyCode[] = [
  CurrencyCode.IDR,
  CurrencyCode.USD,
  CurrencyCode.EUR,
  CurrencyCode.JPY,
  CurrencyCode.CNY
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
    customs_doc_type: CustomsDocumentTypeIncoming.BC23,
    customs_doc_number: '',
    customs_doc_date: null,
    owner: '',
    transaction_date: dayjs(),
    ppkek_number: '',
    remarks: '',
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
    if (!header.customs_doc_number.trim()) {
      toast.error('Customs Document Number is required');
      return false;
    }
    if (!header.customs_doc_date) {
      toast.error('Customs Document Date is required');
      return false;
    }
    if (!header.owner.trim()) {
      toast.error('Owner is required (v2.4.2 requirement)');
      return false;
    }
    if (!header.transaction_date) {
      toast.error('Transaction Date is required');
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
          company_code: header.company_code,
          trx_date: header.transaction_date!.toDate(),
          wms_timestamp: new Date(),
          customs_doc_type: header.customs_doc_type,
          customs_doc_number: header.customs_doc_number,
          customs_doc_date: header.customs_doc_date!.toDate(),
          owner: header.owner,
          ppkek_number: header.ppkek_number || undefined,
          remarks: header.remarks || undefined,
        },
        details: details.map((detail) => ({
          wms_id: `${header.wms_id}-${detail.id}`,
          company_code: header.company_code,
          trx_date: header.transaction_date!.toDate(),
          item_type_code: detail.item_type_code,
          item_code: detail.item_code,
          item_name: detail.item_name,
          uom: detail.uom,
          qty: detail.qty,
          currency: detail.currency,
          amount: detail.amount,
          ppkek_number: detail.ppkek_number || undefined,
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
        item_type_code: ItemTypeCode.ROH,
        item_code: '',
        item_name: '',
        uom: '',
        qty: 0,
        currency: CurrencyCode.IDR,
        amount: 0,
        ppkek_number: '',
        hs_code: '',
        origin_country: '',
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
                  value={header.customs_doc_type}
                  onChange={(e) =>
                    setHeader({ ...header, customs_doc_type: e.target.value as CustomsDocumentTypeIncoming })
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
                  label="Customs Document Number"
                  value={header.customs_doc_number}
                  onChange={(e) => setHeader({ ...header, customs_doc_number: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <LocalizationProvider dateAdapter={AdapterDayjs}>
                  <DatePicker
                    label="Customs Document Date *"
                    value={header.customs_doc_date}
                    onChange={(date) => setHeader({ ...header, customs_doc_date: date })}
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
                  helperText="Required in v2.4.2 for consignment tracking"
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <LocalizationProvider dateAdapter={AdapterDayjs}>
                  <DatePicker
                    label="Transaction Date *"
                    value={header.transaction_date}
                    onChange={(date) => setHeader({ ...header, transaction_date: date })}
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
                  label="PPKEK Number"
                  value={header.ppkek_number}
                  onChange={(e) => setHeader({ ...header, ppkek_number: e.target.value })}
                  helperText="Optional"
                />
              </Grid>
              <Grid size={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  label="Remarks"
                  value={header.remarks}
                  onChange={(e) => setHeader({ ...header, remarks: e.target.value })}
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
                      <TableCell sx={{ fontWeight: 600 }}>PPKEK</TableCell>
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
                            value={detail.item_type_code}
                            onChange={(e) =>
                              updateDetail(detail.id, 'item_type_code', e.target.value as ItemTypeCode)
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
                            onChange={(e) => updateDetail(detail.id, 'currency', e.target.value as CurrencyCode)}
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
                            value={detail.ppkek_number}
                            onChange={(e) => updateDetail(detail.id, 'ppkek_number', e.target.value)}
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
                  <Typography variant="body2" color="text.secondary">Customs Doc Type</Typography>
                  <Chip label={header.customs_doc_type} size="small" color="primary" />
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Customs Doc Number</Typography>
                  <Typography variant="body1" fontWeight={500}>{header.customs_doc_number}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Customs Doc Date</Typography>
                  <Typography variant="body1" fontWeight={500}>
                    {header.customs_doc_date?.format('DD/MM/YYYY')}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Owner</Typography>
                  <Typography variant="body1" fontWeight={500}>{header.owner}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Transaction Date</Typography>
                  <Typography variant="body1" fontWeight={500}>
                    {header.transaction_date?.format('DD/MM/YYYY')}
                  </Typography>
                </Grid>
                {header.ppkek_number && (
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">PPKEK Number</Typography>
                    <Typography variant="body1" fontWeight={500}>{header.ppkek_number}</Typography>
                  </Grid>
                )}
                {header.remarks && (
                  <Grid size={12}>
                    <Typography variant="body2" color="text.secondary">Remarks</Typography>
                    <Typography variant="body1">{header.remarks}</Typography>
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
                          <Chip label={detail.item_type_code} size="small" />
                        </TableCell>
                        <TableCell>{detail.item_code}</TableCell>
                        <TableCell>{detail.item_name}</TableCell>
                        <TableCell>{detail.qty.toLocaleString('id-ID')}</TableCell>
                        <TableCell>{detail.uom}</TableCell>
                        <TableCell align="right">
                          {detail.currency} {detail.amount.toLocaleString('id-ID')}
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
