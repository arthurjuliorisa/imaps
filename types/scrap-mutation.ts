/**
 * Type definitions for Scrap Mutation API
 */

/**
 * Base ScrapMutation data structure
 */
export interface ScrapMutation {
  id: string;
  date: Date | string;
  itemId: string;
  uomId: string;
  beginning: number;
  incoming: number;
  outgoing: number;
  adjustment: number;
  ending: number;
  stockOpname: number;
  variant: number;
  remarks: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * ScrapMutation with related item and UOM data
 * Returned by GET /api/customs/scrap
 */
export interface ScrapMutationWithRelations extends ScrapMutation {
  item: {
    id: string;
    code: string;
    name: string;
    type: string;
  };
  uom: {
    id: string;
    code: string;
    name: string;
  };
  itemCode: string;
  itemName: string;
  itemType: string;
  uomCode: string;
  uomName: string;
}

/**
 * Request body for POST /api/customs/scrap
 */
export interface CreateScrapMutationRequest {
  date: string | Date;
  itemId: string;
  uomId: string;
  beginning?: number;
  incoming?: number;
  outgoing?: number;
  adjustment?: number;
  stockOpname?: number;
  remarks?: string;
}

/**
 * Request body for creating INCOMING-only scrap mutation
 */
export interface CreateScrapIncomingRequest {
  date: string | Date;
  itemId: string;
  uomId: string;
  incoming: number;
  remarks?: string;
}

/**
 * Record structure for import
 */
export interface ScrapMutationImportRecord {
  date: string | Date;
  itemId: string;
  uomId: string;
  beginning?: number;
  incoming?: number;
  outgoing?: number;
  adjustment?: number;
  stockOpname?: number;
  remarks?: string;
}

/**
 * Record structure for INCOMING-only import
 * Uses itemCode instead of itemId for Excel imports
 */
export interface ImportScrapIncomingRecord {
  date: string | Date;
  itemCode: string;
  incoming: number;
  remarks?: string;
}

/**
 * Request body for POST /api/customs/scrap/import
 */
export interface ImportScrapMutationsRequest {
  records: ScrapMutationImportRecord[];
}

/**
 * Error details for failed import records
 */
export interface ImportError {
  index: number;
  record: any;
  error: string;
}

/**
 * Response from POST /api/customs/scrap/import
 */
export interface ImportScrapMutationsResponse {
  success: boolean;
  message: string;
  successCount: number;
  errorCount: number;
  errors: ImportError[];
}

/**
 * Query parameters for GET /api/customs/scrap
 */
export interface GetScrapMutationsParams {
  startDate?: string;
  endDate?: string;
}
