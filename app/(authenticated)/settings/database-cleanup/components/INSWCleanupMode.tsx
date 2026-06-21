/**
 * INSWCleanupMode Component
 * Handles INSW temporary data cleanup (test mode only)
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
  CheckCircle,
  Error as ErrorIcon,
  CloudOff,
} from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';
import { useSession } from 'next-auth/react';

interface INSWCleanupModeProps {
  onBack: () => void;
}

type ConfirmationStep = 'preview' | 'password' | 'executing' | 'completed' | 'error';

export function INSWCleanupMode({ onBack }: INSWCleanupModeProps) {
  const theme = useTheme();
  const { showToast } = useToast();
  const { data: session } = useSession();
  const companyCode = session?.user?.companyCode;

  const [step, setStep] = useState<ConfirmationStep>('preview');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<any>(null);

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
    setIsExecuting(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/insw-cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || data.error || 'Cleanup failed');
        setStep('error');
        showToast(`Cleanup failed: ${data.message || data.error}`, 'error');
        return;
      }

      setResponse(data);
      setStep('completed');
      showToast('INSW temporary data and local tracking logs cleaned successfully', 'success');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Cleanup failed';
      setError(errorMsg);
      setStep('error');
      showToast(errorMsg, 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Box>
      <Stack spacing={3}>
        {/* Back Button */}
        <Button
          startIcon={<ArrowBack />}
          onClick={onBack}
          disabled={isExecuting || ['executing', 'completed', 'error'].includes(step)}
          sx={{ alignSelf: 'flex-start' }}
        >
          Back
        </Button>

        {/* Preview Step */}
        {step === 'preview' && (
          <Card>
            <CardHeader
              title="INSW Temporary Data Cleanup"
              subheader="Test Mode Only"
              avatar={<CloudOff sx={{ color: 'warning.main', fontSize: 32 }} />}
            />
            <CardContent>
              <Stack spacing={3}>
                {/* Info Alert */}
                <Alert severity="info">
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    Test Mode Operation
                  </Typography>
                  <Typography variant="body2">
                    This operation removes temporary transaction data from INSW and clears the local
                    INSW transmission logs for your current company. Logs belonging to other
                    companies are not affected.
                  </Typography>
                </Alert>

                <Alert severity="success">
                  <Typography variant="body2">
                    INSW cleanup will only affect data for company {companyCode || 'your current company'}.
                  </Typography>
                </Alert>

                {/* Details */}
                <Box sx={{ backgroundColor: alpha(theme.palette.info.main, 0.05), p: 2, borderRadius: 1 }}>
                  <Stack spacing={1}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Endpoint:
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        https://api.insw.go.id/api-prod/inventory/temp/transaksi
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Method:
                      </Typography>
                      <Chip label="DELETE" size="small" variant="outlined" />
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Action:
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Remove temporary transaksi data for company {companyCode || 'your current company'} only
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Local logs:
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Deleted for company {companyCode || 'your current company'} after external cleanup succeeds
                      </Typography>
                    </Box>
                  </Stack>
                </Box>

                {/* Warning */}
                <Alert severity="warning" icon={<Warning />}>
                  <Typography variant="body2">
                    This operation will permanently delete temporary transaction data from INSW for
                    company {companyCode || 'your current company'} only. Data belonging to other
                    companies will not be affected. Local INSW tracking logs for this company will
                    also be deleted after the external cleanup succeeds. This action cannot be undone.
                  </Typography>
                </Alert>

                {/* Actions */}
                <Stack direction="row" spacing={2} sx={{ pt: 2 }}>
                  <Button variant="outlined" onClick={onBack}>
                    Cancel
                  </Button>
                  <Button
                    variant="contained"
                    color="warning"
                    onClick={handleStartCleanup}
                  >
                    Proceed with Cleanup
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Password Confirmation Step */}
        {step === 'password' && (
          <Dialog open={true} onClose={() => setStep('preview')} maxWidth="sm" fullWidth>
            <DialogTitle>Confirm Password</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 2 }}>
                <Typography variant="body2" color="textSecondary">
                  Please enter your password to confirm this INSW cleanup operation for company{' '}
                  {companyCode || 'your current company'} only.
                </Typography>
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
                  disabled={isExecuting}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleConfirmPassword();
                    }
                  }}
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button
                onClick={() => setStep('preview')}
                disabled={isExecuting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmPassword}
                variant="contained"
                color="warning"
                disabled={isExecuting || !password}
              >
                {isExecuting ? 'Processing...' : 'Confirm'}
              </Button>
            </DialogActions>
          </Dialog>
        )}

        {/* Executing Step */}
        {step === 'executing' && (
          <Card>
            <CardContent>
              <Stack spacing={2} sx={{ textAlign: 'center' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Cleaning up INSW temporary data...
                </Typography>
                <LinearProgress />
                <Typography variant="body2" color="textSecondary">
                  Please wait. This operation may take a few moments.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Completed Step */}
        {step === 'completed' && response && (
          <Card sx={{ backgroundColor: alpha(theme.palette.success.main, 0.05) }}>
            <CardContent>
              <Stack spacing={2}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CheckCircle sx={{ color: 'success.main', fontSize: 32 }} />
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Cleanup Completed Successfully
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      INSW cleanup completed for company {response.companyCode || companyCode || 'your current company'}.
                    </Typography>
                  </Box>
                </Box>

                {/* Response Details */}
                <Box sx={{ backgroundColor: alpha(theme.palette.success.main, 0.1), p: 2, borderRadius: 1 }}>
                  <Stack spacing={1}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        External temporary data:
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>
                        {response.externalINSWCleanup?.success ? 'Cleaned' : 'Unknown'}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        Local tracking logs deleted:
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>
                        {(response.localTrackingLogCleanup?.deletedRows ?? 0).toLocaleString()}
                      </Typography>
                    </Box>
                    {response.timestamp && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>
                          Timestamp:
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {new Date(response.timestamp).toLocaleString()}
                        </Typography>
                      </Box>
                    )}
                  </Stack>
                </Box>

                {/* Actions */}
                <Stack direction="row" spacing={2} sx={{ pt: 2 }}>
                  <Button variant="outlined" onClick={onBack} fullWidth>
                    Back to Cleanup Menu
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Error Step */}
        {step === 'error' && (
          <Card sx={{ backgroundColor: alpha(theme.palette.error.main, 0.05) }}>
            <CardContent>
              <Stack spacing={2}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ErrorIcon sx={{ color: 'error.main', fontSize: 32 }} />
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Cleanup Failed
                    </Typography>
                  </Box>
                </Box>

                {/* Error Message */}
                {error && (
                  <Box sx={{ backgroundColor: alpha(theme.palette.error.main, 0.1), p: 2, borderRadius: 1 }}>
                    <Typography variant="body2" color="error">
                      {error}
                    </Typography>
                  </Box>
                )}

                {/* Actions */}
                <Stack direction="row" spacing={2} sx={{ pt: 2 }}>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setStep('preview');
                      setPassword('');
                      setError(null);
                    }}
                    fullWidth
                  >
                    Try Again
                  </Button>
                  <Button variant="contained" onClick={onBack} fullWidth>
                    Back to Menu
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
