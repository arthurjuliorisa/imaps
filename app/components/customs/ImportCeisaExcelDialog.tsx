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
  CircularProgress,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface ImportCeisaExcelDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  transactionType: 'SCRAP' | 'CAPITAL_GOODS';
  defaultDirection?: 'IN' | 'OUT';
  allowDirectionChange?: boolean;
}

interface PreviewData {
  companyName: string;
  docType: string;
  ppkekNumber: string;
  regDate: string;
  docNumber: string;
  docDate: string;
  recipientName: string;
  itemType: string;
  currency: string;
  items: Array<{
    itemCode: string;
    itemName: string;
    unit: string;
    quantity: number;
    valueAmount: number;
  }>;
}

export function ImportCeisaExcelDialog({
  open,
  onClose,
  onSuccess,
  transactionType,
  defaultDirection = 'IN',
  allowDirectionChange = true,
}: ImportCeisaExcelDialogProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [direction, setDirection] = useState<'IN' | 'OUT'>(defaultDirection);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const handleFileSelect = (file: File) => {
    if (!file.name.endsWith('.xlsx')) {
      toast.error('Please select a valid Excel file (.xlsx)');
      return;
    }

    setSelectedFile(file);
    setErrors([]);
    setPreviewData(null);
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);

    const file = event.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleImport = async () => {
    if (!selectedFile) {
      toast.error('Please select a file');
      return;
    }

    setLoading(true);
    setErrors([]);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('transactionType', transactionType);
      formData.append('direction', direction);

      const response = await fetch('/api/customs/import-ceisa-excel', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.errors && Array.isArray(result.errors)) {
          setErrors(result.errors.map((e: any) => typeof e === 'string' ? e : e.message || JSON.stringify(e)));
        } else {
          setErrors([result.message || 'Import failed']);
        }
        toast.error(result.message || 'Failed to import Excel file');
        return;
      }

      toast.success(
        `Successfully imported ${result.data.itemCount} item(s) with WMS ID: ${result.data.wmsId}`
      );

      handleClose();
      onSuccess();
    } catch (error) {
      console.error('Import error:', error);
      toast.error('An unexpected error occurred during import');
      setErrors(['An unexpected error occurred. Please try again.']);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setSelectedFile(null);
      setPreviewData(null);
      setErrors([]);
      setDirection(defaultDirection);
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      disableEscapeKeyDown={loading}
    >
      <DialogTitle>
        Import Ceisa 4.0 Excel - {transactionType === 'SCRAP' ? 'Scrap' : 'Capital Goods'} ({direction === 'IN' ? 'Incoming' : 'Outgoing'})
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {allowDirectionChange && (
            <FormControl component="fieldset">
              <FormLabel component="legend">Transaction Direction</FormLabel>
              <RadioGroup
                row
                value={direction}
                onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')}
              >
                <FormControlLabel value="IN" control={<Radio />} label="Incoming" disabled={loading} />
                <FormControlLabel value="OUT" control={<Radio />} label="Outgoing" disabled={loading} />
              </RadioGroup>
            </FormControl>
          )}

          {errors.length > 0 && (
            <Alert severity="error">
              <Typography variant="body2" fontWeight="bold" gutterBottom>
                Import Errors:
              </Typography>
              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                {errors.map((error, index) => (
                  <li key={index}>
                    <Typography variant="body2">{error}</Typography>
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          <Paper
            variant="outlined"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            sx={{
              p: 4,
              textAlign: 'center',
              border: dragOver ? '2px dashed' : '2px dashed',
              borderColor: dragOver ? 'primary.main' : 'divider',
              bgcolor: dragOver ? 'action.hover' : 'background.paper',
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': {
                bgcolor: 'action.hover',
                borderColor: 'primary.main',
              },
            }}
            onClick={handleUploadClick}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
              disabled={loading}
            />

            {!selectedFile ? (
              <>
                <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  Drag and drop your Ceisa 4.0 Excel file here
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  or click to browse
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  Supported format: .xlsx
                </Typography>
              </>
            ) : (
              <>
                <CheckCircleIcon sx={{ fontSize: 48, color: 'success.main', mb: 2 }} />
                <Typography variant="body1" fontWeight="bold" gutterBottom>
                  {selectedFile.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {(selectedFile.size / 1024).toFixed(2)} KB
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  Click to select a different file
                </Typography>
              </>
            )}
          </Paper>

          {previewData && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Preview
              </Typography>

              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="body2">
                  <strong>Company:</strong> {previewData.companyName}
                </Typography>
                <Typography variant="body2">
                  <strong>Doc Type:</strong> {previewData.docType}
                </Typography>
                <Typography variant="body2">
                  <strong>PPKEK Number:</strong> {previewData.ppkekNumber}
                </Typography>
                <Typography variant="body2">
                  <strong>Doc Number:</strong> {previewData.docNumber}
                </Typography>
                <Typography variant="body2">
                  <strong>Doc Date:</strong> {previewData.docDate}
                </Typography>
                <Typography variant="body2">
                  <strong>Recipient:</strong> {previewData.recipientName}
                </Typography>
                <Typography variant="body2">
                  <strong>Item Type:</strong> {previewData.itemType}
                </Typography>
              </Paper>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Item Code</TableCell>
                      <TableCell>Item Name</TableCell>
                      <TableCell>Unit</TableCell>
                      <TableCell align="right">Quantity</TableCell>
                      <TableCell align="right">Value</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewData.items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>{item.itemCode}</TableCell>
                        <TableCell>{item.itemName}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell align="right">{item.quantity}</TableCell>
                        <TableCell align="right">
                          {previewData.currency} {item.valueAmount.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}

          <Alert severity="info">
            <Typography variant="body2">
              <strong>Instructions:</strong>
            </Typography>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
              <li>
                <Typography variant="body2">
                  Upload the Excel file exported from Ceisa 4.0 system
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  The file must contain HEADER, DOKUMEN, ENTITAS, and BARANG sheets
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  All required fields will be validated before import
                </Typography>
              </li>
            </ul>
          </Alert>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleImport}
          variant="contained"
          disabled={!selectedFile || loading}
          startIcon={loading ? <CircularProgress size={20} /> : <CloudUploadIcon />}
        >
          {loading ? 'Importing...' : 'Import'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
