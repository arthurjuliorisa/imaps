const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDateOnlyString(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function toNullableInvoiceDate(value: string | null): Date | null {
  if (value === null) return null;

  if (!isValidDateOnlyString(value)) {
    throw new Error('invoice_date must be a valid date in YYYY-MM-DD format');
  }

  return new Date(`${value}T00:00:00.000Z`);
}
