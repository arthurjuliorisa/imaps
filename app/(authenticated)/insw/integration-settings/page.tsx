'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Alert,
  alpha,
  useTheme,
  Chip,
  Stack,
  Card,
  CardContent,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Switch,
  CircularProgress,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface INSWIntegrationSetting {
  id: number;
  endpoint_key: string;
  endpoint_name: string;
  description: string | null;
  is_enabled: boolean;
  updated_at: string;
  updated_by: string | null;
}

interface PendingToggle {
  setting: INSWIntegrationSetting;
  newValue: boolean;
}

export default function INSWIntegrationSettingsPage() {
  const theme = useTheme();
  const toast = useToast();

  const [settings, setSettings] = useState<INSWIntegrationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/insw/integration-settings');
      const result = await response.json();

      if (result.success && Array.isArray(result.data)) {
        setSettings(result.data);
        setError(null);
      } else {
        setSettings([]);
        setError(result.error || 'Gagal memuat pengaturan integrasi');
      }
    } catch (err) {
      console.error('Error fetching integration settings:', err);
      setSettings([]);
      setError('Gagal memuat pengaturan integrasi');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchSettings();
    toast.success('Pengaturan integrasi diperbarui');
  };

  const handleSwitchChange = (setting: INSWIntegrationSetting, newValue: boolean) => {
    setPendingToggle({ setting, newValue });
    setConfirmDialogOpen(true);
  };

  const handleCancelDialog = () => {
    setConfirmDialogOpen(false);
    setPendingToggle(null);
  };

  const handleConfirmToggle = async () => {
    if (!pendingToggle) return;

    const { setting, newValue } = pendingToggle;
    setSubmitting(true);

    try {
      const response = await fetch(
        `/api/insw/integration-settings/${setting.endpoint_key}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_enabled: newValue }),
        }
      );

      const result = await response.json();

      if (result.success && result.data) {
        setSettings((prev) =>
          prev.map((s) =>
            s.endpoint_key === setting.endpoint_key ? result.data : s
          )
        );

        const action = newValue ? 'diaktifkan' : 'dinonaktifkan';
        toast.success(`${setting.endpoint_name} berhasil ${action}`);
      } else {
        toast.error(result.error || 'Gagal memperbarui pengaturan integrasi');
      }
    } catch (err) {
      console.error('Error updating integration setting:', err);
      toast.error('Gagal memperbarui pengaturan integrasi');
    } finally {
      setSubmitting(false);
      setConfirmDialogOpen(false);
      setPendingToggle(null);
    }
  };

  const getConfirmBodyText = () => {
    if (!pendingToggle) return '';
    const action = pendingToggle.newValue ? 'mengaktifkan' : 'menonaktifkan';
    return `Yakin ingin ${action} integrasi "${pendingToggle.setting.endpoint_name}"?`;
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
          pb: 2,
          borderBottom: `2px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Box>
          <Typography variant="h5" fontWeight="bold" color="primary">
            Pengaturan Integrasi INSW
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Aktifkan atau nonaktifkan transmisi data ke INSW per endpoint
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh">
            <IconButton onClick={handleRefresh} color="primary">
              <Refresh />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ boxShadow: 1 }}>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          {loading ? (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                py: 8,
              }}
            >
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow
                    sx={{
                      bgcolor: alpha(theme.palette.primary.main, 0.05),
                    }}
                  >
                    <TableCell
                      sx={{
                        fontWeight: 'bold',
                        width: 60,
                        color: theme.palette.text.secondary,
                      }}
                    >
                      No
                    </TableCell>
                    <TableCell
                      sx={{
                        fontWeight: 'bold',
                        color: theme.palette.text.secondary,
                      }}
                    >
                      Nama Endpoint
                    </TableCell>
                    <TableCell
                      sx={{
                        fontWeight: 'bold',
                        color: theme.palette.text.secondary,
                      }}
                    >
                      Deskripsi
                    </TableCell>
                    <TableCell
                      sx={{
                        fontWeight: 'bold',
                        color: theme.palette.text.secondary,
                        width: 120,
                      }}
                    >
                      Status
                    </TableCell>
                    <TableCell
                      sx={{
                        fontWeight: 'bold',
                        color: theme.palette.text.secondary,
                        width: 160,
                      }}
                    >
                      Aktifkan/Nonaktifkan
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {settings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                        <Typography variant="body2" color="text.secondary">
                          Tidak ada data pengaturan integrasi
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    settings.map((setting, index) => (
                      <TableRow
                        key={setting.id}
                        hover
                        sx={{
                          '&:last-child td': { borderBottom: 0 },
                        }}
                      >
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">
                            {setting.endpoint_name}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mt: 0.25 }}
                          >
                            {setting.endpoint_key}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {setting.description || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={setting.is_enabled ? 'Aktif' : 'Nonaktif'}
                            color={setting.is_enabled ? 'success' : 'default'}
                            size="small"
                            sx={{ fontWeight: 'bold' }}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={setting.is_enabled}
                            onChange={(e) =>
                              handleSwitchChange(setting, e.target.checked)
                            }
                            color="success"
                            inputProps={{
                              'aria-label': `Toggle ${setting.endpoint_name}`,
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={confirmDialogOpen}
        onClose={handleCancelDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Konfirmasi Perubahan
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{getConfirmBodyText()}</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCancelDialog} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleConfirmToggle}
            variant="contained"
            color={pendingToggle?.newValue ? 'success' : 'error'}
            disabled={submitting}
          >
            {submitting ? (
              <CircularProgress size={18} color="inherit" />
            ) : (
              'Konfirmasi'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
