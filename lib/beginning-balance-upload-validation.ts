/** Shared by Excel preview and HTTP import. Only item codes accept numeric cells. */
export const uploadTextFields = {
  itemType: 'Item Type', itemCode: 'Item Code', itemName: 'Item Name', uom: 'UOM',
} as const;

export function normalizeBeginningBalanceText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Use the stored ExcelJS value, never display text/numFmt or a formula result.
 * Safe positive integers are below 1e21, so String emits plain decimal digits.
 * This cannot recover leading zeros already lost in Excel. */
export function normalizeBeginningBalanceItemCode(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value == null || value === '' || (typeof value === 'string' && !value.trim()) || value === 0) {
    // Preserve import's existing required-field treatment of numeric zero.
    throw new Error('Item Code is required');
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Item Code numeric value must be a positive safe integer. Use source-of-truth Excel Text for the exact code.');
    }
    return String(value);
  }
  throw new Error('Item Code must be text or a positive safe integer numeric cell. Formula, Date, Boolean, error and object cells are not supported.');
}

export function parseBeginningBalanceDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(value.trim())) {
    throw new Error('Invalid date format. Expected MM/DD/YYYY');
  }
  const [month, day, year] = value.trim().split('/').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Invalid calendar date. Expected MM/DD/YYYY');
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (date > today) throw new Error('Date cannot be in the future');
  return date;
}

export function parseBeginningBalanceQty(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new Error('Qty must be a positive finite number');
  }
  if (typeof value === 'string' && !/^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/.test(value.trim())) {
    throw new Error('Qty must be a positive finite number');
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error('Qty must be a positive finite number');
  return number;
}

export function validateBeginningBalanceUploadRecord(value: unknown, full = true): Array<{ field: string; error: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{ field: 'Record', error: 'Expected a row object' }];
  }
  const row = value as Record<string, unknown>;
  const errors: Array<{ field: string; error: string }> = [];
  for (const [key, field] of Object.entries(uploadTextFields)) {
    const value = row[key];
    if (key === 'itemCode') {
      try { normalizeBeginningBalanceItemCode(value); } catch (error) { errors.push({ field, error: (error as Error).message }); }
      continue;
    }
    if (value == null || value === '') errors.push({ field, error: `${field} is required` });
    else if (typeof value !== 'string') errors.push({ field, error: `${field} must be stored as Excel Text. Restore the original value including any leading zeros before re-uploading.` });
    else if (!value.trim()) errors.push({ field, error: `${field} is required` });
  }
  for (const key of ['remarks', 'ppkekNumbers']) {
    const textArray = key === 'ppkekNumbers' && Array.isArray(row[key]) && row[key].every(value => typeof value === 'string');
    if (row[key] != null && typeof row[key] !== 'string' && !textArray) errors.push({ field: key, error: `${key} must be text` });
  }
  const ppkeks = row.ppkekNumbers;
  if (typeof ppkeks === 'string' && ppkeks.trim() && ppkeks.split(',').some(value => !value.trim())) {
    errors.push({ field: 'PPKEK Numbers', error: 'PPKEK Numbers format invalid (comma-separated values)' });
  }
  if (Array.isArray(ppkeks) && ppkeks.some(value => typeof value === 'string' && !value.trim())) {
    errors.push({ field: 'PPKEK Numbers', error: 'PPKEK Numbers must not contain empty values' });
  }
  if (full || 'qty' in row) {
    try { parseBeginningBalanceQty(row.qty); } catch (error) { errors.push({ field: 'Qty', error: (error as Error).message }); }
  }
  if (full || 'balanceDate' in row) {
    try { parseBeginningBalanceDate(row.balanceDate); } catch (error) { errors.push({ field: 'Balance Date', error: (error as Error).message }); }
  }
  return errors;
}

export function beginningBalanceUploadErrors(records: unknown[], full = true) {
  return records.flatMap((row, index) => validateBeginningBalanceUploadRecord(row, full)
    .map(error => ({ row: index + 3, ...error })));
}
