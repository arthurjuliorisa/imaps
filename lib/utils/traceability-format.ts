/**
 * Formatting helpers for persisted material traceability snapshots.
 *
 * Unlike the general quantity formatter, an unavailable audit value must stay
 * visibly unavailable rather than being rendered as zero.
 */
export function formatTraceabilityQty(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }

  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

export function formatTraceabilityRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }

  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}
