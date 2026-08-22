/**
 * Company codes are stored as integers, while NextAuth serializes the value in
 * the JWT/session as a string. Normalize the two request boundaries before
 * applying company-scoped user-management authorization.
 */
export function normalizeCompanyCode(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    return null;
  }

  const companyCode = Number(value.trim());
  return Number.isSafeInteger(companyCode) ? companyCode : null;
}

export function isCompanyInUserScope(
  authenticatedCompanyCode: unknown,
  targetCompanyCode: unknown
): boolean {
  const authenticated = normalizeCompanyCode(authenticatedCompanyCode);
  const target = normalizeCompanyCode(targetCompanyCode);

  return authenticated !== null && target !== null && authenticated === target;
}
