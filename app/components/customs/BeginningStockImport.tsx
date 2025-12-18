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
import { useToast } from '../ToastProvider';

interface ImportedRecord {
  itemCode: string;
  beginningBalance: number;
  beginningDate: string;
  remarks: string;
  // Validation
  isValid: boolean;
  errors: string[];
}

interface BeginningStockImportProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ImportedRecord[]) => Promise<void>;
}

export function BeginningStockImport({ open, onClose, onSubmit }: BeginningStockImportProps) {
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

  const getApiEndpoint = () => {
    return '/api/customs/beginning-data';
  };

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    try {
      const response = await fetch(`${getApiEndpoint()}/template`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Failed to download template');
      }

      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'Beginning_Data_Template.xlsx';

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1];
        }
      }

      // Convert response to blob
      const blob = await response.blob();

      // Create download link and trigger download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();

      // Cleanup
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

    // Required field validation
    if (!row['Item Code']) errors.push('Item Code is required');
    if (!row['Beginning Balance'] && row['Beginning Balance'] !== 0) errors.push('Beginning Balance is required');
    if (!row['Beginning Date']) errors.push('Beginning Date is required');

    // Beginning Balance validation
    if (row['Beginning Balance'] !== undefined && row['Beginning Balance'] !== '') {
      const value = parseFloat(row['Beginning Balance']);
      if (isNaN(value)) {
        errors.push('Beginning Balance must be a number');
      } else if (value <= 0) {
        errors.push('Beginning Balance must be greater than 0');
      }
    }

    // Date validation
    if (row['Beginning Date']) {
      const date = dayjs(row['Beginning Date']);
      if (!date.isValid()) {
        errors.push('Invalid date format');
      } else if (date.isAfter(dayjs(), 'day')) {
        errors.push('Beginning date cannot be in the future');
      }
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

      // Convert worksheet to JSON
      const jsonData: any[] = [];
      const headers: string[] = [];

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          // First row is headers
          row.eachCell((cell) => {
            headers.push(cell.value?.toString() || '');
          });
        } else {
          // Data rows
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

      // Process and validate records
      const processedRecords: ImportedRecord[] = jsonData.map((row: any) => {
        const validation = validateRecord(row);
        const beginningBalance = parseFloat(row['Beginning Balance']) || 0;

        return {
          itemCode: row['Item Code'] || '',
          beginningBalance,
          beginningDate: row['Beginning Date'] ? dayjs(row['Beginning Date']).format('YYYY-MM-DD') : '',
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
      await onSubmit(validRecords);
      // Reset state
      setRecords([]);
      setFileName('');
      setParseError(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onClose();
    } catch (error) {
      console.error('Error importing records:', error);
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
            Upload beginning stock data from Excel template
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ mt: 2 }}>
        <Box sx={{ mb: 3 }}>
          {/* Step-by-step Instructions */}
          <Alert
            severity="info"
            icon={false}
            sx={{
              mb: 2,
              py: 0.75,
              '& .MuiAlert-message': {
                width: '100%',
                py: 0
              }
            }}
          >
            <Typography variant="caption">
              Download template → Fill with data → Upload file
            </Typography>
          </Alert>

          {/* File Upload Section */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {/* Buttons Side by Side */}
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
              <strong>Format:</strong> Item Code | Beginning Balance | Beginning Date | Remarks
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
                  <TableCell sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                    Status
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                    Item Code
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                    Beginning Balance
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                    Beginning Date
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                    Remarks
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
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
                      <Typography variant="body2" fontWeight={600} fontSize="0.875rem">
                        {record.itemCode || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600} fontSize="0.875rem">
                        {record.beginningBalance.toLocaleString('id-ID', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontSize="0.875rem">
                        {record.beginningDate ? dayjs(record.beginningDate).format('DD/MM/YYYY') : '-'}
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
