import type { INSWIntegrationService } from '../services/insw-integration.service';
import type { RequestPrimitive } from './transport';

/**
 * Non-active transaction transport seam, not a runnable production adapter.
 * The service is supplied by the caller (eventually the existing company
 * factory); importing this module loads no app DB, credentials or HTTP client.
 * Applies to the transaction endpoint only, including reversal activities.
 * Saldo and final registration need separate dependency/finalization adapters.
 * Do not wire this into the isolated loop: its persistence is synthetic-only.
 */
export function createTransactionRequest(
  service: Pick<INSWIntegrationService, 'requestFrozenTransaction'>,
): RequestPrimitive {
  return (body, signal) => service.requestFrozenTransaction(body, signal);
}
