export interface CustomsDocumentTypeDisplayInput {
  documentType?: string | null;
  isNonFacility?: boolean | null;
}

export function getCustomsDocumentTypeDisplayValue(row: CustomsDocumentTypeDisplayInput): string {
  return row.isNonFacility === true ? 'N' : row.documentType ?? '';
}
