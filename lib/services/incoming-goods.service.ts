import { IncomingGoodsRepository } from '../repositories/incoming-goods.repository';
import { validateIncomingGoodRequest, validateIncomingGoodsDates, validateItemTypes } from '../validators/schemas/incoming-goods.schema';
import type { IncomingGoodRequestInput } from '../validators/schemas/incoming-goods.schema';
import type { ErrorDetail, SuccessResponse } from '../types/api-response';
import { logger } from '../utils/logger';

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

      // 3. Validate item types
      const itemTypeErrors = await validateItemTypes(data);
      if (itemTypeErrors.length > 0) {
        requestLogger.warn(
          'Item type validation failed',
          { errors: itemTypeErrors }
        );
        return { success: false, errors: itemTypeErrors };
      }

      // 3. Business validations (database checks)
      const businessErrors = await this.validateBusiness(data);
      if (businessErrors.length > 0) {
        requestLogger.warn(
          'Business validation failed',
          { errors: businessErrors, wmsId: data.wms_id }
        );
        return { success: false, errors: businessErrors };
      }

      // 4. Save to database
      const result = await this.repository.createOrUpdate(data);

      requestLogger.info(
        'Incoming goods processed successfully',
        {
          wmsId: result.wms_id,
          incomingGoodId: result.id,
          itemsCount: result.items_count,
        }
      );

      // 5. Return success response
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