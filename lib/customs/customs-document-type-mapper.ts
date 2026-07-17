import { CustomsDocumentType } from '@prisma/client';
import type { CustomsDocumentTypeValue } from '@/lib/validators/constants/customs-document-types';

const FREE_MOVEMENT = 'FREE_MOVEMENT' as CustomsDocumentType;
const FREE_MOVEMENT_IN = 'FREE_MOVEMENT_IN' as CustomsDocumentType;
const FREE_MOVEMENT_OUT = 'FREE_MOVEMENT_OUT' as CustomsDocumentType;

export const API_TO_PRISMA_CUSTOMS_DOCUMENT_TYPE: Record<CustomsDocumentTypeValue, CustomsDocumentType> = {
  BC23: CustomsDocumentType.BC23,
  BC27: CustomsDocumentType.BC27,
  BC27IN: CustomsDocumentType.BC27IN,
  BC27OUT: CustomsDocumentType.BC27OUT,
  BC40: CustomsDocumentType.BC40,
  BC30: CustomsDocumentType.BC30,
  BC25: CustomsDocumentType.BC25,
  BC41: CustomsDocumentType.BC41,
  BC261: CustomsDocumentType.BC261,
  BC262: CustomsDocumentType.BC262,
  PPKEKTLDDP: CustomsDocumentType.PPKEKTLDDP,
  PPKEKLDIN: CustomsDocumentType.PPKEKLDIN,
  PPKEKLDPOUT: CustomsDocumentType.PPKEKLDPOUT,
  free_movement: FREE_MOVEMENT,
  'free_movement-IN': FREE_MOVEMENT_IN,
  'free_movement-OUT': FREE_MOVEMENT_OUT,
};

export function mapCustomsDocumentType(value: CustomsDocumentTypeValue): CustomsDocumentType {
  const mapped = API_TO_PRISMA_CUSTOMS_DOCUMENT_TYPE[value];

  if (!mapped) {
    throw new Error(`Unsupported customs_document_type: ${value}`);
  }

  return mapped;
}
