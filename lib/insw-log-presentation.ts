import type { OperationalState } from './insw-queue/operational-state';
import { provenanceLabel } from './insw-queue/operational-state';

type Result = { label: string; explanation: string; color: 'success' | 'error' | 'warning' | 'info' };
export function transmissionResult(outcome: string | null | undefined, delivery?: string, provenance?: unknown): Result {
  if (typeof provenance === 'string' && provenance.startsWith('SIMULATED_')) {
    return { label: 'Rehearsal', explanation: 'Simulated result; this does not confirm receipt by INSW.', color: 'info' };
  }
  if (provenance === 'REAL_INSW_TEST_RESPONSE') {
    const result = outcome === 'SUCCESS' || delivery === 'KNOWN_SUCCESS' ? 'Test transmission succeeded.'
      : outcome === 'FAILED' || delivery === 'KNOWN_FAILURE' ? 'Test transmission failed.' : 'Test receipt is unconfirmed.';
    return { label: 'INSW Test Result', explanation: `${result} This does not confirm production receipt.`, color: 'info' };
  }
  if (delivery === 'KNOWN_SUCCESS' || outcome === 'SUCCESS') return { label: 'Sent Successfully', explanation: 'INSW confirmed receipt.', color: 'success' };
  if (delivery === 'POSSIBLY_STARTED' || delivery === 'DELIVERY_UNKNOWN') return { label: 'Delivery Uncertain', explanation: 'INSW may have received this transaction. Ask support to confirm receipt before sending again.', color: 'warning' };
  if (outcome === 'PENDING_RESOLVED') return { label: 'Resolved by Resend', explanation: 'A later transmission succeeded.', color: 'success' };
  if (delivery === 'KNOWN_FAILURE' || outcome === 'FAILED') return { label: 'Failed', explanation: 'Transmission did not succeed.', color: 'error' };
  return { label: 'Unknown', explanation: 'Receipt by INSW has not been confirmed.', color: 'info' };
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
  const latestProvenance = q?.attempt
    ? log.attempt_history?.entries.find(entry => entry.id === q.attempt?.id)?.provenance
      ?? (q.attempt.id === log.queue_attempt_id ? log.metadata?.rehearsalProvenance : undefined)
    : !q || q.latest_log_id === log.id ? log.metadata?.rehearsalProvenance : undefined;
  let result = q ? transmissionResult(undefined, q.delivery_state, latestProvenance)
    : transmissionResult(log.insw_status, undefined, latestProvenance);
  if (q?.status === 'READY') result = { label: 'Queued', explanation: 'Waiting to send to INSW. No action is needed.', color: 'info' };
  else if (q?.status === 'CLAIMED') result = { label: 'Sending', explanation: 'Transmission is in progress. Wait for the result.', color: 'info' };
  else if (q?.status === 'HELD') {
    result = q.delivery_state === 'KNOWN_SUCCESS'
      ? { label: 'Received — Review Needed', explanation: 'INSW confirmed receipt. Ask support to complete local processing; do not send again.', color: 'warning' }
      : q.hold_reason === 'DELIVERY_UNKNOWN' || q.delivery_state === 'POSSIBLY_STARTED'
        ? transmissionResult(undefined, 'DELIVERY_UNKNOWN')
        : { label: 'On Hold', explanation: 'Processing is paused. Ask support to review before sending again.', color: 'warning' };
  } else if (q?.status === 'FAILED') result = transmissionResult('FAILED', q.delivery_state, latestProvenance);
  else if (q?.status === 'SUCCEEDED') result = transmissionResult('SUCCESS', q.delivery_state, latestProvenance);
  if (typeof latestProvenance === 'string' && latestProvenance.startsWith('SIMULATED_')) {
    result = transmissionResult(undefined, undefined, latestProvenance);
  }
  if (result.label === 'Failed' && log.can_resend === true) result = { ...result, explanation: `${result.explanation} Review the error before using Resend.` };
  return { ...result, time: q ? q.completed_at || q.attempt?.completed_at || q.attempt?.started_at || q.claimed_at || q.queued_at : log.sent_at || log.created_at,
    provenance: provenanceLabel(latestProvenance) };
}

export function transmissionError(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/timeout|timed out|ETIMEDOUT/i.test(value)) return 'The connection timed out. Receipt by INSW may need confirmation.';
  if (/ECONNREFUSED|ENOTFOUND|network|socket/i.test(value)) return 'A connection problem interrupted transmission.';
  if (/validation|invalid|required|missing field/i.test(value)) return 'Transaction data did not pass validation. Ask support to review the recorded error.';
  if (/401|403|unauthori[sz]ed|forbidden/i.test(value)) return 'INSW access was denied. Ask support to check the connection settings.';
  return 'Transmission could not be completed. Review the recorded error with support.';
}
