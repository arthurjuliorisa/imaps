// lib/services/incoming-goods.service.ts

/**
 * Incoming Goods Service
 * 
 * Purpose:
 * - Orchestrate business logic for incoming goods
 * - Coordinate validation and database operations
 * - Transform request data to database format
 * - Handle error scenarios
 * 
 * Flow:
 * Request → Validation → Transform → Repository → Response
 */

import { validateIncomingGoodRequest } from '@/lib/validators/schemas/incoming-goods.schema';
import { incomingGoodRepository } from '@/lib/repositories/incoming-goods.repository';
import {
  IncomingGoodData,
  IncomingGoodSuccessResponse,
  IncomingGoodErrorResponse,
} from '@/lib/types/incoming-goods.types';

/**
 * Service result type
 */
export type IncomingGoodServiceResult =
  | { success: true; data: IncomingGoodSuccessResponse }
  | { success: false; data: IncomingGoodErrorResponse };

/**
 * Service class for incoming goods operations
 */
export class IncomingGoodService {
  /**
   * Process incoming good request from WMS
   * 
   * Steps:
   * 1. Validate request payload (schema + business rules)
   * 2. Transform to database format
   * 3. Upsert to database (idempotent)
   * 4. Return success/error response
   * 
   * @param requestData - Raw request from WMS
   * @returns Service result with success/error response
   */
  async processIncomingGood(
    requestData: unknown
  ): Promise<IncomingGoodServiceResult> {
    // ========================================================================
    // STEP 1: VALIDATION
    // ========================================================================
    
    const validation = validateIncomingGoodRequest(requestData);

    if (!validation.success) {
      // Validation failed - return error response
      const wmsId = 
        typeof requestData === 'object' && 
        requestData !== null && 
        'wms_id' in requestData
          ? String(requestData.wms_id)
          : 'unknown';

      return {
        success: false,
        data: {
          status: 'failed',
          message: 'Validation failed',
          wms_id: wmsId,
          errors: validation.errors || [],
        },
      };
    }

    const validatedData = validation.data!;

    // ========================================================================
    // STEP 2: TRANSFORM TO DATABASE FORMAT
    // ========================================================================

    const dbData = this.transformToDbFormat(validatedData);

    // ========================================================================
    // STEP 3: UPSERT TO DATABASE
    // ========================================================================

    const upsertResult = await incomingGoodRepository.upsert(dbData);

    if (!upsertResult.success) {
      // Database error
      return {
        success: false,
        data: {
          status: 'failed',
          message: 'Database operation failed',
          wms_id: validatedData.wms_id,
          errors: [
            {
              location: 'header',
              field: 'database',
              code: 'DATABASE_ERROR',
              message: upsertResult.error || 'Unknown database error',
            },
          ],
        },
      };
    }

    // ========================================================================
    // STEP 4: RETURN SUCCESS RESPONSE
    // ========================================================================

    return {
      success: true,
      data: {
        status: 'success',
        message: 'Transaction validated and queued for processing',
        wms_id: validatedData.wms_id,
        queued_items_count: validatedData.items.length,
        validated_at: new Date().toISOString(),
      },
    };
  }

  /**
   * Transform validated request to database format
   *
   * Conversions:
   * - Date strings (YYYY-MM-DD) → Date objects
   * - ISO datetime string → Date object
   * - Add partition key fields to items
   *
   * @param data - Validated request data
   * @returns Database-ready format
   */
  private transformToDbFormat(data: any): IncomingGoodData {
    const incomingDate = new Date(data.incoming_date);
    
    return {
      wms_id: data.wms_id,
      company_code: data.company_code,
      owner: data.owner,
      customs_document_type: data.customs_document_type,
      ppkek_number: data.ppkek_number,
      customs_registration_date: new Date(data.customs_registration_date),
      incoming_evidence_number: data.incoming_evidence_number,
      incoming_date: incomingDate,
      invoice_number: data.invoice_number,
      invoice_date: new Date(data.invoice_date),
      shipper_name: data.shipper_name,
      timestamp: new Date(data.timestamp),
      items: data.items.map((item: any) => ({
        item_type: item.item_type,
        item_code: item.item_code,
        item_name: item.item_name,
        hs_code: item.hs_code || null,
        uom: item.uom,
        qty: item.qty,
        currency: item.currency,
        amount: item.amount,
        // Partition key fields (required for partitioned child table)
        incoming_good_company: data.company_code,
        incoming_good_date: incomingDate,
      })),
    };
  }

  /**
   * Get incoming good by WMS ID (for verification/debugging)
   * 
   * @param company_code - Company code
   * @param wms_id - WMS transaction ID
   * @returns Incoming good record or null
   */
  async getByWmsId(company_code: number, wms_id: string) {
    return await incomingGoodRepository.findByWmsId(company_code, wms_id);
  }

  /**
   * Get statistics for monitoring
   * 
   * @param company_code - Company code
   * @param from_date - Start date
   * @param to_date - End date
   * @returns Statistics
   */
  async getStatistics(
    company_code: number,
    from_date: Date,
    to_date: Date
  ) {
    return await incomingGoodRepository.getStatistics(
      company_code,
      from_date,
      to_date
    );
  }
}

// Export singleton instance
export const incomingGoodService = new IncomingGoodService();
