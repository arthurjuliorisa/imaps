import { IncomingGoodsRepository } from '../repositories/incoming-goods.repository';
import { validateIncomingGoods } from '../validators/incoming-goods.validator';
import type { IncomingGoodsValidated } from '../validators/incoming-goods.validator';
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
      const validationResult = validateIncomingGoods(payload);

      if (!validationResult.success) {
        requestLogger.warn(
          'Validation failed',
          { errors: validationResult.errors }
        );
        return { success: false, errors: validationResult.errors };
      }

      const data = validationResult.data;
      requestLogger.info('Validation passed', { wmsId: data.wms_id });

      // 2. Business validations (database checks)
      const businessErrors = await this.validateBusiness(data);
      if (businessErrors.length > 0) {
        requestLogger.warn(
          'Business validation failed',
          { errors: businessErrors, wmsId: data.wms_id }
        );
        return { success: false, errors: businessErrors };
      }

      // 3. Save to database
      const result = await this.repository.createOrUpdate(data);

      requestLogger.info(
        'Incoming goods processed successfully',
        {
          wmsId: result.wms_id,
          incomingGoodId: result.id,
          itemsCount: result.items_count,
        }
      );

      // 4. Return success response
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
   * Business validations (database checks)
   * 
   * Note: Based on API Contract v2.4:
   * - Only company_code needs to be validated
   * - Item_code validation is NOT required (WMS is source of truth)
   * - Item_type validation is handled by WMS
   */
  private async validateBusiness(data: IncomingGoodsValidated): Promise<ErrorDetail[]> {
    const errors: ErrorDetail[] = [];

    // Check if company exists and is active
    const companyExists = await this.repository.companyExists(data.company_code);
    if (!companyExists) {
      errors.push({
        location: 'header',
        field: 'company_code',
        code: 'INVALID_COMPANY_CODE',
        message: `Company code ${data.company_code} is not active or does not exist`,
      });
    }

    // Check if owner exists and is active
    const ownerExists = await this.repository.companyExists(data.owner);
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