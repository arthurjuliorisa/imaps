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
  Checkbox,
  FormControlLabel,
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

type ConfirmationStep = 'preview' | 'confirm' | 'executing' | 'completed' | 'error';

export function INSWCleanupMode({ onBack }: INSWCleanupModeProps) {
  const theme = useTheme();
  const { showToast } = useToast();
  const { data: session } = useSession();
  const companyCode = session?.user?.companyCode;

  const [step, setStep] = useState<ConfirmationStep>('preview');
  const [confirmationText, setConfirmationText] = useState('');
  const [producersStopped, setProducersStopped] = useState(false);
  const [confirmationError, setConfirmationError] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<any>(null);

  const handleStartCleanup = () => {
    setStep('confirm');
  };

  const handleConfirmCleanup = async () => {
    if (confirmationText !== `RESET ${companyCode}` || !producersStopped) {
      setConfirmationError(`Enter RESET ${companyCode} and confirm all producers are stopped`);
      return;
    }

    setConfirmationError('');
    setStep('executing');
    setIsExecuting(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/insw-cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmation: confirmationText, producersStopped }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const message = data.error?.message || data.message || 'Cleanup failed';
        setError(message);
        setStep('error');
        showToast(`Cleanup failed: ${message}`, 'error');
        return;
      }

      setResponse(data);
      setStep('completed');
      showToast(data.message || 'INSW temporary data and local tracking logs cleaned successfully', 'success');
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
                    companies are not affected. In Development/Staging, this also removes local
                    operational queues, attempts, manual resolutions and preparation records. Stop
                    all workers and producers and wait for transmissions to finish before cleanup.
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
                        INSW Sandbox temporary transaction cleanup (external DELETE)
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
                    This invokes real external INSW Sandbox cleanup and permanently discards local test queues, attempts and logs in Development/Staging, including uncertain-delivery history, for
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

        {/* Destructive Confirmation Step */}
        {step === 'confirm' && (
          <Dialog open={true} onClose={() => setStep('preview')} maxWidth="sm" fullWidth>
            <DialogTitle>Confirm INSW Cleanup</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 2 }}>
                <Typography variant="body2" color="textSecondary">
                  Type RESET followed by the company code to irrevocably discard test data and invoke external INSW Sandbox cleanup for company{' '}
                  {companyCode || 'your current company'} only.
                </Typography>
                <FormControlLabel
                  control={<Checkbox checked={producersStopped} onChange={e => setProducersStopped(e.target.checked)} />}
                  label="I confirm all INSW workers and producers are stopped and there are no active transmissions."
                />
                <Typography variant="caption">
                  The database cannot prove remote HTTP requests have stopped. Confirm this with the operators of every producer before continuing.
                </Typography>
                <TextField
                  fullWidth
                  label={`Type RESET ${companyCode}`}
                  autoComplete="off"
                  value={confirmationText}
                  onChange={(e) => {
                    setConfirmationText(e.target.value);
                    setConfirmationError('');
                  }}
                  error={!!confirmationError}
                  helperText={confirmationError}
                  disabled={isExecuting}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleConfirmCleanup();
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
                onClick={handleConfirmCleanup}
                variant="contained"
                color="warning"
                disabled={isExecuting || confirmationText !== `RESET ${companyCode}` || !producersStopped}
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
                    {response.localQueueCleanup?.success && (
                      <Typography variant="caption">
                        Queues: {response.localQueueCleanup.queues}; attempts: {response.localQueueCleanup.attempts};
                        {' '}manual resolutions: {response.localQueueCleanup.resolutions};
                        {' '}preparation ledgers: {response.localQueueCleanup.preparationLedgers};
                        {' '}preparation members: {response.localQueueCleanup.preparationMembers}
                      </Typography>
                    )}
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
                      setConfirmationText('');
                      setProducersStopped(false);
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
