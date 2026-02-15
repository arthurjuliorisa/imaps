'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Alert,
  AlertTitle,
  Box,
  Typography,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Link,
} from '@mui/material';
import { CloudDownload, Upload as UploadIcon, CheckCircle } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface ExcelUploadDialogProps {
  open: boolean;
  onClose: () => void;
  stockOpnameId: number;
  onSuccess: () => void;
}

interface UploadedRow {
  row: number;
  item_code: string;
  sto_qty: number;
  report_area?: string;
  remark?: string;
  isValid: boolean;
  errorMessage?: string;
}

export function ExcelUploadDialog({
  open,
  onClose,
  stockOpnameId,
  onSuccess,
}: ExcelUploadDialogProps) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedData, setUploadedData] = useState<UploadedRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast.error('Please upload an Excel file (.xlsx or .xls)');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadedData([]);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(progress);
        }
      });

      const uploadPromise = new Promise<any>((resolve, reject) => {
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const error = JSON.parse(xhr.responseText);
              reject(new Error(error.message || 'Upload failed'));
            } catch {
              reject(new Error('Upload failed'));
            }
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Upload failed'));
        });

        xhr.open('POST', `/api/customs/stock-opname/${stockOpnameId}/items/validate-upload`);
        xhr.send(formData);
      });

      const result = await uploadPromise;
      setUploadedData(result.rows || []);

      const validCount = result.rows?.filter((r: UploadedRow) => r.isValid).length || 0;
      const invalidCount = result.rows?.length - validCount || 0;

      if (invalidCount === 0) {
        toast.success(`File validated successfully. ${validCount} items ready to submit.`);
      } else {
        toast.warning(`File validated. ${validCount} valid items, ${invalidCount} items with errors.`);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to upload file');
      setUploadedData([]);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleSubmit = async () => {
    const validRows = uploadedData.filter(row => row.isValid);
    if (validRows.length === 0) {
      toast.error('No valid items to submit');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/customs/stock-opname/${stockOpnameId}/items/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: validRows }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to submit items');
      }

      const result = await response.json();
      toast.success(`Successfully added ${result.success} items`);
      setUploadedData([]);
      onSuccess();
    } catch (error) {
      console.error('Error submitting items:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to submit items');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!uploading && !submitting) {
      setUploadedData([]);
      onClose();
    }
  };

  const validCount = uploadedData.filter(r => r.isValid).length;
  const invalidCount = uploadedData.length - validCount;
  const hasErrors = invalidCount > 0;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle>Upload Excel File</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 2 }}>
          <Alert severity="info">
            <AlertTitle>Important Information</AlertTitle>
            <Typography variant="body2" component="div">
              <ul style={{ marginTop: 8, marginBottom: 8, paddingLeft: 20 }}>
                <li><strong>Data Format</strong>: Data will be read starting from row 3. Rows 1-2 should contain headers.</li>
                <li><strong>Item Code</strong> (required): Must match existing item codes in master data</li>
                <li><strong>STO Qty</strong> (required): Stock opname quantity (must be a number)</li>
                <li><strong>Report Area</strong> (optional): Reporting area information</li>
                <li><strong>Remark</strong> (optional): Additional notes</li>
              </ul>
            </Typography>
          </Alert>

          <Stack direction="row" spacing={2}>
            <Link
              href="/api/customs/stock-opname/template"
              download
              underline="none"
              sx={{ flex: 1 }}
            >
              <Button
                variant="outlined"
                startIcon={<CloudDownload />}
                fullWidth
              >
                Download Template
              </Button>
            </Link>

            <Box sx={{ flex: 1 }}>
              <input
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                id="excel-upload-input"
                type="file"
                onChange={handleFileSelect}
                disabled={uploading}
              />
              <label htmlFor="excel-upload-input">
                <Button
                  variant="contained"
                  component="span"
                  startIcon={<UploadIcon />}
                  disabled={uploading}
                  fullWidth
                >
                  {uploading ? 'Uploading...' : 'Select Excel File'}
                </Button>
              </label>
            </Box>
          </Stack>

          {uploading && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Upload Progress: {uploadProgress}%
              </Typography>
              <LinearProgress variant="determinate" value={uploadProgress} />
            </Box>
          )}

          {uploadedData.length > 0 && (
            <>
              <Alert severity={hasErrors ? 'warning' : 'success'}>
                <Typography variant="body2" fontWeight={600}>
                  Valid Items: {validCount} | Invalid Items: {invalidCount}
                </Typography>
                {hasErrors && (
                  <Typography variant="caption" color="error">
                    Please review items with errors below. Only valid items will be submitted.
                  </Typography>
                )}
              </Alert>

              <TableContainer sx={{ maxHeight: 400 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Row</TableCell>
                      <TableCell>Item Code</TableCell>
                      <TableCell>STO Qty</TableCell>
                      <TableCell>Report Area</TableCell>
                      <TableCell>Remark</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {uploadedData.map((row, index) => (
                      <TableRow key={index} sx={{ bgcolor: row.isValid ? 'inherit' : 'error.lighter' }}>
                        <TableCell>{row.row}</TableCell>
                        <TableCell>{row.item_code}</TableCell>
                        <TableCell>{row.sto_qty}</TableCell>
                        <TableCell>{row.report_area || '-'}</TableCell>
                        <TableCell>{row.remark || '-'}</TableCell>
                        <TableCell>
                          {row.isValid ? (
                            <Chip
                              label="Valid"
                              color="success"
                              size="small"
                              icon={<CheckCircle />}
                            />
                          ) : (
                            <Chip
                              label={row.errorMessage || 'Invalid'}
                              color="error"
                              size="small"
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={uploading || submitting}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={uploading || submitting || validCount === 0}
        >
          {submitting ? 'Submitting...' : `Submit ${validCount} Items`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
