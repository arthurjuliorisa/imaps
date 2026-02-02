'use client';

import React, { useState, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Alert,
  CircularProgress,
  alpha,
  useTheme,
} from '@mui/material';
import { UploadFile, Close, Save, CheckCircle, Error as ErrorIcon, Download } from '@mui/icons-material';
import ExcelJS from 'exceljs';
import dayjs from 'dayjs';
import { useToast } from '@/app/components/ToastProvider';
import { formatQty, formatAmount } from '@/lib/utils/format';

interface ImportedRecord {
  date: string;
  itemCode: string;
  recipientName: string;
  documentNumber: string;
  qty: number;
  currency: string;
  valueAmount: number;
  remarks: string;
  isValid: boolean;
  errors: string[];
}

interface CapitalGoodsExcelImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const VALID_CURRENCIES = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'];

export function CapitalGoodsExcelImportDialog({
  open,
  onClose,
  onSuccess,
}: CapitalGoodsExcelImportDialogProps) {
  const theme = useTheme();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [records, setRecords] = useState<ImportedRecord[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    try {
      const response = await fetch('/api/customs/capital-goods/template', {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Failed to download template');
      }

      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'Capital_Goods_Import_Template.xlsx';

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1];
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success('Template downloaded successfully');
    } catch (error) {
      console.error('Error downloading template:', error);
      toast.error('Failed to download template');
    } finally {
      setDownloading(false);
    }
  };

  const validateRecord = (row: any): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];

    if (!row.Date) errors.push('Date is required');
    if (!row['Item Code']) errors.push('Item Code is required');
    if (!row['Recipient Name']) errors.push('Recipient Name is required');
    if (!row.Qty && row.Qty !== 0) errors.push('Qty is required');
    if (!row.Currency) errors.push('Currency is required');
    if (!row['Value Amount'] && row['Value Amount'] !== 0) errors.push('Value Amount is required');

    if (row.Date) {
      const date = dayjs(row.Date);
      if (!date.isValid()) {
        errors.push('Invalid date format');
      } else if (date.isAfter(dayjs())) {
        errors.push('Date cannot be in the future');
      }
    }

    if (row.Qty !== undefined && row.Qty !== '') {
      const value = parseFloat(row.Qty);
      if (isNaN(value)) {
        errors.push('Qty must be a number');
      } else if (value <= 0) {
        errors.push('Qty must be greater than 0');
      }
    }

    if (row.Currency) {
      const currency = row.Currency.toString().toUpperCase();
      if (!VALID_CURRENCIES.includes(currency)) {
        errors.push(`Currency must be one of: ${VALID_CURRENCIES.join(', ')}`);
      }
    }

    if (row['Value Amount'] !== undefined && row['Value Amount'] !== '') {
      const value = parseFloat(row['Value Amount']);
      if (isNaN(value)) {
        errors.push('Value Amount must be a number');
      } else if (value <= 0) {
        errors.push('Value Amount must be greater than 0');
      }
    }

    if (row.Remarks && row.Remarks.toString().length > 1000) {
      errors.push('Remarks cannot exceed 1000 characters');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setLoading(true);
    setParseError(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(data);
      const worksheet = workbook.worksheets[0];

      const jsonData: any[] = [];
      const headers: string[] = [];

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          row.eachCell((cell) => {
            headers.push(cell.value?.toString() || '');
          });
        } else {
          const rowData: any = {};
          row.eachCell((cell, colNumber) => {
            const header = headers[colNumber - 1];
            if (header) {
              rowData[header] = cell.value;
            }
          });
          if (Object.keys(rowData).length > 0) {
            jsonData.push(rowData);
          }
        }
      });

      if (jsonData.length === 0) {
        setParseError('The Excel file is empty. Please upload a file with data.');
        setRecords([]);
        setLoading(false);
        return;
      }

      const processedRecords: ImportedRecord[] = jsonData.map((row: any) => {
        const validation = validateRecord(row);

        const qty = parseFloat(row.Qty) || 0;
        const valueAmount = parseFloat(row['Value Amount']) || 0;

        return {
          date: row.Date ? dayjs(row.Date).format('YYYY-MM-DD') : '',
          itemCode: row['Item Code'] || '',
          recipientName: row['Recipient Name'] || '',
          documentNumber: row['Document Number'] || '',
          qty,
          currency: row.Currency ? row.Currency.toString().toUpperCase() : '',
          valueAmount,
          remarks: row.Remarks || '',
          isValid: validation.isValid,
          errors: validation.errors,
        };
      });

      setRecords(processedRecords);
    } catch (error) {
      console.error('Error parsing Excel file:', error);
      setParseError('Failed to parse Excel file. Please ensure the file format is correct.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setImporting(true);
    try {
      const validRecords = records.filter((r) => r.isValid);

      const response = await fetch('/api/customs/capital-goods/outgoing/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: validRecords }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to import records');
      }

      const result = await response.json();
      toast.success(`Successfully imported ${result.imported || validRecords.length} record(s)`);

      setRecords([]);
      setFileName('');
      setParseError(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error importing records:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import records');
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setRecords([]);
    setFileName('');
    setParseError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  const validRecordsCount = records.filter((r) => r.isValid).length;
  const invalidRecordsCount = records.length - validRecordsCount;
  const canSubmit = validRecordsCount > 0 && invalidRecordsCount === 0;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          height: '85vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
          py: 1.5,
        }}
      >
        <Box>
          <Typography component="div" fontWeight="600" color="primary" sx={{ fontSize: '1.125rem' }}>
            Import from Excel
          </Typography>
          <Typography component="div" color="text.secondary" sx={{ fontSize: '0.75rem', mt: 0.25 }}>
            Upload capital goods outgoing data
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ mt: 2 }}>
        <Box sx={{ mb: 3 }}>
          <Alert
            severity="info"
            icon={false}
            sx={{
              mb: 2,
              py: 0.75,
              '& .MuiAlert-message': {
                width: '100%',
                py: 0,
              },
            }}
          >
            <Typography variant="caption">
              Download template → Fill with data → Upload file
            </Typography>
          </Alert>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Button
              variant="contained"
              size="small"
              startIcon={downloading ? <CircularProgress size={16} color="inherit" /> : <Download />}
              onClick={handleDownloadTemplate}
              disabled={downloading || loading || importing}
              sx={{
                textTransform: 'none',
                py: 0.75,
                px: 2,
                fontWeight: 500,
                fontSize: '0.813rem',
                bgcolor: theme.palette.info.main,
                '&:hover': {
                  bgcolor: theme.palette.info.dark,
                },
              }}
            >
              {downloading ? 'Downloading...' : 'Download Template'}
            </Button>

            <Button
              variant="outlined"
              size="small"
              startIcon={<UploadFile />}
              onClick={handleFileSelect}
              disabled={loading || importing || downloading}
              sx={{
                textTransform: 'none',
                py: 0.75,
                px: 2,
                fontWeight: 500,
                fontSize: '0.813rem',
              }}
            >
              {fileName ? 'Change File' : 'Upload File'}
            </Button>

            {fileName && (
              <Typography variant="caption" color="text.secondary">
                <strong>{fileName}</strong>
              </Typography>
            )}
          </Box>

          <Alert severity="info" icon={false} sx={{ mb: 2, py: 0.75 }}>
            <Typography variant="caption" component="div">
              <strong>Format:</strong> Date | Item Code | Recipient Name | Qty | Currency | Value Amount | Remarks
            </Typography>
          </Alert>

          {parseError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {parseError}
            </Alert>
          )}

          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <CircularProgress size={24} />
              <Typography variant="body2">Parsing Excel file...</Typography>
            </Box>
          )}

          {records.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Alert severity={canSubmit ? 'success' : 'warning'} icon={false} sx={{ py: 0.5 }}>
                <Typography variant="caption">
                  <strong>{records.length}</strong> record(s) -
                  <Chip
                    label={`${validRecordsCount} Valid`}
                    size="small"
                    color="success"
                    sx={{ mx: 0.5, height: 20, fontSize: '0.7rem' }}
                  />
                  {invalidRecordsCount > 0 && (
                    <Chip
                      label={`${invalidRecordsCount} Invalid`}
                      size="small"
                      color="error"
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                  )}
                </Typography>
              </Alert>
            </Box>
          )}
        </Box>

        {records.length > 0 && (
          <TableContainer component={Paper} sx={{ maxHeight: 'calc(85vh - 320px)' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f1f5f9',
                    borderBottom: `2px solid ${theme.palette.divider}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>
                    Status
                  </TableCell>
                  <TableCell sx={{
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f1f5f9',
                    borderBottom: `2px solid ${theme.palette.divider}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>
                    Date
                  </TableCell>
                  <TableCell sx={{
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f1f5f9',
                    borderBottom: `2px solid ${theme.palette.divider}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>
                    Item Code
                  </TableCell>
                  <TableCell sx={{
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f1f5f9',
                    borderBottom: `2px solid ${theme.palette.divider}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>
                    Recipient
                  </TableCell>
                  <TableCell sx={{
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f1f5f9',
                    borderBottom: `2px solid ${theme.palette.divider}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>
                    Doc Number
                  </TableCell>
                  <TableCell align="right" sx={{
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f1f5f9',
                    borderBottom: `2px solid ${theme.palette.divider}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>
                    Qty
                  </TableCell>
                  <TableCell sx={{
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f1f5f9',
                    borderBottom: `2px solid ${theme.palette.divider}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>
                    Currency
                  </TableCell>
                  <TableCell align="right" sx={{
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f1f5f9',
                    borderBottom: `2px solid ${theme.palette.divider}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>
                    Value
                  </TableCell>
                  <TableCell sx={{
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f1f5f9',
                    borderBottom: `2px solid ${theme.palette.divider}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>
                    Remarks
                  </TableCell>
                  <TableCell sx={{
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f1f5f9',
                    borderBottom: `2px solid ${theme.palette.divider}`,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>
                    Errors
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {records.map((record, index) => (
                  <TableRow
                    key={index}
                    sx={{
                      bgcolor: record.isValid
                        ? 'transparent'
                        : alpha(theme.palette.error.main, 0.04),
                    }}
                  >
                    <TableCell>
                      {record.isValid ? (
                        <CheckCircle color="success" fontSize="small" />
                      ) : (
                        <ErrorIcon color="error" fontSize="small" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontSize="0.875rem">
                        {record.date ? dayjs(record.date).format('MM/DD/YYYY') : '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} fontSize="0.875rem">
                        {record.itemCode || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontSize="0.875rem">
                        {record.recipientName || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontSize="0.875rem" color="text.secondary">
                        {record.documentNumber || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="error.main" fontWeight={600} fontSize="0.875rem">
                        {formatQty(record.qty)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontSize="0.875rem">
                        {record.currency || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600} fontSize="0.875rem">
                        {formatAmount(record.valueAmount)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" fontSize="0.875rem">
                        {record.remarks || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {record.errors.length > 0 && (
                        <Box>
                          {record.errors.map((error, i) => (
                            <Typography
                              key={i}
                              variant="caption"
                              color="error"
                              display="block"
                            >
                              {error}
                            </Typography>
                          ))}
                        </Box>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
        <Button
          onClick={handleClose}
          startIcon={<Close />}
          disabled={importing}
          sx={{ textTransform: 'none' }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          startIcon={importing ? <CircularProgress size={20} /> : <Save />}
          disabled={!canSubmit || importing}
          sx={{
            textTransform: 'none',
            borderRadius: 2,
            px: 3,
          }}
        >
          {importing ? 'Importing...' : `Import ${validRecordsCount} Record(s)`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
