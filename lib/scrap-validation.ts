export const SCRAP_CURRENCIES = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'] as const;

export type ScrapCurrency = (typeof SCRAP_CURRENCIES)[number];

export interface ScrapMasterIdentity {
  scrap_code: string;
  scrap_name: string;
  uom: string;
  is_active: boolean;
  deleted_at: Date | null;
}

export interface ScrapIdentityInput {
  scrapCode: string;
  scrapName: string;
  uom: string;
}

/** Codes and identity fields are case-sensitive in iMAPS; surrounding whitespace is not significant. */
export function normalizeScrapText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isScrapCurrency(value: string): value is ScrapCurrency {
  return (SCRAP_CURRENCIES as readonly string[]).includes(value);
}

export function validateScrapMasterIdentity(
  master: ScrapMasterIdentity | undefined,
  input: ScrapIdentityInput
): string[] {
  if (!master) {
    return [`Scrap Code '${input.scrapCode}' was not found for your company`];
  }

  const errors: string[] = [];
  if (master.deleted_at) errors.push(`Scrap Code '${input.scrapCode}' has been deleted`);
  if (!master.is_active) errors.push(`Scrap Code '${input.scrapCode}' is inactive`);
  if (normalizeScrapText(input.scrapName) !== normalizeScrapText(master.scrap_name)) {
    errors.push(`Scrap Name must match '${master.scrap_name}' for Scrap Code '${input.scrapCode}'`);
  }
  if (normalizeScrapText(input.uom) !== normalizeScrapText(master.uom)) {
    errors.push(`UOM must match '${master.uom}' for Scrap Code '${input.scrapCode}'`);
  }
  return errors;
}

export function utcToday(now = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function normalizeScrapDate(value: unknown): Date | null {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
      return null;
    }
    return parsed;
  }
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}

export function validateScrapNumbers(qty: unknown, amount: unknown): string[] {
  const errors: string[] = [];
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
    errors.push('Quantity must be a finite number greater than 0');
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    errors.push('Amount must be a finite non-negative number');
  }
  return errors;
}

export function parseFiniteScrapNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
