'use client';

import { useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import dayjs from 'dayjs';
import type { AdminResolution } from '@/lib/insw-queue/operational-state';

export const RESOLUTION_CONFIRMATION = 'This records an administrative resolution only. It does not confirm successful receipt by INSW and does not resend the transaction.';

export function AdminResolve({ queueId, eligible, resolution, detail = false, onResolved }: {
  queueId?: string; eligible?: boolean; resolution?: AdminResolution | null; detail?: boolean;
  onResolved: () => Promise<unknown>;
}) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false), [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  if (resolution) return detail ? <Box sx={{ overflowWrap: 'anywhere' }}>
    <Typography variant="subtitle2">Resolved By</Typography><Typography variant="body2">{resolution.resolved_by}</Typography>
    <Typography variant="subtitle2">Resolved At</Typography><Typography variant="body2">{dayjs(resolution.resolved_at).format('DD-MMMM-YY HH:mm:ss')}</Typography>
    <Typography variant="subtitle2">Resolution Notes</Typography><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{resolution.notes}</Typography>
  </Box> : null;
  if (session?.user?.role !== 'ADMIN' || !queueId || !eligible) return null;
  return <>
    <Button size="small" onClick={() => { setError(null); setNotes(''); setOpen(true); }}>Resolve</Button>
    <Dialog open={open} onClose={() => { if (!submitting.current) setOpen(false); }} maxWidth="sm" fullWidth aria-labelledby="admin-resolve-title" aria-describedby="admin-resolve-confirmation">
      <DialogTitle id="admin-resolve-title">Resolve transmission</DialogTitle>
      <DialogContent>
        <Typography variant="body2">Exact queue / cycle: {queueId}</Typography>
        <Alert severity="warning" id="admin-resolve-confirmation" sx={{ my: 2 }}>{RESOLUTION_CONFIRMATION}</Alert>
        <TextField autoFocus fullWidth required multiline minRows={3} label="Resolution Notes" value={notes} disabled={busy}
          slotProps={{ htmlInput: { maxLength: 2000 } }} onChange={e => setNotes(e.target.value)} helperText={`${notes.length}/2000`} />
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="contained" disabled={busy || !notes.trim() || notes.length > 2000} onClick={async () => {
          if (submitting.current) return;
          submitting.current = true; setBusy(true); setError(null);
          try {
            const response = await fetch(`/api/insw/queues/${encodeURIComponent(queueId)}/resolve`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }),
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Resolution could not be recorded.');
            setOpen(false);
            await onResolved();
          } catch (e) { setError(e instanceof Error ? e.message : 'Resolution could not be recorded.'); }
          finally { submitting.current = false; setBusy(false); }
        }}>{busy ? 'Saving…' : 'Confirm resolution'}</Button>
      </DialogActions>
    </Dialog>
  </>;
}
