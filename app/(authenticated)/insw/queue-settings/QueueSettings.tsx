'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { ConfirmDialog } from '@/app/components/ConfirmDialog';
import { useToast } from '@/app/components/ToastProvider';
import type { intervalProjection } from '@/lib/insw-queue/interval-settings';

type Settings = ReturnType<typeof intervalProjection>;
const formatInterval = (ms: number) => `${ms / 1000} seconds (${ms.toLocaleString('en-US')} ms)`;

export default function QueueSettings() {
  const toast = useToast();
  const [policy, setPolicy] = useState<Settings | null>(null);
  const [interval, setInterval] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const apply = (data: Settings) => {
    setPolicy(data); setInterval(String(data.intervalMs)); setReason('');
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
  const validReason = reason.trim().length > 0 && reason.trim().length <= 500 && !/[\u0000-\u001f]/.test(reason.trim());
  const canSave = !!policy && validInterval && validReason && intervalMs !== policy.intervalMs && !loading && !saving;
  const save = async () => {
    if (!canSave || !policy) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/insw/queue-settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMs, expectedVersion: policy.version, reason: reason.trim() }),
      });
      const result = await response.json();
      if (response.status === 409) {
        const message = 'Another administrator changed the policy. Current settings have been reloaded; review and enter your change again.';
        setError(message); toast.error(message);
        await load();
        return;
      }
      if (!response.ok) throw new Error(result.error || 'Unable to save queue settings');
      apply(result.data); toast.success('Queue processing interval updated');
    } catch (err) {
      const message = (err as Error).message;
      setError(message); toast.error(message);
    } finally { setSaving(false); setConfirm(false); }
  };

  return (
    <Box sx={{ maxWidth: 800 }}>
      <Typography variant="h5" component="h1" color="primary" fontWeight="bold" sx={{ mb: 2 }}>INSW Queue Settings</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? <Box role="status" aria-label="Loading queue settings"><CircularProgress /></Box> : policy ? (
        <Card><CardContent>
          <Stack spacing={2} component="form" onSubmit={event => { event.preventDefault(); if (canSave) setConfirm(true); }}>
            <Typography>Persisted processing interval: <strong>{formatInterval(policy.intervalMs)}</strong></Typography>
            <Typography>Effective minimum spacing: <strong>{formatInterval(Math.max(3600, policy.intervalMs))}</strong></Typography>
            <Typography variant="body2">Hard minimum: 3.6 seconds (3,600 ms) between processing starts globally. This setting may increase that spacing. Queue conditions and provider response times can add delays; changes take effect when the worker next reads policy.</Typography>
            {policy.intervalMs < 3600 && <Alert severity="info">The persisted interval is below the hard minimum. Effective start spacing remains at least 3,600 ms.</Alert>}
            <TextField label="Processing interval (milliseconds)" value={interval} onChange={event => setInterval(event.target.value)} disabled={saving || confirm}
              error={!validInterval} helperText={validInterval ? formatInterval(intervalMs) : 'Enter a whole number from 3,600 to 2,147,483,647 ms.'}
              slotProps={{ htmlInput: { inputMode: 'numeric', min: 3600, max: 2147483647, step: 1 } }} required />
            <TextField label="Reason for change" value={reason} onChange={event => setReason(event.target.value)} disabled={saving || confirm}
              helperText="Required for the policy audit trail (maximum 500 characters)." slotProps={{ htmlInput: { maxLength: 500 } }} required />
            <Typography variant="body2" color="text.secondary">Policy version {policy.version}. Last updated {new Date(policy.updatedAt).toLocaleString()} by {policy.updatedBy}. Reason: {policy.reason}</Typography>
            <Alert severity="info">Company eligibility and the worker deployment allowlist are managed separately. This screen cannot enable a company or override the worker fence.</Alert>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button type="submit" variant="contained" disabled={!canSave}>Review change</Button>
              <Button disabled={saving || confirm} onClick={() => { setError(''); void load(); }}>Reload settings</Button>
            </Stack>
          </Stack>
        </CardContent></Card>
      ) : <Button onClick={() => { setError(''); void load(); }}>Reload settings</Button>}
      <ConfirmDialog open={confirm} title="Update processing interval?" severity="info" confirmText="Save interval" loading={saving}
        message={`Change the global processing interval from ${policy ? formatInterval(policy.intervalMs) : ''} to ${formatInterval(intervalMs)}? Reason: ${reason.trim()}`}
        onCancel={() => setConfirm(false)} onConfirm={() => { void save(); }} />
    </Box>
  );
}
