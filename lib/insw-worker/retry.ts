import { integer } from '../insw-queue/contracts';
import { Classification } from './classification';

// Decision contract only: never writes queue state. All safety/rollout evidence
// must be supplied by a future reviewed dispatcher; none is inferred from expiry.
export function classifiedRetryDisposition(input: {
  classification: Classification;
  delivery: 'NOT_STARTED' | 'POSSIBLY_STARTED' | 'KNOWN_FAILURE' | 'KNOWN_SUCCESS';
  retryIndex: number; maxAutoRetrySnapshot: number;
  clientApprovedAmbiguousRetry: boolean;
  exclusiveStreamProven: boolean;
  priorInvocationEnded: boolean;
  outcomeDurablyRecorded: boolean;
}): 'RETRY_TO_TAIL' | 'HOLD' | 'STOP' {
  integer(input.retryIndex, 'retry index', 0, 2147483646);
  integer(input.maxAutoRetrySnapshot, 'maximum retries', 0, 2147483646);
  if (input.delivery === 'KNOWN_SUCCESS' || input.classification.kind === 'KNOWN_REMOTE_SUCCESS') return 'STOP';
  if (input.classification.kind === 'DUPLICATE_POSSIBILITY') return 'HOLD';
  if (input.classification.kind === 'PERMANENT_FAILURE') return 'STOP';
  if (input.classification.kind !== 'TRANSIENT_FAILURE' || !input.classification.retryCandidate) return 'HOLD';
  if (!input.exclusiveStreamProven || !input.priorInvocationEnded || !input.outcomeDurablyRecorded) return 'HOLD';
  if (input.delivery === 'POSSIBLY_STARTED' && !input.clientApprovedAmbiguousRetry) return 'HOLD';
  if (!['POSSIBLY_STARTED', 'KNOWN_FAILURE'].includes(input.delivery)) return 'HOLD';
  return input.retryIndex < input.maxAutoRetrySnapshot ? 'RETRY_TO_TAIL' : 'STOP';
}
