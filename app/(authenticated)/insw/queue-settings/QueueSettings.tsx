'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, Stack, TextField, Typography } from '@mui/material';
import { ConfirmDialog } from '@/app/components/ConfirmDialog';
import { useToast } from '@/app/components/ToastProvider';
import QueueMonitoring from './QueueMonitoring';
import type { intervalProjection } from '@/lib/insw-queue/interval-settings';

type Settings = ReturnType<typeof intervalProjection>;
const formatInterval = (ms: number) => `${ms / 1000} seconds (${ms.toLocaleString('en-US')} ms)`;

export default function QueueSettings({ showWorkerRecovery = false, workerRecoveryAvailable = false }: { showWorkerRecovery?: boolean; workerRecoveryAvailable?: boolean } = {}) {
  const toast = useToast();
  const [policy, setPolicy] = useState<Settings | null>(null);
  const [interval, setInterval] = useState('');
  const [maxAutoRetry, setMaxAutoRetry] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState('');
  const [recoveryConfirmation, setRecoveryConfirmation] = useState('');
  const [shutdownEvidence, setShutdownEvidence] = useState('');
  const recoverWorker = async (acknowledge = false) => {
    if (recoveryBusy || !workerRecoveryAvailable) return;
    if (acknowledge && (!recoveryConfirmation || !shutdownEvidence.trim() || shutdownEvidence.length > 500 || /[\u0000-\u001f]/.test(shutdownEvidence))) return;
    setRecoveryBusy(true); setRecoveryStatus('Checking');
    try {
      const response = await fetch('/api/insw/queue-settings/worker-recovery', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: acknowledge ? JSON.stringify({ confirmation: recoveryConfirmation, shutdownAcknowledged: true, evidence: shutdownEvidence.trim() }) : '{}',
      });
      if (!response.ok || !response.body) throw new Error('Unable to recover');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', finished = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const event = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
          if (['Checking', 'Recovering', 'Starting'].includes(event.stage)) setRecoveryStatus(event.stage);
          if (event.result === 'confirmation-required' && /^\d{13}\.[a-f0-9]{64}$/.test(event.confirmation)) {
            setRecoveryConfirmation(event.confirmation); setShutdownEvidence('');
            setRecoveryStatus('Shutdown verification required'); finished = true;
          } else if (event.result) {
            setRecoveryConfirmation('');
            if (!['running', 'already-running'].includes(event.result)) throw new Error('Unable to recover');
            const message = event.result === 'already-running' ? 'Already running' : 'Running';
            setRecoveryStatus(message); toast.success(message); finished = true;
          }
        }
      }
      if (!finished) throw new Error('Unable to recover');
    } catch { setRecoveryConfirmation(''); setRecoveryStatus('Unable to recover'); toast.error('Unable to recover'); }
    finally { setRecoveryBusy(false); }
  };
  const apply = (data: Settings) => {
    setPolicy(data); setInterval(String(data.intervalMs)); setMaxAutoRetry(String(data.maxAutoRetry)); setReason('');
  };
  const load = useCallback(async () => {
    setLoading(true); setPolicy(null);
    try {
      const response = await fetch('/api/insw/queue-settings', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load queue settings');
      apply(result.data);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const intervalMs = Number(interval);
  const validInterval = /^\d+$/.test(interval) && Number.isSafeInteger(intervalMs) && intervalMs >= 3600 && intervalMs <= 2147483647;
  const retries = Number(maxAutoRetry);
  const validRetries = /^\d+$/.test(maxAutoRetry) && Number.isSafeInteger(retries) && retries >= 0 && retries <= 10;
  const validReason = reason.trim().length > 0 && reason.trim().length <= 500 && !/[\u0000-\u001f]/.test(reason.trim());
  const canSave = !!policy && validInterval && validRetries && validReason && (intervalMs !== policy.intervalMs || retries !== policy.maxAutoRetry) && !loading && !saving;
  const save = async () => {
    if (!canSave || !policy) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/insw/queue-settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMs, maxAutoRetry: retries, expectedVersion: policy.version, reason: reason.trim() }),
      });
      const result = await response.json();
      if (response.status === 409) {
        const message = 'Another administrator changed the policy. Current settings have been reloaded; review and enter your change again.';
        setError(message); toast.error(message);
        await load();
        return;
      }
      if (!response.ok) throw new Error(result.error || 'Unable to save queue settings');
      apply(result.data); toast.success('Queue policy updated');
    } catch (err) {
      const message = (err as Error).message;
      setError(message); toast.error(message);
    } finally { setSaving(false); setConfirm(false); }
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 1280, mx: 'auto', minWidth: 0 }}>
      <Typography variant="h5" component="h1" color="primary" fontWeight="bold" sx={{ mb: 2 }}>INSW Queue Settings</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? <Box role="status" aria-label="Loading queue settings"><CircularProgress /></Box> : policy ? (
        <Card variant="outlined" component="section" aria-labelledby="transmission-policy-heading"><CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2} component="form" onSubmit={event => { event.preventDefault(); if (canSave) setConfirm(true); }}>
            <Typography id="transmission-policy-heading" variant="h6" component="h2">Transmission Policy</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
              <Typography variant="body2">Persisted processing interval: <strong>{formatInterval(policy.intervalMs)}</strong></Typography>
              <Typography variant="body2">Effective minimum spacing: <strong>{formatInterval(Math.max(3600, policy.intervalMs))}</strong></Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">Hard minimum: 3.6 seconds (3,600 ms) between processing starts globally. This setting may increase that spacing. Queue conditions and provider response times can add delays; changes take effect when the worker next reads policy.</Typography>
            {policy.intervalMs < 3600 && <Alert severity="info">The persisted interval is below the hard minimum. Effective start spacing remains at least 3,600 ms.</Alert>}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
              <TextField fullWidth label="Processing interval (milliseconds)" value={interval} onChange={event => setInterval(event.target.value)} disabled={saving || confirm}
                error={!validInterval} helperText={validInterval ? formatInterval(intervalMs) : 'Enter a whole number from 3,600 to 2,147,483,647 ms.'}
                slotProps={{ htmlInput: { inputMode: 'numeric', min: 3600, max: 2147483647, step: 1 } }} required />
              <TextField fullWidth label="Maximum Automatic Retries" value={maxAutoRetry} onChange={event => setMaxAutoRetry(event.target.value)} disabled={saving || confirm}
                error={!validRetries} helperText="Enter a whole number from 0 to 10. 0 means no automatic retries."
                slotProps={{ htmlInput: { inputMode: 'numeric', min: 0, max: 10, step: 1 } }} required />
            </Box>
            <Typography variant="body2" color="text.secondary">Applies to newly created queue cycles; existing cycles retain their retry snapshot. Automatic retries follow worker eligibility rules. Manual Resend is a separate operator-controlled action.</Typography>
            <TextField fullWidth label="Reason for change" value={reason} onChange={event => setReason(event.target.value)} disabled={saving || confirm}
              helperText="Required for the policy audit trail (maximum 500 characters)." slotProps={{ htmlInput: { maxLength: 500 } }} required />
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>Policy version {policy.version}. Last updated {new Date(policy.updatedAt).toLocaleString()} by {policy.updatedBy}. Reason: {policy.reason}</Typography>
            <Alert severity="info">Company eligibility and the worker deployment allowlist are managed separately. This screen cannot enable a company or override the worker fence.</Alert>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button type="submit" variant="contained" disabled={!canSave}>Review change</Button>
              <Button disabled={saving || confirm} onClick={() => { setError(''); void load(); }}>Reload settings</Button>
            </Stack>
          </Stack>
        </CardContent></Card>
      ) : <Button onClick={() => { setError(''); void load(); }}>Reload settings</Button>}
      {showWorkerRecovery && <Card variant="outlined" component="section" aria-label="Worker recovery" sx={{ mt: 2 }}><CardContent>
        <Stack spacing={1} alignItems="flex-start">
          <Button variant="outlined" disabled={!workerRecoveryAvailable || recoveryBusy || !!recoveryConfirmation} onClick={() => void recoverWorker()} aria-describedby="worker-recovery-unavailable">Recover &amp; Restart Worker</Button>
          <Typography id="worker-recovery-unavailable" role="status" aria-live="polite" variant="body2" color="text.secondary">
            {workerRecoveryAvailable ? (recoveryStatus || 'Ready to check worker') : 'Worker recovery is unavailable. Contact your system administrator.'}
          </Typography>
        </Stack>
      </CardContent></Card>}
      <Dialog open={!!recoveryConfirmation} onClose={() => { if (!recoveryBusy) { setRecoveryConfirmation(''); setRecoveryStatus('Recovery cancelled'); } }}>
        <DialogTitle>Confirm verified worker shutdown</DialogTitle>
        <DialogContent>
          <Typography>Confirm only if you have verified that the worker supervisor is stopped, all previous owner processes and children have been reaped, and no overlapping deployment can restart them. The server checks process identity and PID absence; those checks alone cannot prove all descendants were reaped.</Typography>
          <TextField fullWidth required label="Shutdown verification evidence" value={shutdownEvidence}
            onChange={event => setShutdownEvidence(event.target.value)} disabled={recoveryBusy}
            helperText="Describe how shutdown and descendant reaping were verified. Maximum 500 characters on one line. Do not include secrets."
            slotProps={{ htmlInput: { maxLength: 500 } }} sx={{ mt: 2 }} />
        </DialogContent>
        <DialogActions>
          <Button disabled={recoveryBusy} onClick={() => { setRecoveryConfirmation(''); setRecoveryStatus('Recovery cancelled'); }}>Cancel</Button>
          <Button disabled={recoveryBusy || !shutdownEvidence.trim() || shutdownEvidence.length > 500 || /[\u0000-\u001f]/.test(shutdownEvidence)} onClick={() => void recoverWorker(true)}>I verified shutdown — recover and restart</Button>
        </DialogActions>
      </Dialog>
      <QueueMonitoring />
      <ConfirmDialog open={confirm} title="Update queue policy?" severity="info" confirmText="Save policy" loading={saving}
        message={`Change the global processing interval from ${policy ? formatInterval(policy.intervalMs) : ''} to ${formatInterval(intervalMs)} and maximum automatic retries from ${policy?.maxAutoRetry} to ${retries}? Reason: ${reason.trim()}`}
        onCancel={() => setConfirm(false)} onConfirm={() => { void save(); }} />
    </Box>
  );
}
