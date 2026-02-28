/**
 * FullResetMode Component
 * Handles full database reset (all 25 tables)
 */

import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Button,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  LinearProgress,
  useTheme,
  alpha,
  Chip,
} from '@mui/material';
import {
  ArrowBack,
  Warning,
  Lock,
  CheckCircle,
  Error as ErrorIcon,
  Backup as BackupIcon,
  FolderOpen as FolderOpenIcon,
} from '@mui/icons-material';
import { FormControlLabel, Checkbox } from '@mui/material';
import { useToast } from '@/app/components/ToastProvider';
import { CleanupProgress, useExecuteCleanup } from '@/hooks/useSelectiveCleanup';

interface FullResetModeProps {
  onBack: () => void;
}

type ConfirmationStep = 'preview' | 'password' | 'executing' | 'completed' | 'error';

export function FullResetMode({ onBack }: FullResetModeProps) {
  const theme = useTheme();
  const { showToast } = useToast();
  const { progress, isRunning, error, execute } = useExecuteCleanup();
  const [step, setStep] = useState<ConfirmationStep>('preview');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [createBackup, setCreateBackup] = useState(true);
  const [backupLocation, setBackupLocation] = useState('./backups');
  const [showBackupOptions, setShowBackupOptions] = useState(false);

  const handleStartCleanup = () => {
    setStep('password');
  };

  const handleConfirmPassword = async () => {
    if (!password) {
      setPasswordError('Password is required');
      return;
    }

    setPasswordError('');
    setStep('executing');

    try {
      // Execute full reset (pass empty array to indicate full cleanup)
      await execute([], password, 'full', createBackup, backupLocation);

      if (!error) {
        setStep('completed');
        showToast('Database cleanup completed successfully', 'success');
      } else {
        setStep('error');
        showToast(`Cleanup failed: ${error}`, 'error');
      }
    } catch (err) {
      setStep('error');
      const message = err instanceof Error ? err.message : 'Cleanup failed';
      showToast(message, 'error');
    }
  };

  const canConfirmFinal = confirmText === 'DELETE ALL DATA';

  return (
    <Box>
      <Stack spacing={3}>
        {/* Back Button */}
        <Button
          startIcon={<ArrowBack />}
          onClick={onBack}
          disabled={isRunning || ['executing', 'completed', 'error'].includes(step)}
          sx={{ alignSelf: 'flex-start' }}
        >
          Back
        </Button>

        {/* Preview Step */}
        {step === 'preview' && (
          <Card>
            <CardHeader
              avatar={<Warning sx={{ color: theme.palette.error.main }} />}
              title="Full Reset - Delete All Data"
              subheader="This action will delete all data from 25 tables"
            />
            <CardContent>
              <Stack spacing={3}>
                {/* Warning */}
                <Alert severity="error" icon={<Warning />}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                    This action cannot be undone
                  </Typography>
                  <Typography variant="body2">
                    All data in the following table categories will be permanently deleted:
                  </Typography>
                </Alert>

                {/* Table Stats */}
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
                    Tables to be cleared:
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    <Chip label="Phase 1: Scrap Management" variant="outlined" />
                    <Chip label="Phase 2: Incoming Goods" variant="outlined" />
                    <Chip label="Phase 3: Material Usage" variant="outlined" />
                    <Chip label="Phase 4: Production Output" variant="outlined" />
                    <Chip label="Phase 5: Adjustments" variant="outlined" />
                    <Chip label="Phase 6: Outgoing Goods" variant="outlined" />
                    <Chip label="Phase 7: Audit & Logging" variant="outlined" />
                  </Box>
                </Box>

                {/* Features */}
                <Box
                  sx={{
                    p: 2,
                    bgcolor: alpha(theme.palette.info.main, 0.05),
                    borderRadius: 1,
                  }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
                    ✓ All operations will be logged in audit trail
                  </Typography>

                  {/* Backup Options */}
                  <Stack spacing={2}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={createBackup}
                          onChange={(e) => setCreateBackup(e.target.checked)}
                          icon={<BackupIcon />}
                          checkedIcon={<BackupIcon />}
                        />
                      }
                      label="Create backup before cleanup"
                    />

                    {createBackup && (
                      <Box sx={{ ml: 4, p: 2, bgcolor: alpha(theme.palette.primary.main, 0.05), borderRadius: 1 }}>
                        <Stack spacing={2}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Backup Location"
                            value={backupLocation}
                            onChange={(e) => setBackupLocation(e.target.value)}
                            placeholder="./backups or /path/to/backups"
                            InputProps={{
                              startAdornment: <FolderOpenIcon sx={{ mr: 1, color: 'action.active' }} />,
                            }}
                            helperText="Path relative to project or absolute path"
                          />
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            Default: ./backups (relative to project root)
                          </Typography>
                        </Stack>
                      </Box>
                    )}
                  </Stack>
                </Box>

                {/* Action Buttons */}
                <Stack direction="row" spacing={2} sx={{ pt: 2 }}>
                  <Button
                    variant="outlined"
                    onClick={onBack}
                    disabled={isRunning}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={handleStartCleanup}
                    disabled={isRunning}
                  >
                    Proceed to Confirmation
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Password Step */}
        {step === 'password' && (
          <Card>
            <CardHeader
              avatar={<Lock sx={{ color: theme.palette.warning.main }} />}
              title="Confirm with Password"
              subheader="Admin authentication required"
            />
            <CardContent>
              <Stack spacing={3}>
                <Alert severity="warning">
                  Please enter your password to confirm this dangerous operation.
                </Alert>

                <TextField
                  fullWidth
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError('');
                  }}
                  error={!!passwordError}
                  helperText={passwordError}
                  placeholder="Enter your password"
                  autoFocus
                />

                <Stack direction="row" spacing={2}>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setStep('preview');
                      setPassword('');
                      setPasswordError('');
                    }}
                    disabled={isRunning}
                  >
                    Back
                  </Button>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={handleConfirmPassword}
                    disabled={!password || isRunning}
                  >
                    Confirm & Start Cleanup
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Executing Step */}
        {step === 'executing' && progress && (
          <Card>
            <CardHeader
              avatar={
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    bgcolor: alpha(theme.palette.info.main, 0.1),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      animation: 'spin 2s linear infinite',
                      '@keyframes spin': {
                        '0%': { transform: 'rotate(0deg)' },
                        '100%': { transform: 'rotate(360deg)' },
                      },
                    }}
                  >
                    ⚙️
                  </Box>
                </Box>
              }
              title="Cleanup in Progress"
              subheader={`Phase ${progress.phase}: ${progress.phase_name}`}
            />
            <CardContent>
              <Stack spacing={3}>
                {/* Progress Bar */}
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                    Current Operation
                  </Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                    {progress.message}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={
                      progress.tables_total > 0
                        ? (progress.tables_completed / progress.tables_total) * 100
                        : 0
                    }
                  />
                  <Typography variant="caption" color="textSecondary" sx={{ mt: 1 }}>
                    {progress.tables_completed} / {progress.tables_total} tables completed
                  </Typography>
                </Box>

                {/* Statistics */}
                <Stack direction="row" spacing={3}>
                  <Box>
                    <Typography variant="caption" color="textSecondary">
                      Phase
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {progress.phase} / 7
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="textSecondary">
                      Rows Deleted
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {progress.rows_deleted.toLocaleString()}
                    </Typography>
                  </Box>
                </Stack>

                <Alert severity="info">
                  Please do not close or refresh this page during cleanup.
                </Alert>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Completed Step */}
        {step === 'completed' && (
          <Card sx={{ bgcolor: alpha(theme.palette.success.main, 0.05) }}>
            <CardHeader
              avatar={<CheckCircle sx={{ color: theme.palette.success.main }} />}
              title="Cleanup Completed Successfully"
              subheader="Database has been cleaned"
            />
            <CardContent>
              <Stack spacing={3}>
                <Alert severity="success">
                  Database cleanup has been completed successfully. All cleanup operations
                  have been logged in the audit trail.
                </Alert>

                {progress && (
                  <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      sx={{ display: 'block', mb: 0.5 }}
                    >
                      Summary:
                    </Typography>
                    <Typography variant="body2">
                      • Total rows deleted: {progress.rows_deleted.toLocaleString()}
                    </Typography>
                    <Typography variant="body2">
                      • Tables cleaned: {progress.tables_total}
                    </Typography>
                    <Typography variant="body2">
                      • Phase completed: 7 / 7
                    </Typography>
                  </Box>
                )}

                <Stack direction="row" spacing={2}>
                  <Button
                    variant="outlined"
                    onClick={onBack}
                  >
                    Back to Menu
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => {
                      setStep('preview');
                      setPassword('');
                      setConfirmText('');
                    }}
                  >
                    Perform Another Cleanup
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Error Step */}
        {step === 'error' && (
          <Card sx={{ bgcolor: alpha(theme.palette.error.main, 0.05) }}>
            <CardHeader
              avatar={<ErrorIcon sx={{ color: theme.palette.error.main }} />}
              title="Cleanup Failed"
              subheader="An error occurred during cleanup"
            />
            <CardContent>
              <Stack spacing={3}>
                <Alert severity="error">
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    {error || 'Unknown error occurred'}
                  </Typography>
                  <Typography variant="body2">
                    The database backup has been preserved. Please contact support if the
                    cleanup fails repeatedly.
                  </Typography>
                </Alert>

                <Stack direction="row" spacing={2}>
                  <Button
                    variant="outlined"
                    onClick={onBack}
                  >
                    Go Back
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => {
                      setStep('preview');
                      setPassword('');
                      setConfirmText('');
                    }}
                  >
                    Try Again
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Box>
  );
}
