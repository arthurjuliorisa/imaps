import type { SupportedINSWCompanyCode } from './insw-company-config';

// No default authorization. Keep this independent of activation and credentials.
export function validateWorkerAllowedCompanies(values: readonly number[]): readonly SupportedINSWCompanyCode[] {
  if (!values.length || values.some(code => code !== 1370 && code !== 1380)
    || new Set(values).size !== values.length) {
    throw new Error('INSW_WORKER_ALLOWED_COMPANIES must be a nonempty comma-separated subset of 1370,1380 without duplicates');
  }
  return Object.freeze([...values]) as readonly SupportedINSWCompanyCode[];
}

export function resolveWorkerAllowedCompanies(env: Readonly<Record<string, string | undefined>> = process.env) {
  const parts = env.INSW_WORKER_ALLOWED_COMPANIES?.trim().split(',').map(part => part.trim());
  if (!parts?.length || parts.some(part => !/^(1370|1380)$/.test(part))) {
    throw new Error('INSW_WORKER_ALLOWED_COMPANIES must explicitly authorize 1370 and/or 1380');
  }
  return validateWorkerAllowedCompanies(parts.map(Number));
}
