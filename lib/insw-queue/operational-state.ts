export interface OperationalState {
  id: string; status: string; delivery_state: string; cycle: number; intent: string;
  retry_index: number; max_auto_retry_snapshot: number; hold_reason: string | null;
  error_message: string | null; queued_at: string; next_eligible_at: string;
  claimed_at: string | null; completed_at: string | null;
  attempt: { id: string; delivery_state: string; claimed_at: string; started_at: string | null; completed_at: string | null } | null;
  attempts_started?: number;
  resolve_eligible?: boolean;
  resolution?: AdminResolution | null;
  latest_log_id: string | null;
  provenance?: string | null;
  /** Read-only evidence from persisted queues; never a stored lifecycle change. */
  stable_reference_conflict?: boolean;
}
export function deliveryLabel(state: OperationalState | null | undefined) {
  if (!state) return 'Legacy DIRECT / unlinked history';
  if (state.status === 'READY') return state.retry_index > 0 ? 'READY — automatic retry pending' : 'READY — waiting';
  if (state.status === 'CLAIMED') return 'CLAIMED — in flight';
  if (state.status === 'HELD') return `HELD — investigate (${state.hold_reason || state.delivery_state})`;
  return `${state.status} — ${state.delivery_state}`;
}

export function provenanceLabel(value: unknown): string | null {
  switch (value) {
    case 'SIMULATED_REMOTE_REJECTION': return 'Simulated remote rejection (rehearsal)';
    case 'SIMULATED_TRANSPORT_FAULT': return 'Simulated transport fault (rehearsal)';
    case 'REAL_INSW_TEST_RESPONSE': return 'Actual INSW TEST response';
    default: return null;
  }
}

export type AdminResolution = { resolved_by: string; resolved_at: string; notes: string };
/** Only stable terminal failures/holds. In-flight gate/attempt checks are server authoritative. */
export function canResolveQueue(q: { status: string; owner_token?: unknown; lease_until?: unknown; resolve_eligible?: boolean; resolution?: AdminResolution | null } | null | undefined): boolean {
  return !!q && !q.resolution && ['FAILED', 'HELD'].includes(q.status)
    && (q.resolve_eligible === true || q.owner_token === null && q.lease_until === null);
}
