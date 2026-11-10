import type { OperationalState } from './insw-queue/operational-state';
import { provenanceLabel } from './insw-queue/operational-state';

type Result = { label: string; explanation: string; color: 'success' | 'error' | 'warning' | 'info' };
export function transmissionResult(outcome: string | null | undefined, _delivery?: string, _provenance?: unknown): Result {
  // Recorded Result belongs to this stored log, never a later queue or
  // administrative outcome. Provenance is shown independently by callers.
  const evidenceNote = typeof _provenance === 'string' && _provenance.startsWith('SIMULATED_')
    ? 'Simulated outcome; this does not confirm receipt by INSW.'
    : _provenance === 'REAL_INSW_TEST_RESPONSE' ? 'Actual TEST outcome; this does not confirm production receipt.' : null;
  if (evidenceNote) return { label: outcome === 'SUCCESS' ? 'Success' : outcome === 'FAILED' ? 'Failed' : 'Not Recorded', explanation: evidenceNote, color: 'info' };
  if (outcome === 'SUCCESS') return { label: 'Success', explanation: 'A successful response is recorded for this attempt.', color: 'success' };
  if (outcome === 'FAILED') return { label: 'Failed', explanation: 'A failed attempt is recorded; remote receipt may still need verification.', color: 'error' };
  return { label: 'Not Recorded', explanation: 'No definitive attempt result is recorded. This does not prove a POST never started.', color: 'info' };
}

export function recordedResult(log: { insw_status: string; current_queue?: OperationalState | null }) {
  const q = log.current_queue;
  if (log.insw_status === 'NO_ATTEMPT_LOG' && q && !q.stable_reference_conflict && ['READY', 'CLAIMED'].includes(q.status) && q.retry_index === 0
    && q.delivery_state !== 'KNOWN_SUCCESS' && !q.attempt?.completed_at && (q.status === 'CLAIMED' || !q.attempt && !q.attempts_started)) return { label: '—', explanation: 'No new recorded attempt.', color: 'info' as const };
  return transmissionResult(log.insw_status);
}

export function transmissionStatus(log: {
  id?: string; current_queue?: OperationalState | null; insw_status: string; sent_at?: string | null;
  created_at?: string; can_resend?: boolean; metadata?: { rehearsalProvenance?: string } | null;
  queue_attempt_id?: string | null;
  attempt_history?: { entries: { id: string; provenance: string | null }[] } | null;
}) {
  const q = log.current_queue;
  // Only attach provenance to the corresponding attempt; historical fixtures
  // must never overwrite the latest delivery status.
  const latestProvenance = q?.provenance ?? (q?.attempt
    ? log.attempt_history?.entries.find(entry => entry.id === q.attempt?.id)?.provenance
      ?? (q.attempt.id === log.queue_attempt_id ? log.metadata?.rehearsalProvenance : undefined)
    : !q || q.latest_log_id === log.id ? log.metadata?.rehearsalProvenance : undefined);
  let result = q ? transmissionResult(undefined, q.delivery_state, latestProvenance)
    : transmissionResult(log.insw_status, undefined, latestProvenance);
  if (q?.stable_reference_conflict) result = { label: 'On Hold', explanation: 'Conflicting queue identities share this WMS reference. Ask support to reconcile the associations before sending again.', color: 'warning' };
  else if (q?.status === 'READY') result = { label: q.retry_index > 0 ? 'Retry' : 'Waiting', explanation: 'Waiting to send to INSW. No action is needed.', color: 'info' };
  else if (q?.status === 'CLAIMED') result = { label: 'Sending', explanation: 'Transmission is in progress. Wait for the result.', color: 'info' };
  else if (q?.status === 'HELD' || q?.status === 'REMOTE_SUCCEEDED') {
    result = { label: 'On Hold', explanation: q.error_message === 'MISSING_ITEM_VALIDATION'
      ? 'INSW reported missing item data. Review the item setup; ordinary Manual Resend is unavailable.'
      : q.delivery_state === 'KNOWN_SUCCESS'
      ? 'INSW confirmed receipt. Local recording or finalization needs review; do not send again.'
      : 'Receipt or local processing needs verification. Ask support to confirm receipt before sending again.', color: 'warning' };
  } else if (q?.status === 'FAILED') result = { label: 'Failed', explanation: 'This delivery cycle stopped. Review the recorded cause.', color: 'error' };
  else if (q?.status === 'SUCCEEDED') result = { label: 'Success', explanation: 'A successful response is recorded for the current cycle.', color: 'success' };
  else if (!q && !['SUCCESS', 'FAILED'].includes(log.insw_status)) result = { label: 'On Hold', explanation: 'Historical outcome requires review; no new delivery is authorized.', color: 'warning' };
  if (typeof latestProvenance === 'string' && latestProvenance.startsWith('SIMULATED_')) result = { ...result, explanation: `${q?.stable_reference_conflict ? result.explanation + ' ' : ''}Simulated lifecycle state; this does not confirm receipt by INSW.`, color: 'info' };
  else if (latestProvenance === 'REAL_INSW_TEST_RESPONSE') result = { ...result, explanation: `${result.explanation} This TEST outcome does not confirm production receipt.` };
  if (result.label === 'Failed' && log.can_resend === true) result = { ...result, explanation: `${result.explanation} Review the error before using Resend.` };
  return { ...result, time: q ? q.completed_at || q.attempt?.completed_at || q.attempt?.started_at || q.claimed_at || q.queued_at : log.sent_at || log.created_at,
    provenance: provenanceLabel(latestProvenance) };
}

export function transmissionError(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^data barang [A-Za-z0-9._/-]{1,100} tidak ada$/.test(value)
    || /^Atas nomor dokumen kegiatan [A-Za-z0-9._/ -]{1,500} sudah pernah dikirim\.?$/.test(value)
    || value === 'API rate limit exceeded') return value;
  if (/timeout|timed out|ETIMEDOUT/i.test(value)) return 'The connection timed out. Receipt by INSW may need confirmation.';
  if (/ECONNREFUSED|ENOTFOUND|network|socket/i.test(value)) return 'A connection problem interrupted transmission.';
  if (/validation|invalid|required|missing field/i.test(value)) return 'Transaction data did not pass validation. Ask support to review the recorded error.';
  if (/401|403|unauthori[sz]ed|forbidden/i.test(value)) return 'INSW access was denied. Ask support to check the connection settings.';
  return 'Transmission could not be completed. Review the recorded error with support.';
}
