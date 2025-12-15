// lib/types/incoming-goods.types.ts

/**
 * Incoming Goods Types
 * 
 * Purpose:
 * - Define TypeScript interfaces for incoming goods API
 * - Ensure type safety across service and repository layers
 * - Map to Prisma schema types
 * 
 * Version: 2.0 - Updated to use ItemType enum from Prisma
 * 
 * Changes from v1.0:
 * - item_type: string → ItemType (enum)
 * - Better type safety with Prisma-generated types
 * - Compile-time validation of item types
 */

import { Currency, CustomsDocumentType, ItemType } from '@prisma/client';

/**
 * Single item in incoming goods transaction
 */
export interface IncomingGoodItemInput {
  item_type: ItemType;  // UPDATED: Uses enum for type safety
  item_code: string;
  item_name: string;
  hs_code?: string | null;
  uom: string;
  qty: number;
  currency: Currency;
  amount: number;
}

/**
 * Complete incoming goods transaction data
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
  items: IncomingGoodItemInput[];
  timestamp: Date;
}

/**
 * API success response
 */
export interface IncomingGoodSuccessResponse {
  status: 'success';
  message: string;
  wms_id: string;
  queued_items_count: number;
  validated_at: string;
  performance?: {
    items_processed: number;
    processing_time_ms: number;
    was_updated: boolean;
  };
}

/**
 * Validation error detail
 */
export interface ValidationError {
  location: 'header' | 'item';
  field: string;
  code: string;
  message: string;
  item_index?: number;
  item_code?: string;
}

/**
 * API error response
 */
export interface IncomingGoodErrorResponse {
  status: 'failed';
  message: string;
  wms_id?: string;
  errors: ValidationError[];
}

/**
 * Service layer result
 */
export interface ServiceResult {
  success: boolean;
  data: IncomingGoodSuccessResponse | IncomingGoodErrorResponse;
}
