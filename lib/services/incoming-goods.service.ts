import { IncomingGoodsRepository } from '../repositories/incoming-goods.repository';
import { validateIncomingGoodRequest, validateIncomingGoodsDates, validateItemTypes, checkIncomingGoodsDuplicates, validateIncomingGoodsItemTypeConsistency } from '../validators/schemas/incoming-goods.schema';
import type { IncomingGoodRequestInput } from '../validators/schemas/incoming-goods.schema';
import type { ErrorDetail, SuccessResponse } from '../types/api-response';
import { logger } from '../utils/logger';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { prisma } from '@/lib/db/prisma';
import { logWmsAsyncFailure } from '@/lib/utils/wms-async-failure-log';
import { assertWmsIdNotExists } from '@/lib/services/wms-duplicate.service';

export class IncomingGoodsService {
  private repository: IncomingGoodsRepository;

  constructor() {
    this.repository = new IncomingGoodsRepository();
  }

  /**
   * Process incoming goods request
   */
  async processIncomingGoods(
    payload: unknown
  ): Promise<{ success: true; data: SuccessResponse } | { success: false; errors: ErrorDetail[] }> {
    const requestLogger = logger.child({
      service: 'IncomingGoodsService',
      method: 'processIncomingGoods',
    });

    try {
      // 1. Validate payload
      const validationResult = validateIncomingGoodRequest(payload);

      if (!validationResult.success) {
        requestLogger.warn(
          'Validation failed',
          { errors: validationResult.errors }
        );
        return { success: false, errors: validationResult.errors || [] };
      }

      const data = validationResult.data;
      if (!data) {
        requestLogger.error('Validation passed but data is undefined');
        return { 
          success: false, 
          errors: [{
            location: 'header' as const,
            field: 'payload',
            code: 'INTERNAL_ERROR',
            message: 'Validation passed but data is undefined'
          }] 
        };
      }

      requestLogger.info('Validation passed', { wmsId: data.wms_id });

      const nonFacilityMarkerErrors = this.validateNonFacilityMarker(data);
      if (nonFacilityMarkerErrors.length > 0) {
        requestLogger.warn('Non-facility marker validation failed', {
          errors: nonFacilityMarkerErrors,
          wmsId: data.wms_id,
        });
        return { success: false, errors: nonFacilityMarkerErrors };
      }

      // 2. Validate dates
      const dateErrors = validateIncomingGoodsDates(data);
      if (dateErrors.length > 0) {
        requestLogger.warn(
          'Date validation failed',
          { errors: dateErrors }
        );
        return { success: false, errors: dateErrors };
      }

      // 3. Check for duplicate items
      const duplicateErrors = checkIncomingGoodsDuplicates(data);
      if (duplicateErrors.length > 0) {
        requestLogger.warn(
          'Duplicate items found',
          { errors: duplicateErrors }
        );
        return { success: false, errors: duplicateErrors };
      }

      // 4. Validate item types
      const itemTypeErrors = await validateItemTypes(data);
      if (itemTypeErrors.length > 0) {
        requestLogger.warn(
          'Item type validation failed',
          { errors: itemTypeErrors }
        );
        return { success: false, errors: itemTypeErrors };
      }

      // 5. Validate item_type consistency against stock_daily_snapshot
      const itemTypeConsistencyErrors = await validateIncomingGoodsItemTypeConsistency(data);
      if (itemTypeConsistencyErrors.length > 0) {
        requestLogger.warn(
          'Item type consistency validation failed',
          { errors: itemTypeConsistencyErrors }
        );
        return { success: false, errors: itemTypeConsistencyErrors };
      }

      // 6. Business validations (database checks)
      const businessErrors = await this.validateBusiness(data);
      if (businessErrors.length > 0) {
        requestLogger.warn(
          'Business validation failed',
          { errors: businessErrors, wmsId: data.wms_id }
        );
        return { success: false, errors: businessErrors };
      }

      // 7. Prevent duplicate accepted WMS IDs before any async side effects
      const duplicateWmsIdErrors = await assertWmsIdNotExists({
        transactionType: 'incoming_goods',
        companyCode: data.company_code,
        wmsId: data.wms_id,
      });
      if (duplicateWmsIdErrors.length > 0) {
        requestLogger.warn('Duplicate WMS ID rejected', {
          wmsId: data.wms_id,
          companyCode: data.company_code,
        });
        return { success: false, errors: duplicateWmsIdErrors };
      }

      // 8. Queue for immediate async insert (non-blocking) + auto-transmit to INSW
      this.repository.createOrUpdate(data)
        .then(async (result) => {
          requestLogger.info(
            'Incoming goods saved successfully',
            {
              wmsId: result.wms_id,
              incomingGoodId: result.id,
              itemsCount: result.items_count,
            }
          );

          try {
            // Check company type
            const company = await prisma.companies.findUnique({
              where: { code: data.company_code },
              select: { company_type: true },
            });

            // Only transmit if SEZ company
            if (company?.company_type === 'SEZ') {
              const inswService = new INSWTransmissionService();
              const transmissionResult = await inswService.transmitIncomingGoods(data.company_code, [result.id]);
              if (transmissionResult.status === 'success') {
                requestLogger.info('Incoming goods transmitted to INSW', { wmsId: data.wms_id });
              } else {
                requestLogger.warn('Incoming goods INSW transmission failed', { wmsId: data.wms_id });
              }
            } else {
              requestLogger.info('Incoming goods NOT transmitted to INSW (non-SEZ company)', { wmsId: data.wms_id, companyType: company?.company_type });
            }
          } catch (err: any) {
            requestLogger.error('INSW auto-transmit error', { wmsId: data.wms_id, error: err.message });
          }
        })
        .catch((err: any) => {
          requestLogger.error('Incoming goods insert failed', {
            wmsId: data.wms_id,
            error: err.message,
          });
          void logWmsAsyncFailure({
            action: 'WMS_PROCESS_INCOMING_GOODS',
            transactionType: 'incoming_goods',
            companyCode: data.company_code,
            wmsId: data.wms_id,
            error: err,
            phase: 'db_persistence',
            payload: data,
          });
        });

      // 9. Return success response immediately (insert happens async)
      return {
        success: true,
        data: {
          status: 'success',
          message: 'Transaction validated and queued for processing',
          wms_id: data.wms_id,
          queued_items_count: data.items.length,
          validated_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      requestLogger.error('Failed to process incoming goods', { error });
      throw error;
    }
  }

  /**
   * Cache company validation results to minimize database queries
   * Optimization: Batch query all unique company codes at once
   */
  private async cacheCompanyValidation(
    companyCodes: number[]
  ): Promise<Map<number, boolean>> {
    const cache = new Map<number, boolean>();
    
    try {
      // Batch query: fetch all companies in one go instead of one by one
      const companies = await this.repository.getCompaniesByCode(companyCodes);
      const validCompanyCodes = new Set(
        companies
          .filter(c => c.status === 'ACTIVE')
          .map(c => c.code)
      );
      
      // Build cache
      companyCodes.forEach(code => {
        cache.set(code, validCompanyCodes.has(code));
      });
    } catch (error) {
      // If query fails, mark all as invalid
      companyCodes.forEach(code => {
        cache.set(code, false);
      });
    }
    
    return cache;
  }

  /**
   * Business validations (database checks)
   * 
   * Note: Based on API Contract v2.4:
   * - Only company_code needs to be validated
   * - Item_code validation is NOT required (WMS is source of truth)
   * - Item_type validation is handled by WMS
   */
  private async validateBusiness(data: IncomingGoodRequestInput): Promise<ErrorDetail[]> {
    const errors: ErrorDetail[] = [];

    // Optimization: Batch query both company_code and owner in one database call
    const companyCodes = [data.company_code, data.owner];
    const companyCache = await this.cacheCompanyValidation(companyCodes);

    // Check if company exists and is active (from cache)
    const companyExists = companyCache.get(data.company_code) ?? false;
    if (!companyExists) {
      errors.push({
        location: 'header',
        field: 'company_code',
        code: 'INVALID_COMPANY_CODE',
        message: `Company code ${data.company_code} is not active or does not exist`,
      });
    }

    // Check if owner exists and is active (from cache)
    const ownerExists = companyCache.get(data.owner) ?? false;
    if (!ownerExists) {
      errors.push({
        location: 'header',
        field: 'owner',
        code: 'INVALID_COMPANY_CODE',
        message: `Owner ${data.owner} is not active or does not exist`,
      });
    }

    // NOTE: Item code validation removed as per API Contract v2.4
    // WMS is the source of truth for item data
    // iMAPS will accept any item_code sent by WMS

    return errors;
  }

  private validateNonFacilityMarker(data: IncomingGoodRequestInput): ErrorDetail[] {
    const markerFields = [
      data.ppkek_number,
      data.customs_document_type,
      data.customs_registration_date,
    ];
    const markerCount = markerFields.filter(value => value === 'N').length;

    if (markerCount === 0 || markerCount === 3) {
      return [];
    }

    return [{
      location: 'header',
      field: 'non_facility_marker',
      code: 'NON_FACILITY_MARKER_INCOMPLETE',
      message: 'Non-facility incoming goods must use "N" for ppkek_number, customs_document_type, and customs_registration_date together',
    }];
  }
}
