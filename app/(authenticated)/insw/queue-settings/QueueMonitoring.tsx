'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material';
import type { QueueMonitoring as Observation } from '@/lib/insw-queue/monitoring';

const metrics = [
  ['READY', 'Waiting'], ['CLAIMED', 'Processing (claimed)'], ['HELD', 'Held / investigate'],
  ['FAILED', 'Finished — failed'], ['REMOTE_SUCCEEDED', 'Remote success / local finalization pending'],
  ['SUCCEEDED', 'Finished — succeeded'], ['SUPERSEDED', 'Retired'],
] as const;

export default function QueueMonitoring() {
  const [observation, setObservation] = useState<Observation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useRef<(() => void) | null>(null);
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let requestTimeout: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (disposed || inFlight || document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      inFlight = true; setLoading(true);
      controller = new AbortController();
      // Bound hung requests as well as the polling cadence.
      requestTimeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const response = await fetch('/api/insw/queue-settings/monitoring', { cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load queue monitoring.');
        if (!disposed) { setObservation(result.data); setError(''); }
      } catch {
        if (!disposed) setError('Monitoring refresh failed. The last observation is stale; current state is unknown.');
      } finally {
        clearTimeout(requestTimeout); inFlight = false;
        if (!disposed) {
          setLoading(false);
          if (document.visibilityState === 'visible') timer = setTimeout(() => { void poll(); }, 30000);
        }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') void poll();
    };
    reload.current = () => { void poll(); };
    document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => {
      disposed = true; reload.current = null; clearTimeout(timer); clearTimeout(requestTimeout); controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return <Stack spacing={2} sx={{ mt: 3 }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
      <Typography variant="h6" component="h2">Queue monitoring</Typography>
      <Button disabled={loading} onClick={() => reload.current?.()}>Refresh monitoring</Button>
    </Stack>
    <Typography variant="body2" color="text.secondary">Read-only database observation. Refreshes every 30 seconds while this page is visible.</Typography>
    {loading && <Box role="status" aria-label="Refreshing queue monitoring"><CircularProgress size={20} /></Box>}
    {error && <Alert severity="warning" role="status">{error}</Alert>}
    {!observation && !loading && <Typography>Monitoring unavailable. Counts and worker state are unknown.</Typography>}
    {observation && <>
      <Typography variant="body2">{error ? 'Last observation (stale)' : 'As of'}: {new Date(observation.observedAt).toLocaleString()}. Queue scope: company {observation.companyCode}.</Typography>
      <Card><CardContent><Stack spacing={1}>
        <Typography variant="h6" component="h3">Worker status</Typography>
        <Typography>{observation.worker.status}</Typography>
        <Typography variant="body2">Global dispatcher ownership: {observation.worker.ownershipPresent ? 'present' : 'not recorded'}. Database activity marker: {observation.worker.busy ? 'Busy marker recorded' : 'Idle marker (no busy attempt recorded)'}.</Typography>
        <Typography variant="body2">Last global transmission start: {observation.worker.lastTransmissionStartedAt ? new Date(observation.worker.lastTransmissionStartedAt).toLocaleString() : 'Not recorded'}.</Typography>
        <Alert severity="info">No verified heartbeat available. Ownership and activity markers do not verify process health or prove that a worker has stopped.</Alert>
      </Stack></CardContent></Card>
      <Card><CardContent><Stack spacing={1}>
        <Typography variant="h6" component="h3">Queue summary</Typography>
        <Typography variant="body2">All persisted cycles in this company, including historical cycles. Each cycle is counted once. Processing means CLAIMED; it does not prove an active HTTP request. HELD may represent an uncertain outcome or another investigation hold.</Typography>
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr auto', sm: '1fr auto' }, gap: 1, m: 0 }}>
          {metrics.map(([status, label]) => <Box key={status} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="body2">{label} ({status})</Typography>
            <Typography component="dd" sx={{ m: 0, fontWeight: 'bold' }}>{observation.counts[status].toLocaleString()}</Typography>
          </Box>)}
        </Box>
      </Stack></CardContent></Card>
      <Card><CardContent><Stack spacing={1}>
        <Typography variant="h6" component="h3">Recorded worker/attempt failures</Typography>
        <Typography variant="body2">Up to 20 current local preparation failures or local finalization markers from cycles queued in the last seven days, newest queued first. Source: persisted queue cycle evidence; this is not a complete worker error history. Provider business rejections and external unknown outcomes are excluded. Infrastructure and finalizer exceptions recorded only in process logs are unavailable here.</Typography>
        {observation.failures.length === 0 ? <Typography variant="body2">No matching local failure records in this window.</Typography> : observation.failures.map(failure => <Box key={failure.queueId} sx={{ borderTop: 1, borderColor: 'divider', pt: 1, overflowWrap: 'anywhere' }}>
          <Typography variant="subtitle2">{failure.category}</Typography>
          <Typography variant="body2">{failure.message}</Typography>
          <Typography variant="caption" color="text.secondary">Evidence time: {new Date(failure.recordedAt).toLocaleString()} · Queue {failure.queueId} · Source: {failure.source}</Typography>
        </Box>)}
      </Stack></CardContent></Card>
    </>}
  </Stack>;
}
