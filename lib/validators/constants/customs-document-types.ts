/**
 * Customs Document Types - Single Source of Truth
 * 
 * This file defines all valid customs document types from the CustomsDocumentType enum
 * in the Prisma schema. Use these constants in validators and business logic.
 * 
 * IMPORTANT: Keep this in sync with enum CustomsDocumentType in prisma/schema.prisma
 * 
 * Enum definition reference:
 * @see prisma/schema.prisma (CustomsDocumentType enum)
 */

// ============================================================================
// ALL CUSTOMS DOCUMENT TYPES
// ============================================================================

/**
 * Complete list of all valid customs document types
 * 
 * Values:
 * - BC23: Import Declaration
 * - BC27: Other Bonded Zone Release (Incoming & Outgoing)
 * - BC40: Local Purchase from Non-Bonded Zone
 * - BC30: Export Declaration
 * - BC25: Local Sales to Non-Bonded Zone
 * - BC41: Local Sales to Non-Bonded Zone from Local Purchase (BC40)
 * - BC261: Subcontracting - Incoming
 * - BC262: Subcontracting - Outgoing
 * - PPKEKTLDDP: PPKEK incoming for TLDDP
 * - PPKEKLDIN: PPKEK incoming for LDP
 * - PPKEKLDPOUT: PPKEK outgoing for LDP
 */
export const ALL_CUSTOMS_TYPES = [
  'BC23',       // Import Declaration
  'BC27',       // Other Bonded Zone Release (Incoming & Outgoing)
  'BC40',       // Local Purchase from Non-Bonded Zone
  'BC30',       // Export Declaration
  'BC25',       // Local Sales to Non-Bonded Zone
  'BC41',       // Local Sales to Non-Bonded Zone from Local Purchase (BC40)
  'BC261',      // Subcontracting - Incoming
  'BC262',      // Subcontracting - Outgoing
  'PPKEKTLDDP', // PPKEK incoming for TLDDP
  'PPKEKLDIN',  // PPKEK incoming for LDP
  'PPKEKLDPOUT' // PPKEK outgoing for LDP
] as const;

export type CustomsDocumentTypeValue = (typeof ALL_CUSTOMS_TYPES)[number];

// ============================================================================
// INCOMING GOODS - ALLOWED TYPES
// ============================================================================

/**
 * Valid customs document types for INCOMING GOODS transactions
 * 
 * Based on business requirements:
 * - BC23: Import Declaration (primary incoming type)
 * - BC27: Other Bonded Zone Release (inter-zone transfer)
 * - BC40: Local Purchase from Non-Bonded Zone (local sourcing)
 * - BC261: Subcontracting - Incoming (return from subcontractor)
 * - PPKEKTLDDP: PPKEK incoming for TLDDP
 * - PPKEKLDIN: PPKEK incoming for LDP
 */
export const INCOMING_CUSTOMS_TYPES = [
  'BC23',       // Import Declaration
  'BC27',       // Other Bonded Zone Release (Incoming)
  'BC40',       // Local Purchase from Non-Bonded Zone
  'BC261',      // Subcontracting - Incoming
  'PPKEKTLDDP', // PPKEK incoming for TLDDP
  'PPKEKLDIN'   // PPKEK incoming for LDP
] as const;

export type IncomingCustomsDocumentType = (typeof INCOMING_CUSTOMS_TYPES)[number];

// ============================================================================
// OUTGOING GOODS - ALLOWED TYPES
// ============================================================================

/**
 * Valid customs document types for OUTGOING GOODS transactions
 * 
 * Based on business requirements:
 * - BC30: Export Declaration (primary outgoing type)
 * - BC25: Local Sales to Non-Bonded Zone
 * - BC27: Other Bonded Zone Release (inter-zone transfer)
 * - BC41: Local Sales from Local Purchase (BC40)
 * - BC262: Subcontracting - Outgoing (send to subcontractor)
 * - PPKEKLDPOUT: PPKEK outgoing for LDP
 */
export const OUTGOING_CUSTOMS_TYPES = [
  'BC30',       // Export Declaration
  'BC25',       // Local Sales to Non-Bonded Zone
  'BC27',       // Other Bonded Zone Release (Outgoing)
  'BC41',       // Local Sales to Non-Bonded Zone from Local Purchase (BC40)
  'BC262',      // Subcontracting - Outgoing
  'PPKEKLDPOUT' // PPKEK outgoing for LDP
] as const;

export type OutgoingCustomsDocumentType = (typeof OUTGOING_CUSTOMS_TYPES)[number];

// ============================================================================
// SCRAP TRANSACTIONS - ALLOWED TYPES
// ============================================================================

/**
 * Valid customs document types for SCRAP TRANSACTIONS (OUT only)
 * 
 * Based on business requirements:
 * - BC25: Local Sales (scrap disposal locally)
 * - BC27: Other Bonded Zone Release (scrap to bonded zone)
 * - BC41: Local Sales from Local Purchase
 * - BC262: Subcontracting - Outgoing (return scrap to subcontractor)
 */
export const SCRAP_CUSTOMS_TYPES = [
  'BC25',       // Local Sales
  'BC27',       // Other Bonded Zone Release
  'BC41',       // Local Sales from Local Purchase
  'BC262'       // Subcontracting - Outgoing
] as const;

export type ScrapCustomsDocumentType = (typeof SCRAP_CUSTOMS_TYPES)[number];

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Check if a value is a valid customs document type
 * 
 * @param value - Value to check
 * @returns true if value is in ALL_CUSTOMS_TYPES
 * 
 * @example
 * isValidCustomsType('BC23') // true
 * isValidCustomsType('INVALID') // false
 */
export function isValidCustomsType(value: unknown): value is CustomsDocumentTypeValue {
  return Array.isArray(ALL_CUSTOMS_TYPES) && ALL_CUSTOMS_TYPES.includes(value as any);
}

/**
 * Check if a value is valid for incoming goods
 * 
 * @param value - Value to check
 * @returns true if value is in INCOMING_CUSTOMS_TYPES
 */
export function isValidIncomingCustomsType(value: unknown): value is IncomingCustomsDocumentType {
  return Array.isArray(INCOMING_CUSTOMS_TYPES) && INCOMING_CUSTOMS_TYPES.includes(value as any);
}

/**
 * Check if a value is valid for outgoing goods
 * 
 * @param value - Value to check
 * @returns true if value is in OUTGOING_CUSTOMS_TYPES
 */
export function isValidOutgoingCustomsType(value: unknown): value is OutgoingCustomsDocumentType {
  return Array.isArray(OUTGOING_CUSTOMS_TYPES) && OUTGOING_CUSTOMS_TYPES.includes(value as any);
}

/**
 * Check if a value is valid for scrap transactions
 * 
 * @param value - Value to check
 * @returns true if value is in SCRAP_CUSTOMS_TYPES
 */
export function isValidScrapCustomsType(value: unknown): value is ScrapCustomsDocumentType {
  return Array.isArray(SCRAP_CUSTOMS_TYPES) && SCRAP_CUSTOMS_TYPES.includes(value as any);
}

// ============================================================================
// DESCRIPTIONS
// ============================================================================

/**
 * Friendly descriptions for customs document types
 */
export const CUSTOMS_TYPE_DESCRIPTIONS: Record<CustomsDocumentTypeValue, string> = {
  BC23: 'Import Declaration',
  BC27: 'Other Bonded Zone Release',
  BC40: 'Local Purchase from Non-Bonded Zone',
  BC30: 'Export Declaration',
  BC25: 'Local Sales to Non-Bonded Zone',
  BC41: 'Local Sales from Local Purchase (BC40)',
  BC261: 'Subcontracting - Incoming',
  BC262: 'Subcontracting - Outgoing',
  PPKEKTLDDP: 'PPKEK incoming for TLDDP',
  PPKEKLDIN: 'PPKEK incoming for LDP',
  PPKEKLDPOUT: 'PPKEK outgoing for LDP'
};

/**
 * Get a friendly description for a customs type
 * 
 * @param type - Customs document type
 * @returns Description or empty string if not found
 */
export function getCustomsTypeDescription(type: CustomsDocumentTypeValue): string {
  return CUSTOMS_TYPE_DESCRIPTIONS[type] || '';
}
