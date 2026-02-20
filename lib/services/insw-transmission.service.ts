import { prisma } from '@/lib/prisma';
import { INSWIntegrationService } from './insw-integration.service';
import { INSWHelper } from '@/lib/utils/insw-helper';
import {
  INSWTransmissionStatus,
  INSWTransmitResult,
  INSWTransmitResponse,
} from '@/lib/types/insw-transmission.types';
import { logger } from '@/lib/utils/logger';

export class INSWTransmissionService {
  private inswService: INSWIntegrationService;
  private log = logger.child({ service: 'INSWTransmissionService' });

  constructor(useTestMode: boolean = true) {
    this.inswService = new INSWIntegrationService(
      process.env.INSW_API_KEY || 'RqT40lH7Hy202uUybBLkFhtNnfAvxrlp',
      process.env.INSW_UNIQUE_KEY_TEST || '',
      useTestMode
    );
  }

  /**
   * Transmit incoming goods to INSW
   */
  async transmitIncomingGoods(
    companyCode: number,
    ids: number[]
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting incoming goods transmission', { companyCode, ids });

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      // Convert to INSW format
      const payload = await this.inswService.convertPemasukanToINSW(
        companyCode,
        ids
      );

      // Validate payload
      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        this.log.error('Validation failed', { errors: validation.errors });

        // Log each failed record
        for (const id of ids) {
          await this.logTransmission({
            transaction_type: 'incoming',
            transaction_id: id,
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '30',
            insw_request_payload: payload,
            insw_error: validation.errors.join('; '),
          });

          results.push({
            id,
            wms_id: `ID-${id}`,
            status: 'failed',
            insw_status: INSWTransmissionStatus.FAILED,
            error: validation.errors.join('; '),
          });
          failedCount++;
        }

        return {
          status: 'failed',
          message: 'Validation failed',
          total: ids.length,
          success_count: 0,
          failed_count: failedCount,
          skipped_count: 0,
          results,
        };
      }

      // Send to INSW
      const inswResponse = await this.inswService.postPemasukan(payload);

      // Process response
      if (inswResponse.status) {
        for (const id of ids) {
          await this.logTransmission({
            transaction_type: 'incoming',
            transaction_id: id,
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.SUCCESS,
            insw_activity_code: '30',
            insw_request_payload: payload,
            insw_response: inswResponse,
          });

          results.push({
            id,
            wms_id: `ID-${id}`,
            status: 'success',
            insw_status: INSWTransmissionStatus.SUCCESS,
            insw_response: inswResponse,
          });
          successCount++;
        }
      } else {
        for (const id of ids) {
          await this.logTransmission({
            transaction_type: 'incoming',
            transaction_id: id,
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '30',
            insw_request_payload: payload,
            insw_response: inswResponse,
            insw_error: inswResponse.message,
          });

          results.push({
            id,
            wms_id: `ID-${id}`,
            status: 'failed',
            insw_status: INSWTransmissionStatus.FAILED,
            error: inswResponse.message,
          });
          failedCount++;
        }
      }

      return {
        status: successCount > 0 ? 'success' : 'failed',
        message:
          successCount > 0
            ? 'Data successfully transmitted to INSW'
            : 'Failed to transmit data to INSW',
        total: ids.length,
        success_count: successCount,
        failed_count: failedCount,
        skipped_count: 0,
        results,
      };
    } catch (error: any) {
      this.log.error('Error transmitting to INSW', { error: error.message });

      for (const id of ids) {
        await this.logTransmission({
          transaction_type: 'incoming',
          transaction_id: id,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '30',
          insw_error: error.message,
        });

        results.push({
          id,
          wms_id: `ID-${id}`,
          status: 'failed',
          insw_status: INSWTransmissionStatus.FAILED,
          error: error.message,
        });
      }

      return {
        status: 'failed',
        message: error.message,
        total: ids.length,
        success_count: 0,
        failed_count: ids.length,
        skipped_count: 0,
        results,
      };
    }
  }

  /**
   * Transmit outgoing goods by IDs to INSW
   */
  async transmitOutgoingGoodsByIds(
    companyCode: number,
    ids: number[]
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting outgoing goods transmission by IDs', {
      companyCode,
      ids,
    });

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      const payload = await this.inswService.convertPengeluaranToINSWByIds(
        companyCode,
        ids
      );

      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        for (const id of ids) {
          await this.logTransmission({
            transaction_type: 'outgoing',
            transaction_id: id,
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '31',
            insw_request_payload: payload,
            insw_error: validation.errors.join('; '),
          });

          results.push({
            id,
            wms_id: `ID-${id}`,
            status: 'failed',
            insw_status: INSWTransmissionStatus.FAILED,
            error: validation.errors.join('; '),
          });
          failedCount++;
        }

        return {
          status: 'failed',
          message: 'Validation failed',
          total: ids.length,
          success_count: 0,
          failed_count: failedCount,
          skipped_count: 0,
          results,
        };
      }

      const inswResponse = await this.inswService.postPengeluaran(payload);

      if (inswResponse.status) {
        for (const id of ids) {
          await this.logTransmission({
            transaction_type: 'outgoing',
            transaction_id: id,
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.SUCCESS,
            insw_activity_code: '31',
            insw_request_payload: payload,
            insw_response: inswResponse,
          });

          results.push({
            id,
            wms_id: `ID-${id}`,
            status: 'success',
            insw_status: INSWTransmissionStatus.SUCCESS,
            insw_response: inswResponse,
          });
          successCount++;
        }
      } else {
        for (const id of ids) {
          await this.logTransmission({
            transaction_type: 'outgoing',
            transaction_id: id,
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '31',
            insw_request_payload: payload,
            insw_response: inswResponse,
            insw_error: inswResponse.message,
          });

          results.push({
            id,
            wms_id: `ID-${id}`,
            status: 'failed',
            insw_status: INSWTransmissionStatus.FAILED,
            error: inswResponse.message,
          });
          failedCount++;
        }
      }

      return {
        status: successCount > 0 ? 'success' : 'failed',
        message:
          successCount > 0
            ? 'Data successfully transmitted to INSW'
            : 'Failed to transmit data to INSW',
        total: ids.length,
        success_count: successCount,
        failed_count: failedCount,
        skipped_count: 0,
        results,
      };
    } catch (error: any) {
      this.log.error('Error transmitting to INSW', { error: error.message });

      for (const id of ids) {
        await this.logTransmission({
          transaction_type: 'outgoing',
          transaction_id: id,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '31',
          insw_error: error.message,
        });

        results.push({
          id,
          wms_id: `ID-${id}`,
          status: 'failed',
          insw_status: INSWTransmissionStatus.FAILED,
          error: error.message,
        });
      }

      return {
        status: 'failed',
        message: error.message,
        total: ids.length,
        success_count: 0,
        failed_count: ids.length,
        skipped_count: 0,
        results,
      };
    }
  }

  /**
   * Transmit outgoing goods by WMS IDs to INSW
   */
  async transmitOutgoingGoodsByWmsIds(
    companyCode: number,
    wmsIds: string[]
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting outgoing goods transmission by WMS IDs', {
      companyCode,
      wmsIds,
    });

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      const payload =
        await this.inswService.convertPengeluaranToINSWByWmsIds(
          companyCode,
          wmsIds
        );

      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        for (const wmsId of wmsIds) {
          await this.logTransmission({
            transaction_type: 'outgoing',
            wms_id: wmsId,
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '31',
            insw_request_payload: payload,
            insw_error: validation.errors.join('; '),
          });

          results.push({
            id: 0,
            wms_id: wmsId,
            status: 'failed',
            insw_status: INSWTransmissionStatus.FAILED,
            error: validation.errors.join('; '),
          });
          failedCount++;
        }

        return {
          status: 'failed',
          message: 'Validation failed',
          total: wmsIds.length,
          success_count: 0,
          failed_count: failedCount,
          skipped_count: 0,
          results,
        };
      }

      const inswResponse = await this.inswService.postPengeluaran(payload);

      if (inswResponse.status) {
        for (const wmsId of wmsIds) {
          await this.logTransmission({
            transaction_type: 'outgoing',
            wms_id: wmsId,
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.SUCCESS,
            insw_activity_code: '31',
            insw_request_payload: payload,
            insw_response: inswResponse,
          });

          results.push({
            id: 0,
            wms_id: wmsId,
            status: 'success',
            insw_status: INSWTransmissionStatus.SUCCESS,
            insw_response: inswResponse,
          });
          successCount++;
        }
      } else {
        for (const wmsId of wmsIds) {
          await this.logTransmission({
            transaction_type: 'outgoing',
            wms_id: wmsId,
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '31',
            insw_request_payload: payload,
            insw_response: inswResponse,
            insw_error: inswResponse.message,
          });

          results.push({
            id: 0,
            wms_id: wmsId,
            status: 'failed',
            insw_status: INSWTransmissionStatus.FAILED,
            error: inswResponse.message,
          });
          failedCount++;
        }
      }

      return {
        status: successCount > 0 ? 'success' : 'failed',
        message:
          successCount > 0
            ? 'Data successfully transmitted to INSW'
            : 'Failed to transmit data to INSW',
        total: wmsIds.length,
        success_count: successCount,
        failed_count: failedCount,
        skipped_count: 0,
        results,
      };
    } catch (error: any) {
      this.log.error('Error transmitting to INSW', { error: error.message });

      for (const wmsId of wmsIds) {
        await this.logTransmission({
          transaction_type: 'outgoing',
          wms_id: wmsId,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '31',
          insw_error: error.message,
        });

        results.push({
          id: 0,
          wms_id: wmsId,
          status: 'failed',
          insw_status: INSWTransmissionStatus.FAILED,
          error: error.message,
        });
      }

      return {
        status: 'failed',
        message: error.message,
        total: wmsIds.length,
        success_count: 0,
        failed_count: wmsIds.length,
        skipped_count: 0,
        results,
      };
    }
  }

  /**
   * Transmit material usage to INSW
   */
  async transmitMaterialUsage(
    companyCode: number,
    ids: number[],
    wmsIds: string[]
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting material usage transmission', { companyCode, ids });

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      // Convert to INSW format
      const payload = await this.inswService.convertMaterialUsageToINSW(
        companyCode,
        ids
      );

      // Validate payload
      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        this.log.error('Validation failed', { errors: validation.errors });

        // Log each failed record
        for (let i = 0; i < ids.length; i++) {
          await this.logTransmission({
            transaction_type: 'material_usage',
            transaction_id: ids[i],
            wms_id: wmsIds[i],
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '31',
            insw_request_payload: payload,
            insw_error: validation.errors.join('; '),
          });

          results.push({
            id: ids[i],
            wms_id: wmsIds[i],
            status: 'failed',
            insw_status: INSWTransmissionStatus.FAILED,
            error: validation.errors.join('; '),
          });
          failedCount++;
        }

        return {
          status: 'failed',
          message: 'Validation failed',
          total: ids.length,
          success_count: 0,
          failed_count: failedCount,
          skipped_count: 0,
          results,
        };
      }

      // Send to INSW
      const inswResponse = await this.inswService.postPengeluaran(payload);

      // Process response
      if (inswResponse.status) {
        for (let i = 0; i < ids.length; i++) {
          await this.logTransmission({
            transaction_type: 'material_usage',
            transaction_id: ids[i],
            wms_id: wmsIds[i],
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.SUCCESS,
            insw_activity_code: '31',
            insw_request_payload: payload,
            insw_response: inswResponse,
          });

          results.push({
            id: ids[i],
            wms_id: wmsIds[i],
            status: 'success',
            insw_status: INSWTransmissionStatus.SUCCESS,
            insw_response: inswResponse,
          });
          successCount++;
        }
      } else {
        for (let i = 0; i < ids.length; i++) {
          await this.logTransmission({
            transaction_type: 'material_usage',
            transaction_id: ids[i],
            wms_id: wmsIds[i],
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '31',
            insw_request_payload: payload,
            insw_response: inswResponse,
            insw_error: inswResponse.message,
          });

          results.push({
            id: ids[i],
            wms_id: wmsIds[i],
            status: 'failed',
            insw_status: INSWTransmissionStatus.FAILED,
            error: inswResponse.message,
          });
          failedCount++;
        }
      }

      return {
        status: successCount > 0 ? 'success' : 'failed',
        message:
          successCount > 0
            ? 'Material usage successfully transmitted to INSW'
            : 'Failed to transmit material usage to INSW',
        total: ids.length,
        success_count: successCount,
        failed_count: failedCount,
        skipped_count: 0,
        results,
      };
    } catch (error: any) {
      this.log.error('Error transmitting material usage to INSW', {
        error: error.message,
      });

      for (let i = 0; i < ids.length; i++) {
        await this.logTransmission({
          transaction_type: 'material_usage',
          transaction_id: ids[i],
          wms_id: wmsIds[i],
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '31',
          insw_error: error.message,
        });

        results.push({
          id: ids[i],
          wms_id: wmsIds[i],
          status: 'failed',
          insw_status: INSWTransmissionStatus.FAILED,
          error: error.message,
        });
      }

      return {
        status: 'failed',
        message: error.message,
        total: ids.length,
        success_count: 0,
        failed_count: ids.length,
        skipped_count: 0,
        results,
      };
    }
  }

  /**
   * Transmit production output to INSW
   */
  async transmitProductionOutput(
    companyCode: number,
    ids: number[],
    wmsIds: string[]
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting production output transmission', {
      companyCode,
      ids,
    });

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      // Convert to INSW format
      const payload = await this.inswService.convertProductionOutputToINSW(
        companyCode,
        ids
      );

      // Validate payload
      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        this.log.error('Validation failed', { errors: validation.errors });

        // Log each failed record
        for (let i = 0; i < ids.length; i++) {
          await this.logTransmission({
            transaction_type: 'production_output',
            transaction_id: ids[i],
            wms_id: wmsIds[i],
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '30',
            insw_request_payload: payload,
            insw_error: validation.errors.join('; '),
          });

          results.push({
            id: ids[i],
            wms_id: wmsIds[i],
            status: 'failed',
            insw_status: INSWTransmissionStatus.FAILED,
            error: validation.errors.join('; '),
          });
          failedCount++;
        }

        return {
          status: 'failed',
          message: 'Validation failed',
          total: ids.length,
          success_count: 0,
          failed_count: failedCount,
          skipped_count: 0,
          results,
        };
      }

      // Send to INSW
      const inswResponse = await this.inswService.postPemasukan(payload);

      // Process response
      if (inswResponse.status) {
        for (let i = 0; i < ids.length; i++) {
          await this.logTransmission({
            transaction_type: 'production_output',
            transaction_id: ids[i],
            wms_id: wmsIds[i],
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.SUCCESS,
            insw_activity_code: '30',
            insw_request_payload: payload,
            insw_response: inswResponse,
          });

          results.push({
            id: ids[i],
            wms_id: wmsIds[i],
            status: 'success',
            insw_status: INSWTransmissionStatus.SUCCESS,
            insw_response: inswResponse,
          });
          successCount++;
        }
      } else {
        for (let i = 0; i < ids.length; i++) {
          await this.logTransmission({
            transaction_type: 'production_output',
            transaction_id: ids[i],
            wms_id: wmsIds[i],
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '30',
            insw_request_payload: payload,
            insw_response: inswResponse,
            insw_error: inswResponse.message,
          });

          results.push({
            id: ids[i],
            wms_id: wmsIds[i],
            status: 'failed',
            insw_status: INSWTransmissionStatus.FAILED,
            error: inswResponse.message,
          });
          failedCount++;
        }
      }

      return {
        status: successCount > 0 ? 'success' : 'failed',
        message:
          successCount > 0
            ? 'Production output successfully transmitted to INSW'
            : 'Failed to transmit production output to INSW',
        total: ids.length,
        success_count: successCount,
        failed_count: failedCount,
        skipped_count: 0,
        results,
      };
    } catch (error: any) {
      this.log.error('Error transmitting production output to INSW', {
        error: error.message,
      });

      for (let i = 0; i < ids.length; i++) {
        await this.logTransmission({
          transaction_type: 'production_output',
          transaction_id: ids[i],
          wms_id: wmsIds[i],
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '30',
          insw_error: error.message,
        });

        results.push({
          id: ids[i],
          wms_id: wmsIds[i],
          status: 'failed',
          insw_status: INSWTransmissionStatus.FAILED,
          error: error.message,
        });
      }

      return {
        status: 'failed',
        message: error.message,
        total: ids.length,
        success_count: 0,
        failed_count: ids.length,
        skipped_count: 0,
        results,
      };
    }
  }

  /**
   * Log transmission attempt to insw_tracking_log table
   */
  private async logTransmission(data: {
    transaction_type: string;
    transaction_id?: number;
    wms_id?: string;
    company_code: number;
    insw_status: INSWTransmissionStatus;
    insw_activity_code: string;
    insw_request_payload?: any;
    insw_response?: any;
    insw_error?: string;
    metadata?: any;
  }) {
    try {
      await prisma.insw_tracking_log.create({
        data: {
          transaction_type: data.transaction_type,
          transaction_id: data.transaction_id,
          wms_id: data.wms_id,
          company_code: data.company_code,
          insw_status: data.insw_status,
          insw_activity_code: data.insw_activity_code,
          insw_request_payload: data.insw_request_payload || null,
          insw_response: data.insw_response || null,
          insw_error: data.insw_error || null,
          sent_at: new Date(),
          retry_count: 0,
          metadata: data.metadata || null,
        },
      });
    } catch (error) {
      this.log.error('Failed to log transmission', { error });
    }
  }

  /**
   * Transmit scrap IN to INSW (via INSWIntegrationService, with tracking log)
   */
  async transmitScrapIn(
    companyCode: number,
    transactionIds: number[]
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting scrap IN transmission', { companyCode, transactionIds });

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      const payload = await this.inswService.convertScrapInToINSW(companyCode, transactionIds);

      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        for (const id of transactionIds) {
          await this.logTransmission({
            transaction_type: 'scrap_in',
            transaction_id: id,
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '30',
            insw_request_payload: payload,
            insw_error: validation.errors.join('; '),
          });
          results.push({ id, wms_id: `SCRAP-IN-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: validation.errors.join('; ') });
          failedCount++;
        }
        return { status: 'failed', message: 'Validation failed', total: transactionIds.length, success_count: 0, failed_count: failedCount, skipped_count: 0, results };
      }

      const inswResponse = await this.inswService.postPemasukan(payload);

      if (inswResponse.status) {
        for (const id of transactionIds) {
          await this.logTransmission({ transaction_type: 'scrap_in', transaction_id: id, company_code: companyCode, insw_status: INSWTransmissionStatus.SUCCESS, insw_activity_code: '30', insw_request_payload: payload, insw_response: inswResponse });
          results.push({ id, wms_id: `SCRAP-IN-${id}`, status: 'success', insw_status: INSWTransmissionStatus.SUCCESS, insw_response: inswResponse });
          successCount++;
        }
      } else {
        for (const id of transactionIds) {
          await this.logTransmission({ transaction_type: 'scrap_in', transaction_id: id, company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '30', insw_request_payload: payload, insw_response: inswResponse, insw_error: inswResponse.message });
          results.push({ id, wms_id: `SCRAP-IN-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: inswResponse.message });
          failedCount++;
        }
      }

      return { status: successCount > 0 ? 'success' : 'failed', message: successCount > 0 ? 'Scrap IN transmitted to INSW' : 'Failed to transmit scrap IN', total: transactionIds.length, success_count: successCount, failed_count: failedCount, skipped_count: 0, results };
    } catch (error: any) {
      this.log.error('Error transmitting scrap IN', { error: error.message });
      for (const id of transactionIds) {
        await this.logTransmission({ transaction_type: 'scrap_in', transaction_id: id, company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '30', insw_error: error.message });
        results.push({ id, wms_id: `SCRAP-IN-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: error.message });
      }
      return { status: 'failed', message: error.message, total: transactionIds.length, success_count: 0, failed_count: transactionIds.length, skipped_count: 0, results };
    }
  }

  /**
   * Transmit scrap OUT to INSW (via INSWIntegrationService, with tracking log)
   */
  async transmitScrapOut(
    companyCode: number,
    transactionIds: number[]
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting scrap OUT transmission', { companyCode, transactionIds });

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      const payload = await this.inswService.convertScrapOutToINSW(companyCode, transactionIds);

      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        for (const id of transactionIds) {
          await this.logTransmission({ transaction_type: 'scrap_out', transaction_id: id, company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '31', insw_request_payload: payload, insw_error: validation.errors.join('; ') });
          results.push({ id, wms_id: `SCRAP-OUT-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: validation.errors.join('; ') });
          failedCount++;
        }
        return { status: 'failed', message: 'Validation failed', total: transactionIds.length, success_count: 0, failed_count: failedCount, skipped_count: 0, results };
      }

      const inswResponse = await this.inswService.postPengeluaran(payload);

      if (inswResponse.status) {
        for (const id of transactionIds) {
          await this.logTransmission({ transaction_type: 'scrap_out', transaction_id: id, company_code: companyCode, insw_status: INSWTransmissionStatus.SUCCESS, insw_activity_code: '31', insw_request_payload: payload, insw_response: inswResponse });
          results.push({ id, wms_id: `SCRAP-OUT-${id}`, status: 'success', insw_status: INSWTransmissionStatus.SUCCESS, insw_response: inswResponse });
          successCount++;
        }
      } else {
        for (const id of transactionIds) {
          await this.logTransmission({ transaction_type: 'scrap_out', transaction_id: id, company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '31', insw_request_payload: payload, insw_response: inswResponse, insw_error: inswResponse.message });
          results.push({ id, wms_id: `SCRAP-OUT-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: inswResponse.message });
          failedCount++;
        }
      }

      return { status: successCount > 0 ? 'success' : 'failed', message: successCount > 0 ? 'Scrap OUT transmitted to INSW' : 'Failed to transmit scrap OUT', total: transactionIds.length, success_count: successCount, failed_count: failedCount, skipped_count: 0, results };
    } catch (error: any) {
      this.log.error('Error transmitting scrap OUT', { error: error.message });
      for (const id of transactionIds) {
        await this.logTransmission({ transaction_type: 'scrap_out', transaction_id: id, company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '31', insw_error: error.message });
        results.push({ id, wms_id: `SCRAP-OUT-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: error.message });
      }
      return { status: 'failed', message: error.message, total: transactionIds.length, success_count: 0, failed_count: transactionIds.length, skipped_count: 0, results };
    }
  }

  /**
   * Transmit capital goods OUT to INSW (via INSWIntegrationService, with tracking log)
   */
  async transmitCapitalGoodsOut(
    companyCode: number,
    wmsIds: string[]
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting capital goods OUT transmission', { companyCode, wmsIds });

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      const payload = await this.inswService.convertCapitalGoodsOutToINSWByWmsIds(companyCode, wmsIds);

      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        for (const wmsId of wmsIds) {
          await this.logTransmission({ transaction_type: 'capital_goods_out', wms_id: wmsId, company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '31', insw_request_payload: payload, insw_error: validation.errors.join('; ') });
          results.push({ id: 0, wms_id: wmsId, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: validation.errors.join('; ') });
          failedCount++;
        }
        return { status: 'failed', message: 'Validation failed', total: wmsIds.length, success_count: 0, failed_count: failedCount, skipped_count: 0, results };
      }

      const inswResponse = await this.inswService.postPengeluaran(payload);

      if (inswResponse.status) {
        for (const wmsId of wmsIds) {
          await this.logTransmission({ transaction_type: 'capital_goods_out', wms_id: wmsId, company_code: companyCode, insw_status: INSWTransmissionStatus.SUCCESS, insw_activity_code: '31', insw_request_payload: payload, insw_response: inswResponse });
          results.push({ id: 0, wms_id: wmsId, status: 'success', insw_status: INSWTransmissionStatus.SUCCESS, insw_response: inswResponse });
          successCount++;
        }
      } else {
        for (const wmsId of wmsIds) {
          await this.logTransmission({ transaction_type: 'capital_goods_out', wms_id: wmsId, company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '31', insw_request_payload: payload, insw_response: inswResponse, insw_error: inswResponse.message });
          results.push({ id: 0, wms_id: wmsId, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: inswResponse.message });
          failedCount++;
        }
      }

      return { status: successCount > 0 ? 'success' : 'failed', message: successCount > 0 ? 'Capital goods OUT transmitted to INSW' : 'Failed to transmit capital goods OUT', total: wmsIds.length, success_count: successCount, failed_count: failedCount, skipped_count: 0, results };
    } catch (error: any) {
      this.log.error('Error transmitting capital goods OUT', { error: error.message });
      for (const wmsId of wmsIds) {
        await this.logTransmission({ transaction_type: 'capital_goods_out', wms_id: wmsId, company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '31', insw_error: error.message });
        results.push({ id: 0, wms_id: wmsId, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: error.message });
      }
      return { status: 'failed', message: error.message, total: wmsIds.length, success_count: 0, failed_count: wmsIds.length, skipped_count: 0, results };
    }
  }

  /**
   * Transmit saldo awal (beginning balance) to INSW and update status
   */
  async transmitSaldoAwal(
    companyCode: number
  ): Promise<{ status: string; message: string; insw_response?: any }> {
    this.log.info('Starting saldo awal transmission', { companyCode });

    try {
      const payload = await this.inswService.convertSaldoAwalToINSW(companyCode);

      const inswResponse = await this.inswService.postSaldoAwal(payload);

      if (inswResponse.status) {
        await prisma.beginning_balances.updateMany({
          where: { company_code: companyCode, status: 'OPEN', deleted_at: null },
          data: { status: 'TRANSMITTED_TO_INSW' },
        });

        await this.logTransmission({
          transaction_type: 'saldo_awal',
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.SUCCESS,
          insw_activity_code: '30',
          insw_request_payload: payload,
          insw_response: inswResponse,
        });

        return { status: 'success', message: 'Saldo awal transmitted to INSW successfully', insw_response: inswResponse };
      } else {
        await this.logTransmission({
          transaction_type: 'saldo_awal',
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '30',
          insw_request_payload: payload,
          insw_response: inswResponse,
          insw_error: inswResponse.message,
        });

        return { status: 'failed', message: inswResponse.message || 'Failed to transmit saldo awal', insw_response: inswResponse };
      }
    } catch (error: any) {
      this.log.error('Error transmitting saldo awal', { error: error.message });

      await this.logTransmission({
        transaction_type: 'saldo_awal',
        company_code: companyCode,
        insw_status: INSWTransmissionStatus.FAILED,
        insw_activity_code: '30',
        insw_error: error.message,
      });

      return { status: 'failed', message: error.message };
    }
  }

  /**
   * Lock saldo awal (registrasi final) and update status to LOCKED
   */
  async lockSaldoAwal(
    companyCode: number
  ): Promise<{ status: string; message: string; insw_response?: any }> {
    this.log.info('Starting saldo awal lock (registrasi final)', { companyCode });

    try {
      const inswResponse = await this.inswService.registrasiFinal();

      if (inswResponse.status) {
        await prisma.beginning_balances.updateMany({
          where: { company_code: companyCode, deleted_at: null },
          data: { status: 'LOCKED' },
        });

        await this.logTransmission({
          transaction_type: 'saldo_awal_final',
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.SUCCESS,
          insw_activity_code: '30',
          insw_response: inswResponse,
        });

        return { status: 'success', message: 'Saldo awal locked (registrasi final) successfully', insw_response: inswResponse };
      } else {
        await this.logTransmission({
          transaction_type: 'saldo_awal_final',
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '30',
          insw_response: inswResponse,
          insw_error: inswResponse.message,
        });

        return { status: 'failed', message: inswResponse.message || 'Failed to lock saldo awal', insw_response: inswResponse };
      }
    } catch (error: any) {
      this.log.error('Error locking saldo awal', { error: error.message });

      await this.logTransmission({
        transaction_type: 'saldo_awal_final',
        company_code: companyCode,
        insw_status: INSWTransmissionStatus.FAILED,
        insw_activity_code: '30',
        insw_error: error.message,
      });

      return { status: 'failed', message: error.message };
    }
  }

  /**
   * Get transmission logs
   */
  async getTransmissionLogs(filters: {
    company_code: number;
    transaction_type?: string;
    insw_status?: string;
    limit?: number;
  }) {
    return await prisma.insw_tracking_log.findMany({
      where: {
        company_code: filters.company_code,
        ...(filters.transaction_type && {
          transaction_type: filters.transaction_type,
        }),
        ...(filters.insw_status && { insw_status: filters.insw_status }),
      },
      orderBy: {
        created_at: 'desc',
      },
      take: filters.limit || 100,
    });
  }
}
