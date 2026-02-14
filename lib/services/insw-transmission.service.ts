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
