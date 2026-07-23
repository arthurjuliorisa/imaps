export const NON_FACILITY_MARKER = 'N' as const;

export interface NonFacilityMarkerFields {
  customs_document_type: string | null | undefined;
  ppkek_number: string | null | undefined;
  customs_registration_date: string | null | undefined;
}

export interface NonFacilityMarkerValidationError {
  location: 'header';
  field: 'non_facility_marker';
  code: 'NON_FACILITY_MARKER_INCOMPLETE';
  message: string;
}

export function isCompleteNonFacilityMarker(fields: NonFacilityMarkerFields): boolean {
  return fields.customs_document_type === NON_FACILITY_MARKER
    && fields.ppkek_number === NON_FACILITY_MARKER
    && fields.customs_registration_date === NON_FACILITY_MARKER;
}

export function validateNonFacilityMarker(
  fields: NonFacilityMarkerFields,
  transactionName: string
): NonFacilityMarkerValidationError[] {
  const markerCount = [
    fields.customs_document_type,
    fields.ppkek_number,
    fields.customs_registration_date,
  ].filter((value) => value === NON_FACILITY_MARKER).length;

  if (markerCount === 0 || markerCount === 3) {
    return [];
  }

  return [{
    location: 'header',
    field: 'non_facility_marker',
    code: 'NON_FACILITY_MARKER_INCOMPLETE',
    message: `Non-facility ${transactionName} must use "N" for ppkek_number, customs_document_type, and customs_registration_date together`,
  }];
}
