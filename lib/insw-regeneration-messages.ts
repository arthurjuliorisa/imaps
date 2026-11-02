export const REGENERATION_SUCCESS = 'INSW transmission queued successfully. It has not been sent yet.';
export const REGENERATION_INCONCLUSIVE = 'Regeneration could not be completed. Please check the transaction in INSW and try again, or contact an administrator.';
const duplicate = 'This transaction already has local INSW transmission history. Regeneration was cancelled.';

export function regenerationMessage(code: unknown): string {
  switch (code) {
    case 'INVALID_REQUEST': return 'Only a Reason is accepted for regeneration.';
    case 'INVALID_REASON': return 'Reason is required and must be 500 characters or fewer, without control characters.';
    case 'UNAUTHORIZED': return 'Please sign in before regenerating this transmission.';
    case 'INVALID_ORIGIN': return 'Please regenerate this transmission from the application.';
    case 'INVALID_ID': return 'Invalid WMS transaction. Please refresh and try again.';
    case 'FORBIDDEN': return 'You do not have permission to regenerate this transmission.';
    case 'NOT_FOUND': return 'This transaction was not found in your company scope.';
    case 'ADMISSION_DENIED': return 'Regeneration is unavailable for this company. Please contact an administrator.';
    case 'TRANSMISSION_HISTORY_EXISTS':
      return duplicate;
    case 'ORPHAN_DELIVERY_HISTORY': return 'Unlinked INSW transmission history exists. Please contact an administrator to reconcile it.';
    case 'LOCAL_HISTORY_OR_SOURCE_BLOCK': return 'This transaction has transmission history or an incomplete source. Please refresh and contact an administrator.';
    case 'BUSINESS_COMPLETION_REQUIRES_REVIEW': return 'Unresolved WMS processing failures exist. Please contact an administrator before regenerating.';
    case 'SOURCE_CHANGED': return 'This transaction changed during regeneration. Please refresh and try again.';
    default: return REGENERATION_INCONCLUSIVE;
  }
}
