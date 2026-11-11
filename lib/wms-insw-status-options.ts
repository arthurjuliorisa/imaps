/** Labels are the existing WMS status projection's operational categories. */
export const WMS_INSW_STATUSES = ['Resolved', 'Not queued', 'Queued', 'Processing', 'Failed',
  'Held / Delivery unknown', 'Succeeded', 'Unknown / unlinked'] as const;
export type WmsInswStatusFilter = typeof WMS_INSW_STATUSES[number];

/** Display only: retain persisted/API filter values for existing consumers. */
export function wmsInswStatusLabel(status: WmsInswStatusFilter): string {
  return ({ Resolved: 'Resolved', 'Not queued': 'Not Queued', Queued: 'Waiting', Processing: 'Sending',
    Failed: 'Failed', 'Held / Delivery unknown': 'On Hold', Succeeded: 'Success',
    'Unknown / unlinked': 'On Hold' })[status];
}
