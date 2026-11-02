export interface OperationalState {
  id: string; status: string; delivery_state: string; cycle: number; intent: string;
  retry_index: number; max_auto_retry_snapshot: number; hold_reason: string | null;
  error_message: string | null; queued_at: string; next_eligible_at: string;
  claimed_at: string | null; completed_at: string | null;
  attempt: { id: string; delivery_state: string; claimed_at: string; started_at: string | null; completed_at: string | null } | null;
  attempts_started?: number;
  latest_log_id: string | null;
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
