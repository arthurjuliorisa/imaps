import type { ErrorDetail } from '@/lib/types/api-response';

const SEZ_COMPANY_CODES = new Set([1370, 1380]);
const FREE_MOVEMENT_CUSTOMS_DOCUMENT_TYPES = new Set([
  'free_movement',
  'free_movement-IN',
  'free_movement-OUT',
]);

export function isFreeMovementCustomsDocumentType(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && FREE_MOVEMENT_CUSTOMS_DOCUMENT_TYPES.has(value);
}

export function validateSezFreeMovementCustomsDocumentType(
  companyCode: number,
  customsDocumentType: string | null | undefined
): ErrorDetail[] {
  if (!isFreeMovementCustomsDocumentType(customsDocumentType)) {
    return [];
  }

  if (SEZ_COMPANY_CODES.has(companyCode)) {
    return [];
  }

  return [{
    location: 'header',
    field: 'customs_document_type',
    code: 'CUSTOM_DOCUMENT_TYPE_NOT_ALLOWED_FOR_COMPANY',
    message: `customs_document_type ${customsDocumentType} is only allowed for SEZ companies`,
  }];
}
