'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material';
import type { QueueMonitoring as Observation } from '@/lib/insw-queue/monitoring';

const metrics = [
  ['READY', 'Waiting'], ['CLAIMED', 'Processing'], ['HELD', 'Held / investigate'],
  ['FAILED', 'Failed'], ['REMOTE_SUCCEEDED', 'Remote succeeded / finalization pending'],
  ['SUCCEEDED', 'Succeeded'], ['SUPERSEDED', 'Retired'],
] as const;

const formatTime = (value: string) => `${new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' })} WIB`;

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
  return <Stack spacing={3} sx={{ mt: 3, minWidth: 0 }}>
    <Card variant="outlined" component="section" aria-labelledby="worker-monitoring-heading">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1}>
            <Box>
              <Typography id="worker-monitoring-heading" variant="h6" component="h2">Worker Monitoring</Typography>
              <Typography variant="body2" color="text.secondary">Read-only database observation · refreshes every 30 seconds while visible.</Typography>
            </Box>
            <Button variant="outlined" disabled={loading} onClick={() => reload.current?.()} sx={{ flexShrink: 0, minHeight: 40 }}>Refresh monitoring</Button>
          </Stack>
          {loading && <Stack direction="row" spacing={1} alignItems="center" role="status" aria-label="Refreshing queue monitoring">
            <CircularProgress size={18} /><Typography variant="body2" color="text.secondary">Refreshing observation…</Typography>
          </Stack>}
          {error && <Alert severity="warning" role="status">{error}</Alert>}
          {!observation && !loading && <Alert severity="info">Monitoring unavailable. Counts and worker state are unknown.</Alert>}
          {observation && <>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {error ? 'Last observation (stale)' : 'As of'}: <Box component="time" dateTime={observation.observedAt}>{formatTime(observation.observedAt)}</Box> · Queue scope: company {observation.companyCode}.
            </Typography>
            <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2, m: 0 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography component="dt" variant="body2" color="text.secondary">Global dispatcher ownership</Typography>
                <Typography component="dd" variant="subtitle2" sx={{ m: 0, mt: 0.5 }}>{observation.worker.status}</Typography>
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography component="dt" variant="body2" color="text.secondary">Database activity marker</Typography>
                <Typography component="dd" variant="subtitle2" sx={{ m: 0, mt: 0.5 }}>{observation.worker.busy ? 'Busy marker recorded' : 'Idle marker (no busy attempt recorded)'}</Typography>
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography component="dt" variant="body2" color="text.secondary">Last global transmission start</Typography>
                <Typography component="dd" variant="subtitle2" sx={{ m: 0, mt: 0.5 }}>{observation.worker.lastTransmissionStartedAt ? formatTime(observation.worker.lastTransmissionStartedAt) : 'Not recorded'}</Typography>
              </Box>
            </Box>
          </>}
          <Alert severity="info">No verified heartbeat available. Ownership and activity markers do not verify process health or prove that a worker has stopped. A busy marker does not prove an active HTTP request.</Alert>
        </Stack>
      </CardContent>
    </Card>
    {observation && <>
      <Card variant="outlined" component="section" aria-labelledby="queue-summary-heading">
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Box>
              <Typography id="queue-summary-heading" variant="h6" component="h2">Queue Summary</Typography>
              <Typography variant="body2" color="text.secondary">All persisted cycles in this company, including historical and superseded cycles. Each cycle is counted once.</Typography>
            </Box>
            <Box component="dl" aria-label="Queue status counts" sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5, m: 0 }}>
              {metrics.map(([status, label]) => <Box key={status} data-testid={`queue-metric-${status}`} sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, p: 2, border: 1, borderColor: 'divider', borderRadius: 1, borderTop: 3, borderTopColor: status === 'HELD' ? 'warning.main' : status === 'FAILED' ? 'error.main' : 'divider' }}>
                <Box component="dt" sx={{ mb: 1.5 }}>
                  <Typography component="span" variant="body2" sx={{ display: 'block', fontWeight: 600 }}>{label}</Typography>
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere', mt: 0.5 }}>{status}</Typography>
                </Box>
                <Typography component="dd" variant="h4" sx={{ m: 0, mt: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{observation.counts[status].toLocaleString()}</Typography>
              </Box>)}
            </Box>
            <Typography variant="caption" color="text.secondary">Processing means CLAIMED; it does not prove an active HTTP request. HELD may represent an uncertain outcome or another investigation hold.</Typography>
          </Stack>
        </CardContent>
      </Card>
      <Card variant="outlined" component="section" aria-labelledby="queue-issues-heading">
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Box>
              <Typography id="queue-issues-heading" variant="h6" component="h2">Recent Recorded Queue/Worker Issues</Typography>
              <Typography variant="body2" color="text.secondary">Incomplete local queue-evidence subset · up to 20 records from cycles queued in the last 7 days, newest queued first.</Typography>
            </Box>
            {observation.failures.length === 0 ? <Box sx={{ p: { xs: 2, sm: 3 }, textAlign: 'center', border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="subtitle1" component="h3" fontWeight={600}>No recorded local issues in the last 7 days</Typography>
              <Typography variant="body2" color="text.secondary">No matching evidence in this limited queue-cycle view. This does not verify worker health.</Typography>
            </Box> : <Box component="ul" aria-label="Recorded local queue issues" sx={{ m: 0, p: 0, listStyle: 'none' }}>
              {observation.failures.map(failure => <Box component="li" key={failure.queueId} sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '180px minmax(0, 1fr) minmax(0, 2fr)' }, gap: { xs: 1, md: 2 }, py: 2, borderTop: 1, borderColor: 'divider', overflowWrap: 'anywhere' }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">Evidence time (WIB)</Typography>
                  <Typography variant="body2" component="time" dateTime={failure.recordedAt}>{formatTime(failure.recordedAt)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">Category</Typography>
                  <Typography variant="body2" fontWeight={600}>{failure.category}</Typography>
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary" display="block">Summary / queue reference</Typography>
                  <Typography variant="body2">{failure.message}</Typography>
                  <Typography variant="caption" color="text.secondary">Queue {failure.queueId} · Source: {failure.source}</Typography>
                </Box>
              </Box>)}
            </Box>}
            <Typography variant="caption" color="text.secondary">Includes local preparation failures and local finalization markers only. Provider business rejections, transport ambiguity and remote unknown outcomes are excluded. This is not comprehensive PM2/process/finalizer logging; exceptions recorded only in process logs are unavailable here.</Typography>
          </Stack>
        </CardContent>
      </Card>
    </>}
  </Stack>;
}
