import { normalizeCompanyCode } from './user-company-scope';

/** A protected field is only changed when a replacement value differs from persistence. */
export function hasRoleChanged(requestedRole: unknown, persistedRole: string): boolean {
  return requestedRole !== undefined && requestedRole !== persistedRole;
}

export function getRequestedCompanyCode(value: unknown): number | null {
  return value ? normalizeCompanyCode(value) : null;
}

export function hasCompanyCodeChanged(
  requestedCompanyCode: unknown,
  persistedCompanyCode: number | null
): boolean {
  return (
    requestedCompanyCode !== undefined &&
    getRequestedCompanyCode(requestedCompanyCode) !== persistedCompanyCode
  );
}
