import { prisma } from '@/lib/prisma';

export interface ReportingUomMapping {
  wms_uom: string;
  insw_uom: string;
}

/** Reporting only: uppercase identity, no trimming or WMS fallback. */
export function createReportingUomLookup(rows: ReportingUomMapping[]) {
  const mappings = new Map<string, string | null>();
  for (const row of rows) {
    if (!row.wms_uom.trim()) continue;
    const key = row.wms_uom.toUpperCase();
    mappings.set(key, mappings.has(key) ? null : (row.insw_uom.trim() ? row.insw_uom : null));
  }
  return (source: unknown): string | null => {
    if (typeof source !== 'string' || !source.trim()) return null;
    return mappings.get(source.toUpperCase()) ?? null;
  };
}

/** One current global read per nonempty request; failures propagate to the caller. */
export async function loadReportingUomLookup(rows: readonly unknown[]) {
  const mappings = rows.length ? await prisma.insw_uom_mapping.findMany({
    where: { is_active: true },
    select: { wms_uom: true, insw_uom: true },
  }) : [];
  return createReportingUomLookup(mappings);
}
