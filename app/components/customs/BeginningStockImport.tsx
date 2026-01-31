'use client';

import React, { useState, useRef, useEffect } from 'react';
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
import { formatQty } from '@/lib/utils/format';

interface ImportedRecord {
  itemType: string;
  itemCode: string;
  itemName: string;
  uom: string;
  qty: number;
  balanceDate: string;
  ppkekNumbers: string[];
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
  const [validItemTypes, setValidItemTypes] = useState<string[]>([]);
  const [backendValidationErrors, setBackendValidationErrors] = useState<Array<{itemCode: string; error: string}>>([]);

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const getApiEndpoint = () => {
    return '/api/customs/beginning-data';
  };

  /**
   * Fetch valid (active) item types from the API and return them
   */
  const fetchValidItemTypesData = async (): Promise<string[]> => {
    try {
      const response = await fetch('/api/master/item-types?active=true', {
        method: 'GET',
      });

      if (response.ok) {
        const data = await response.json();
        // Extract item type codes from the response
        const codes = data.data?.map((it: any) => it.item_type_code) || [];
        setValidItemTypes(codes);
        return codes;
      }
      return [];
    } catch (error) {
      console.error('Error fetching valid item types:', error);
      return [];
    }
  };

  /**
   * Fetch valid item types when dialog opens
   */
  useEffect(() => {
    if (open) {
      fetchValidItemTypesData();
    }
  }, [open]);

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
      let filename = 'BeginningDataTemplate.xlsx';

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

  const validateRecord = (row: any, itemTypesList: string[]): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];

    // Required field validation
    if (!row['Item Type']) {
      errors.push('Item Type is required');
    } else {
      // Validate Item Type exists in valid types (must check against the list)
      const itemTypeValue = String(row['Item Type']).trim();
      if (itemTypesList.length > 0) {
        if (!itemTypesList.includes(itemTypeValue)) {
          errors.push(`Invalid Item Type '${itemTypeValue}'. Valid types: ${itemTypesList.join(', ')}`);
        }
      }
    }
    
    if (!row['Item Code']) errors.push('Item Code is required');
    if (!row['Item Name']) errors.push('Item Name is required');
    if (!row['UOM']) errors.push('UOM is required');
    if (!row['Qty'] && row['Qty'] !== 0) errors.push('Qty is required');
    if (!row['Balance Date']) errors.push('Balance Date is required');

    // Qty validation
    if (row['Qty'] !== undefined && row['Qty'] !== '') {
      const value = parseFloat(row['Qty']);
      if (isNaN(value)) {
        errors.push('Qty must be a number');
      } else if (value <= 0) {
        errors.push('Qty must be greater than 0');
      }
    }

    // Date validation
    if (row['Balance Date']) {
      const date = dayjs(row['Balance Date']);
      if (!date.isValid()) {
        errors.push('Invalid date format');
      } else if (date.isAfter(dayjs(), 'day')) {
        errors.push('Balance date cannot be in the future');
      }
    }

    // PPKEK Numbers validation (optional)
    if (row['PPKEK Numbers']) {
      const ppkekStr = row['PPKEK Numbers'].toString().trim();
      if (ppkekStr && ppkekStr.length > 0) {
        // Validate that each ppkek number (separated by comma) is not empty
        const ppkeks = ppkekStr.split(',').map((p: string) => p.trim());
        const invalidPpkeks = ppkeks.some((p: string) => !p);
        if (invalidPpkeks) {
          errors.push('PPKEK Numbers format invalid (comma-separated values)');
        }
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
    setBackendValidationErrors([]);

    try {
      // Ensure valid item types are fetched before parsing
      let itemTypesList = validItemTypes;
      if (itemTypesList.length === 0) {
        itemTypesList = await fetchValidItemTypesData();
      }

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
            // Remove asterisk (*) from header names for backward compatibility
            const headerValue = cell.value?.toString() || '';
            const cleanHeader = headerValue.replace(/\*$/, '').trim();
            headers.push(cleanHeader);
          });
        } else if (rowNumber === 2) {
          // Second row is format hints - skip it
          return;
        } else {
          // Data rows (start from row 3)
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

      // Process and validate records using fetched item types
      const processedRecords: ImportedRecord[] = jsonData.map((row: any) => {
        const validation = validateRecord(row, itemTypesList);
        const qty = parseFloat(row['Qty']) || 0;
        
        // Parse PPKEK Numbers (comma-separated)
        const ppkekStr = row['PPKEK Numbers'] ? row['PPKEK Numbers'].toString().trim() : '';
        const ppkekNumbers = ppkekStr
          ? ppkekStr.split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0)
          : [];

        return {
          itemType: row['Item Type'] || '',
          itemCode: row['Item Code'] || '',
          itemName: row['Item Name'] || '',
          uom: row['UOM'] || '',
          qty,
          balanceDate: row['Balance Date'] ? dayjs(row['Balance Date']).format('MM/DD/YYYY') : '',
          ppkekNumbers,
          remarks: row['Remarks'] || '',
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
    setBackendValidationErrors([]);
    try {
      const validRecords = records.filter((r) => r.isValid);
      await onSubmit(validRecords);
      // Reset state
      setRecords([]);
      setFileName('');
      setParseError(null);
      setBackendValidationErrors([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onClose();
    } catch (error: any) {
      console.error('Error importing records:', error);

      // Check if error contains validation errors from backend
      if (error.validationErrors && Array.isArray(error.validationErrors)) {
        // Map backend validation errors to records
        // Backend errors format: { row: number, field: string, error: string }
        const backendErrors: Array<{itemCode: string; error: string}> = [];

        error.validationErrors.forEach((validationError: any) => {
          // Row number from backend (1-based) needs to match our records array (0-based)
          // But actually, we need to match by item code since rows might not align
          // The backend returns row numbers based on the request array
          const recordIndex = validationError.row - 1; // Convert to 0-based index
          if (recordIndex >= 0 && recordIndex < records.length) {
            const record = records[recordIndex];
            backendErrors.push({
              itemCode: record.itemCode,
              error: validationError.error
            });
          }
        });

        setBackendValidationErrors(backendErrors);

        // Update records to mark them as invalid and add backend errors
        const updatedRecords = records.map(record => {
          const backendError = backendErrors.find(e => e.itemCode === record.itemCode);
          if (backendError) {
            return {
              ...record,
              isValid: false,
              errors: [...record.errors, backendError.error]
            };
          }
          return record;
        });

        setRecords(updatedRecords);
      }
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setRecords([]);
    setFileName('');
    setParseError(null);
    setBackendValidationErrors([]);
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
              <strong>Format:</strong> Item Type | Item Code | Item Name | UOM | Qty | Balance Date | PPKEK Numbers | Remarks
            </Typography>
            <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
              <strong>Note:</strong> Data harus dimulai dari baris ke-3 (Row 3). Baris 1 adalah header, baris 2 adalah format hint.
            </Typography>
          </Alert>

          {validItemTypes.length > 0 && (
            <Alert severity="success" icon={false} sx={{ mb: 2, py: 0.75 }}>
              <Typography variant="caption" component="div">
                <strong>Valid Item Types:</strong> {validItemTypes.join(', ')}
              </Typography>
              <Typography variant="caption" component="div" sx={{ mt: 0.5, color: 'text.secondary' }}>
                Only active item types are accepted. Contact admin if you need to activate more types.
              </Typography>
            </Alert>
          )}

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

              {backendValidationErrors.length > 0 && (
                <Alert severity="error" sx={{ mt: 1, py: 1 }}>
                  <Typography variant="body2" fontWeight={600} gutterBottom>
                    Validation Error dari Server
                  </Typography>
                  <Typography variant="caption" component="div">
                    {backendValidationErrors.length} item tidak dapat ditambahkan karena:
                  </Typography>
                  <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2 }}>
                    {backendValidationErrors.map((error, index) => (
                      <Typography key={index} variant="caption" component="li">
                        <strong>{error.itemCode}</strong>: {error.error}
                      </Typography>
                    ))}
                  </Box>
                  <Typography variant="caption" component="div" sx={{ mt: 1, fontStyle: 'italic' }}>
                    Import dibatalkan. Perbaiki error di atas dan coba lagi.
                  </Typography>
                </Alert>
              )}
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
                    Item Type
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
                    Item Name
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
                    UOM
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
                    Balance Date
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
                    PPKEK Numbers
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
                        {record.itemType || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} fontSize="0.875rem">
                        {record.itemCode || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontSize="0.875rem">
                        {record.itemName || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontSize="0.875rem">
                        {record.uom || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600} fontSize="0.875rem">
                        {formatQty(record.qty)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontSize="0.875rem">
                        {record.balanceDate || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontSize="0.875rem">
                        {record.ppkekNumbers.length > 0 ? record.ppkekNumbers.join(', ') : '-'}
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
