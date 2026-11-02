/** Labels are the existing WMS status projection's operational categories. */
export const WMS_INSW_STATUSES = ['Not queued', 'Queued', 'Processing', 'Failed',
  'Held / Delivery unknown', 'Succeeded', 'Unknown / unlinked'] as const;
export type WmsInswStatusFilter = typeof WMS_INSW_STATUSES[number];
