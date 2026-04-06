import { IncomingGoodsRepository } from '../repositories/incoming-goods.repository';
import { validateIncomingGoodRequest, validateIncomingGoodsDates, validateItemTypes, checkIncomingGoodsDuplicates, validateIncomingGoodsItemTypeConsistency } from '../validators/schemas/incoming-goods.schema';
import type { IncomingGoodRequestInput } from '../validators/schemas/incoming-goods.schema';
import type { ErrorDetail, SuccessResponse } from '../types/api-response';
import { logger } from '../utils/logger';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { prisma } from '@/lib/db/prisma';

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

      // 7. Save to database
      const result = await this.repository.createOrUpdate(data);

      requestLogger.info(
        'Incoming goods processed successfully',
        {
          wmsId: result.wms_id,
          incomingGoodId: result.id,
          itemsCount: result.items_count,
        }
      );

      // 8. Auto-transmit to INSW (fire-and-forget, non-blocking)
      // Only transmit if company type is SEZ
      (async () => {
        try {
          // Check company type
          const company = await prisma.companies.findUnique({
            where: { code: data.company_code },
            select: { company_type: true },
          });

          // Only transmit if SEZ company
          if (company?.company_type === 'SEZ') {
            const inswService = new INSWTransmissionService(process.env.INSW_USE_TEST_MODE === 'true');
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
      })();

      // 9. Return success response immediately
      return {
        success: true,
        data: {
          status: 'success',
          message: 'Transaction validated and queued for processing',
          wms_id: result.wms_id,
          queued_items_count: result.items_count,
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
}