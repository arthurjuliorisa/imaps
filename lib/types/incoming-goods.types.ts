// lib/types/incoming-goods.types.ts

/**
 * Incoming Goods Types
 * 
 * Based on:
 * - WMS-iMAPS API Contract v2.4 Section 5.1
 * - Prisma schema (incoming_goods and incoming_good_items tables)
 * 
 * These types represent the data structure for incoming goods transactions
 * from WMS to iMAPS system.
 */

import { CustomsDocumentType, ItemType, Currency } from '@prisma/client';

// ============================================================================
// REQUEST TYPES (from WMS)
// ============================================================================

/**
 * Single item in incoming goods transaction
 */
export interface IncomingGoodItemRequest {
  item_type: ItemType;
  item_code: string;
  item_name: string;
  hs_code?: string | null;
  uom: string;
  qty: number;
  currency: Currency;
  amount: number;
}

/**
 * Complete incoming goods request payload
 * Structure: Header-Detail (1 transaction with multiple items)
 */
export interface IncomingGoodRequest {
  wms_id: string;
  company_code: number;
  owner: number;
  customs_document_type: CustomsDocumentType;
  ppkek_number: string;
  customs_registration_date: string; // YYYY-MM-DD
  incoming_evidence_number: string;
  incoming_date: string; // YYYY-MM-DD
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  shipper_name: string;
  items: IncomingGoodItemRequest[];
  timestamp: string; // ISO 8601
}

// ============================================================================
// DATABASE TYPES (for Prisma operations)
// ============================================================================

/**
 * Item data for database insert/update
 */
export interface IncomingGoodItemData {
  item_type: ItemType;
  item_code: string;
  item_name: string;
  hs_code?: string | null;
  uom: string;
  qty: number;
  currency: Currency;
  amount: number;
  // Partition key fields (for child table)
  incoming_good_company: number;
  incoming_good_date: Date;
}

/**
 * Header data for database insert/update
 */
export interface IncomingGoodData {
  wms_id: string;
  company_code: number;
  owner: number;
  customs_document_type: CustomsDocumentType;
  ppkek_number: string;
  customs_registration_date: Date;
  incoming_evidence_number: string;
  incoming_date: Date;
  invoice_number: string;
  invoice_date: Date;
  shipper_name: string;
  timestamp: Date;
  items: IncomingGoodItemData[];
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Validation context for business rules
 */
export interface ValidationContext {
  company_code: number;
  incoming_date: Date;
  customs_registration_date: Date;
  items: IncomingGoodItemRequest[];
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Field validation error
 */
export interface ValidationError {
  location: 'header' | 'item';
  field: string;
  code: string;
  message: string;
  item_index?: number;
  item_code?: string;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Success response for incoming goods
 */
export interface IncomingGoodSuccessResponse {
  status: 'success';
  message: string;
  wms_id: string;
  queued_items_count: number;
  validated_at: string;
}

/**
 * Error response for incoming goods
 */
export interface IncomingGoodErrorResponse {
  status: 'failed';
  message: string;
  wms_id: string;
  errors: ValidationError[];
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Supported company codes
 */
export const VALID_COMPANY_CODES = [1370, 1310, 1380] as const;
export type ValidCompanyCode = typeof VALID_COMPANY_CODES[number];

/**
 * Supported customs document types for incoming goods
 */
export const INCOMING_CUSTOMS_TYPES = ['BC23', 'BC27', 'BC40'] as const;
export type IncomingCustomsType = typeof INCOMING_CUSTOMS_TYPES[number];

/**
 * Type guard to check if company code is valid
 */
export function isValidCompanyCode(code: number): code is ValidCompanyCode {
  return VALID_COMPANY_CODES.includes(code as ValidCompanyCode);
}

/**
 * Type guard to check if customs document type is valid for incoming
 */
export function isValidIncomingCustomsType(type: string): type is IncomingCustomsType {
  return INCOMING_CUSTOMS_TYPES.includes(type as IncomingCustomsType);
}
