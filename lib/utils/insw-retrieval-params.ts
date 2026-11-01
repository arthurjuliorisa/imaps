import type { INSWGetDataParams } from '@/lib/types/insw-api.types';

export class INSWRetrievalDateError extends Error {}

function normalizeDate(value: unknown, field: string): string {
  const error = () => new INSWRetrievalDateError(
    `${field} must be a valid date (YYYY-MM-DD or legacy DD-MM-YYYY)`
  );
  if (typeof value !== 'string') throw error();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const legacy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!iso && !legacy) throw error();
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(legacy![3]), Number(legacy![2]), Number(legacy![1])];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) throw error();

  // Calendar strings stay calendar strings: never shift through a UTC/local Date.
  return iso ? value : `${legacy![3]}-${legacy![2]}-${legacy![1]}`;
}

export function normalizeINSWRetrievalParams(params: INSWGetDataParams): INSWGetDataParams {
  return {
    tglAwal: normalizeDate(params.tglAwal, 'tglAwal'),
    tglAkhir: normalizeDate(params.tglAkhir, 'tglAkhir'),
  };
}
