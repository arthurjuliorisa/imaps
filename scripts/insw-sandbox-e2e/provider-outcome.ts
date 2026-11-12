import type { Observation } from './database';
export type BusinessOutcome = 'ACCEPTED' | 'EXPECTED_BUSINESS_REJECTION' | 'UNEXPECTED_BUSINESS_REJECTION' | 'UNKNOWN';
/** Uses the worker's whitelisted classification evidence, never HTTP alone.
 * MISSING_ITEM_VALIDATION proves code=02 + missing-item response (classification.ts).
 */
export function providerOutcome(logs: Observation['logs']): BusinessOutcome {
  if (!logs.length) return 'UNKNOWN';
  if (logs.every(l => l.classification === 'KNOWN_REMOTE_SUCCESS' && l.provider_status === true
    && l.insw_status === 'SUCCESS' && l.http_code !== null && l.http_code >= 200 && l.http_code < 300)) return 'ACCEPTED';
  if (logs.every(l => l.classification === 'PERMANENT_FAILURE' && l.reason_code === 'MISSING_ITEM_VALIDATION'
    && l.http_code === 400 && l.provider_status === false)) return 'EXPECTED_BUSINESS_REJECTION';
  // No other reviewed business-rejection template exists in the current worker contract.
  return 'UNKNOWN';
}
