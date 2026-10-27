import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { excludeTechnicalScrapClaims } from '@/lib/insw-log-visibility';
import { INSWHelper } from '@/lib/utils/insw-helper';
import {
  INSWTransmissionStatus,
  INSWTransmitResult,
  INSWTransmitResponse,
} from '@/lib/types/insw-transmission.types';
import { INSWActivityCode, INSW_ENDPOINTS, type INSWTransaksiPayload } from '@/lib/types/insw-api.types';
import { logger } from '@/lib/utils/logger';
import { resolveInswCompanyNpwp } from '@/lib/config/insw-company-config';
import { createInswIntegrationService, createInswPayloadConverter } from '@/lib/services/insw-service.factory';

export interface ScrapTransmissionAttempt {
  trackingLogId: bigint;
  metadata: Record<string, unknown>;
}

export interface ScrapTransmissionContext {
  attempts: ReadonlyMap<number, ScrapTransmissionAttempt>;
}

export class INSWTransmissionService {
  private log = logger.child({ service: 'INSWTransmissionService' });

  private getEndpointUrl(transactionType: string, companyCode: number): string | null {
    if (transactionType === 'insw_cleanup') {
      return INSW_ENDPOINTS.transaksi.temp;
    }

    const modeValue = process.env[`INSW_${companyCode}_USE_TEST_MODE`];
    if (modeValue !== 'true' && modeValue !== 'false') {
      return null;
    }

    const useTestMode = modeValue === 'true';

    if (transactionType === 'saldo_awal') {
      return useTestMode
        ? INSW_ENDPOINTS.saldoAwal.temp
        : INSW_ENDPOINTS.saldoAwal.real;
    }
    return useTestMode
      ? INSW_ENDPOINTS.transaksi.temp
      : INSW_ENDPOINTS.transaksi.real;
  }

  /**
   * Check if a specific INSW endpoint is enabled in settings
   */
  private async isEndpointEnabled(key: string): Promise<boolean> {
    try {
      const rows = await prisma.$queryRaw<Array<{ is_enabled: boolean }>>`
        SELECT is_enabled FROM insw_integration_settings WHERE endpoint_key = ${key} LIMIT 1
      `;
      return rows.length > 0 ? rows[0].is_enabled : true;
    } catch {
      return true;
    }
  }

  /**
   * Transmit incoming goods to INSW
   */
  async transmitIncomingGoods(
    companyCode: number,
    ids: number[],
    skipEndpointCheck: boolean = false
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting incoming goods transmission', { companyCode, ids, skipEndpointCheck });
    const converter = createInswPayloadConverter();

    let payload: any = null;

    // Fetch incoming goods WMS IDs early (needed for all cases including endpoint disabled)
    let incomingDocMap = new Map<number, string>();
    try {
      const incomingDocs = await prisma.$queryRaw<Array<{
        id: number;
        wms_id: string;
      }>>`
        SELECT id, wms_id
        FROM incoming_goods
        WHERE company_code = ${companyCode}
          AND id = ANY(${ids}::int[])
      `;
      incomingDocMap = new Map(incomingDocs.map(r => [Number(r.id), r.wms_id]));
    } catch { /* fallback to empty map */ }

    try {
      payload = await converter.convertPemasukanToINSW(companyCode, ids);
    } catch { /* payload remains null if generation fails */ }

    if (!skipEndpointCheck && !(await this.isEndpointEnabled('PEMASUKAN'))) {
      for (const id of ids) {
        await this.logTransmission({
          transaction_type: 'incoming',
          transaction_id: id,
          wms_id: incomingDocMap.get(id),
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.PENDING,
          insw_activity_code: '30',
          insw_request_payload: payload || undefined,
          insw_error: 'Endpoint dinonaktifkan pada pengaturan integrasi',
        });
      }
      return {
        status: 'success',
        message: 'Transmisi ke INSW dinonaktifkan untuk endpoint ini',
        total: ids.length,
        success_count: 0,
        failed_count: 0,
        skipped_count: ids.length,
        results: [],
      };
    }

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      // Convert to INSW format
      if (!payload) payload = await converter.convertPemasukanToINSW(companyCode, ids);

      // Validate payload
      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        this.log.error('Validation failed', { errors: validation.errors });

        // Log each failed record
        for (const id of ids) {
          await this.logTransmission({
            transaction_type: 'incoming',
            transaction_id: id,
            wms_id: incomingDocMap.get(id),
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '30',
            insw_request_payload: payload,
            insw_error: validation.errors.join('; '),
          });

          results.push({
            id,
            wms_id: incomingDocMap.get(id) || `ID-${id}`,
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
      const inswService = createInswIntegrationService(companyCode);
      const inswResponse = await inswService.postPemasukan(payload);

      // Process response
      if (inswResponse.status) {
        for (const id of ids) {
          await this.logTransmission({
            transaction_type: 'incoming',
            transaction_id: id,
            wms_id: incomingDocMap.get(id),
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.SUCCESS,
            insw_activity_code: '30',
            insw_request_payload: payload,
            insw_response: inswResponse,
          });

          results.push({
            id,
            wms_id: incomingDocMap.get(id) || `ID-${id}`,
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
            wms_id: incomingDocMap.get(id),
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '30',
            insw_request_payload: payload,
            insw_response: inswResponse,
            insw_error: inswResponse.message,
          });

          results.push({
            id,
            wms_id: incomingDocMap.get(id) || `ID-${id}`,
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
          wms_id: incomingDocMap.get(id),
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '30',
          insw_error: error.message,
        });

        results.push({
          id,
          wms_id: incomingDocMap.get(id) || `ID-${id}`,
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
    ids: number[],
    skipEndpointCheck: boolean = false
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting outgoing goods transmission by IDs', {
      companyCode,
      ids,
      skipEndpointCheck,
    });
    const converter = createInswPayloadConverter();

    let payload: any = null;
    try {
      payload = await converter.convertPengeluaranToINSWByIds(companyCode, ids);
    } catch { /* payload remains null if generation fails */ }

    if (!skipEndpointCheck && !(await this.isEndpointEnabled('PENGELUARAN'))) {
      for (const id of ids) {
        await this.logTransmission({
          transaction_type: 'outgoing',
          transaction_id: id,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.PENDING,
          insw_activity_code: '31',
          insw_request_payload: payload || undefined,
          insw_error: 'Endpoint dinonaktifkan pada pengaturan integrasi',
        });
      }
      return {
        status: 'success',
        message: 'Transmisi ke INSW dinonaktifkan untuk endpoint ini',
        total: ids.length,
        success_count: 0,
        failed_count: 0,
        skipped_count: ids.length,
        results: [],
      };
    }

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      if (!payload) payload = await converter.convertPengeluaranToINSWByIds(companyCode, ids);

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

      const inswService = createInswIntegrationService(companyCode);
      const inswResponse = await inswService.postPengeluaran(payload);

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
    wmsIds: string[],
    skipEndpointCheck: boolean = false
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting outgoing goods transmission by WMS IDs', {
      companyCode,
      wmsIds,
      skipEndpointCheck,
    });
    const converter = createInswPayloadConverter();

    let payload: any = null;
    try {
      payload = await converter.convertPengeluaranToINSWByWmsIds(companyCode, wmsIds);
    } catch { /* payload remains null if generation fails */ }

    if (!skipEndpointCheck && !(await this.isEndpointEnabled('PENGELUARAN'))) {
      for (const wmsId of wmsIds) {
        await this.logTransmission({
          transaction_type: 'outgoing',
          wms_id: wmsId,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.PENDING,
          insw_activity_code: '31',
          insw_request_payload: payload || undefined,
          insw_error: 'Endpoint dinonaktifkan pada pengaturan integrasi',
        });
      }
      return {
        status: 'success',
        message: 'Transmisi ke INSW dinonaktifkan untuk endpoint ini',
        total: wmsIds.length,
        success_count: 0,
        failed_count: 0,
        skipped_count: wmsIds.length,
        results: [],
      };
    }

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      if (!payload) payload = await converter.convertPengeluaranToINSWByWmsIds(companyCode, wmsIds);

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

      const inswService = createInswIntegrationService(companyCode);
      const inswResponse = await inswService.postPengeluaran(payload);

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

  /** Transmit a single reversal-aware Material Usage or Production Output transaction. */
  private async transmitReversalAware(
    companyCode: number,
    ids: number[],
    wmsIds: string[],
    skipEndpointCheck: boolean,
    transactionType: 'material_usage' | 'production_output',
    settingKey: 'MATERIAL_USAGE' | 'PRODUCTION_OUTPUT',
    convert: () => Promise<INSWTransaksiPayload>
  ): Promise<INSWTransmitResponse> {
    let payload: INSWTransaksiPayload | null = null;
    let conversionError: unknown;
    try {
      payload = await convert();
    } catch (error) {
      conversionError = error;
    }

    const id = ids[0];
    const wmsId = wmsIds[0];
    const activity = payload?.data[0]?.kdKegiatan || '';
    const responseFor = (success: boolean, message: string, response?: unknown): INSWTransmitResponse => ({
      status: success ? 'success' : 'failed',
      message: success
        ? `${transactionType === 'material_usage' ? 'Material usage' : 'Production output'} successfully transmitted to INSW`
        : message,
      total: 1,
      success_count: success ? 1 : 0,
      failed_count: success ? 0 : 1,
      skipped_count: 0,
      results: [{
        id,
        wms_id: wmsId,
        status: success ? 'success' : 'failed',
        insw_status: success ? INSWTransmissionStatus.SUCCESS : INSWTransmissionStatus.FAILED,
        ...(success ? { insw_response: response } : { error: message }),
      }],
    });
    const logResult = async (
      status: INSWTransmissionStatus,
      request?: INSWTransaksiPayload,
      response?: unknown,
      error?: string
    ) => {
      await this.logTransmission({
        transaction_type: transactionType,
        transaction_id: id,
        wms_id: wmsId,
        company_code: companyCode,
        insw_status: status,
        insw_activity_code: activity,
        insw_request_payload: request,
        insw_response: response,
        insw_error: error,
      });
    };

    if (!skipEndpointCheck && !(await this.isEndpointEnabled(settingKey))) {
      await logResult(INSWTransmissionStatus.PENDING, payload || undefined, undefined,
        'Endpoint dinonaktifkan pada pengaturan integrasi');
      return {
        status: 'success',
        message: 'Transmisi ke INSW dinonaktifkan untuk endpoint ini',
        total: 1,
        success_count: 0,
        failed_count: 0,
        skipped_count: 1,
        results: [],
      };
    }

    if (!payload) {
      const message = conversionError instanceof Error ? conversionError.message : 'INSW payload conversion failed';
      this.log.error('Error converting transaction to INSW', { transactionType, error: message });
      await logResult(INSWTransmissionStatus.FAILED, undefined, undefined, message);
      return responseFor(false, message);
    } else {
      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        const message = validation.errors.join('; ');
        this.log.error('Validation failed', { errors: validation.errors });
        await logResult(INSWTransmissionStatus.FAILED, payload, undefined, message);
        return responseFor(false, 'Validation failed');
      }

      try {
        const service = createInswIntegrationService(companyCode);
        const response = activity === INSWActivityCode.PEMASUKAN
          ? await service.postPemasukan(payload)
          : activity === INSWActivityCode.PENGELUARAN
            ? await service.postPengeluaran(payload)
            : (() => { throw new Error(`Unsupported INSW activity: ${activity}`); })();
        await logResult(
          response.status ? INSWTransmissionStatus.SUCCESS : INSWTransmissionStatus.FAILED,
          payload, response, response.status ? undefined : response.message
        );
        return responseFor(
          response.status,
          `Failed to transmit ${transactionType === 'material_usage' ? 'material usage' : 'production output'} to INSW`,
          response
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log.error('Error transmitting transaction to INSW', { transactionType, error: message });
        await logResult(INSWTransmissionStatus.FAILED, payload, undefined, message);
        return responseFor(false, message);
      }
    }
  }

  async transmitMaterialUsage(
    companyCode: number,
    ids: number[],
    wmsIds: string[],
    skipEndpointCheck: boolean = false
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting material usage transmission', { companyCode, ids, skipEndpointCheck });
    const converter = createInswPayloadConverter();
    return this.transmitReversalAware(companyCode, ids, wmsIds, skipEndpointCheck,
      'material_usage', 'MATERIAL_USAGE',
      () => converter.convertMaterialUsageToINSW(companyCode, ids));
  }

  async transmitProductionOutput(
    companyCode: number,
    ids: number[],
    wmsIds: string[],
    skipEndpointCheck: boolean = false
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting production output transmission', { companyCode, ids, skipEndpointCheck });
    const converter = createInswPayloadConverter();
    return this.transmitReversalAware(companyCode, ids, wmsIds, skipEndpointCheck,
      'production_output', 'PRODUCTION_OUTPUT',
      () => converter.convertProductionOutputToINSW(companyCode, ids));
  }

  async transmitAdjustment(
    companyCode: number,
    adjustmentId: number,
    wmsId: string,
    skipEndpointCheck: boolean = false
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting adjustment transmission', { companyCode, adjustmentId, wmsId, skipEndpointCheck });
    const converter = createInswPayloadConverter();

    let payload: any = null;
    try {
      payload = await converter.convertAdjustmentToINSW(companyCode, adjustmentId);
    } catch { /* payload remains null if generation fails */ }

    if (!skipEndpointCheck && !(await this.isEndpointEnabled('ADJUSTMENT'))) {
      await this.logTransmission({
        transaction_type: 'adjustment',
        transaction_id: adjustmentId,
        wms_id: wmsId,
        company_code: companyCode,
        insw_status: INSWTransmissionStatus.PENDING,
        insw_activity_code: '33',
        insw_request_payload: payload || undefined,
        insw_error: 'Endpoint dinonaktifkan pada pengaturan integrasi',
      });
      return {
        status: 'success',
        message: 'Transmisi ke INSW dinonaktifkan untuk endpoint ini',
        total: 1,
        success_count: 0,
        failed_count: 0,
        skipped_count: 1,
        results: [],
      };
    }

    const results: INSWTransmitResult[] = [];

    try {
      if (!payload) payload = await converter.convertAdjustmentToINSW(companyCode, adjustmentId);

      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        await this.logTransmission({
          transaction_type: 'adjustment',
          transaction_id: adjustmentId,
          wms_id: wmsId,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '33',
          insw_request_payload: payload,
          insw_error: validation.errors.join('; '),
        });
        results.push({ id: adjustmentId, wms_id: wmsId, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: validation.errors.join('; ') });
        return { status: 'failed', message: 'Validation failed', total: 1, success_count: 0, failed_count: 1, skipped_count: 0, results };
      }

      const inswService = createInswIntegrationService(companyCode);
      const inswResponse = await inswService.postAdjustment(payload);

      if (inswResponse.status) {
        await this.logTransmission({
          transaction_type: 'adjustment',
          transaction_id: adjustmentId,
          wms_id: wmsId,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.SUCCESS,
          insw_activity_code: '33',
          insw_request_payload: payload,
          insw_response: inswResponse,
        });
        results.push({ id: adjustmentId, wms_id: wmsId, status: 'success', insw_status: INSWTransmissionStatus.SUCCESS, insw_response: inswResponse });
        return { status: 'success', message: 'Adjustment transmitted to INSW', total: 1, success_count: 1, failed_count: 0, skipped_count: 0, results };
      } else {
        await this.logTransmission({
          transaction_type: 'adjustment',
          transaction_id: adjustmentId,
          wms_id: wmsId,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '33',
          insw_request_payload: payload,
          insw_response: inswResponse,
          insw_error: inswResponse.message,
        });
        results.push({ id: adjustmentId, wms_id: wmsId, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: inswResponse.message });
        return { status: 'failed', message: inswResponse.message || 'Failed to transmit adjustment', total: 1, success_count: 0, failed_count: 1, skipped_count: 0, results };
      }
    } catch (error: any) {
      this.log.error('Error transmitting adjustment', { error: error.message });
      await this.logTransmission({
        transaction_type: 'adjustment',
        transaction_id: adjustmentId,
        wms_id: wmsId,
        company_code: companyCode,
        insw_status: INSWTransmissionStatus.FAILED,
        insw_activity_code: '33',
        insw_error: error.message,
      });
      results.push({ id: adjustmentId, wms_id: wmsId, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: error.message });
      return { status: 'failed', message: error.message, total: 1, success_count: 0, failed_count: 1, skipped_count: 0, results };
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
    existing_tracking_log_id?: bigint;
  }) {
    try {
      const endpointUrl = this.getEndpointUrl(data.transaction_type, data.company_code);
      const logData = {
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
          metadata: {
            ...(data.metadata || {}),
            endpoint_url: endpointUrl,
            ...(data.existing_tracking_log_id ? { claim: false } : {}),
          },
      };

      if (data.existing_tracking_log_id) {
        await prisma.insw_tracking_log.update({
          where: { id: data.existing_tracking_log_id },
          data: logData,
        });
      } else {
        await prisma.insw_tracking_log.create({ data: logData });
      }
    } catch (error) {
      this.log.error('Failed to log transmission', { error });
    }
  }

  private async attachPayloadToScrapAttempts(
    context: ScrapTransmissionContext | undefined,
    payload: any
  ): Promise<void> {
    if (!context || context.attempts.size === 0) return;

    await prisma.insw_tracking_log.updateMany({
      where: {
        id: { in: Array.from(context.attempts.values(), attempt => attempt.trackingLogId) },
        insw_status: INSWTransmissionStatus.PENDING,
      },
      data: { insw_request_payload: payload },
    });
  }

  /**
   * Transmit scrap IN to INSW (via INSWIntegrationService, with tracking log)
   */
  async transmitScrapIn(
    companyCode: number,
    transactionIds: number[],
    skipEndpointCheck: boolean = false,
    context?: ScrapTransmissionContext
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting scrap IN transmission', { companyCode, transactionIds, skipEndpointCheck });
    const converter = createInswPayloadConverter();

    let payload: any = null;
    let payloadError: unknown = null;
    try {
      payload = await converter.convertScrapInToINSW(companyCode, transactionIds);
      await this.attachPayloadToScrapAttempts(context, payload);
    } catch (error) {
      payloadError = error;
    }

    // Fetch scrap documents early (needed for all cases including endpoint disabled)
    let scrapInDocMap = new Map<number, string>();
    try {
      const scrapDocs = await prisma.$queryRaw<Array<{ id: number; document_number: string }>>`
        SELECT id, document_number FROM scrap_transactions WHERE id = ANY(${transactionIds}::int[]) AND deleted_at IS NULL
      `;
      scrapInDocMap = new Map(scrapDocs.map(r => [Number(r.id), r.document_number]));
    } catch { /* fallback to empty map */ }

    if (!skipEndpointCheck && !(await this.isEndpointEnabled('SCRAP_IN'))) {
      for (const id of transactionIds) {
        await this.logTransmission({
          transaction_type: 'scrap_in',
          transaction_id: id,
          wms_id: scrapInDocMap.get(id),
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.PENDING,
          insw_activity_code: '30',
          insw_request_payload: payload || undefined,
          insw_error: 'Endpoint dinonaktifkan pada pengaturan integrasi',
          existing_tracking_log_id: context?.attempts.get(id)?.trackingLogId,
          metadata: context?.attempts.get(id)?.metadata,
        });
      }
      return {
        status: 'success',
        message: 'Transmisi ke INSW dinonaktifkan untuk endpoint ini',
        total: transactionIds.length,
        success_count: 0,
        failed_count: 0,
        skipped_count: transactionIds.length,
        results: [],
      };
    }

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      if (payloadError) throw payloadError;

      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        for (const id of transactionIds) {
          await this.logTransmission({
            transaction_type: 'scrap_in',
            transaction_id: id,
            wms_id: scrapInDocMap.get(id),
            company_code: companyCode,
            insw_status: INSWTransmissionStatus.FAILED,
            insw_activity_code: '30',
            insw_request_payload: payload,
            insw_error: validation.errors.join('; '),
            existing_tracking_log_id: context?.attempts.get(id)?.trackingLogId,
            metadata: context?.attempts.get(id)?.metadata,
          });
          results.push({ id, wms_id: scrapInDocMap.get(id) || `SCRAP-IN-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: validation.errors.join('; ') });
          failedCount++;
        }
        return { status: 'failed', message: 'Validation failed', total: transactionIds.length, success_count: 0, failed_count: failedCount, skipped_count: 0, results };
      }

      const inswService = createInswIntegrationService(companyCode);
      const inswResponse = await inswService.postPemasukan(payload);

      if (inswResponse.status) {
        for (const id of transactionIds) {
          await this.logTransmission({ transaction_type: 'scrap_in', transaction_id: id, wms_id: scrapInDocMap.get(id), company_code: companyCode, insw_status: INSWTransmissionStatus.SUCCESS, insw_activity_code: '30', insw_request_payload: payload, insw_response: inswResponse, existing_tracking_log_id: context?.attempts.get(id)?.trackingLogId, metadata: context?.attempts.get(id)?.metadata });
          results.push({ id, wms_id: scrapInDocMap.get(id) || `SCRAP-IN-${id}`, status: 'success', insw_status: INSWTransmissionStatus.SUCCESS, insw_response: inswResponse });
          successCount++;
        }
      } else {
        for (const id of transactionIds) {
          await this.logTransmission({ transaction_type: 'scrap_in', transaction_id: id, wms_id: scrapInDocMap.get(id), company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '30', insw_request_payload: payload, insw_response: inswResponse, insw_error: inswResponse.message, existing_tracking_log_id: context?.attempts.get(id)?.trackingLogId, metadata: context?.attempts.get(id)?.metadata });
          results.push({ id, wms_id: scrapInDocMap.get(id) || `SCRAP-IN-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: inswResponse.message });
          failedCount++;
        }
      }

      return { status: successCount > 0 ? 'success' : 'failed', message: successCount > 0 ? 'Scrap IN transmitted to INSW' : 'Failed to transmit scrap IN', total: transactionIds.length, success_count: successCount, failed_count: failedCount, skipped_count: 0, results };
    } catch (error: any) {
      this.log.error('Error transmitting scrap IN', { error: error.message });
      for (const id of transactionIds) {
        await this.logTransmission({ transaction_type: 'scrap_in', transaction_id: id, wms_id: scrapInDocMap.get(id), company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '30', insw_request_payload: payload || undefined, insw_error: error.message, existing_tracking_log_id: context?.attempts.get(id)?.trackingLogId, metadata: context?.attempts.get(id)?.metadata });
        results.push({ id, wms_id: scrapInDocMap.get(id) || `SCRAP-IN-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: error.message });
      }
      return { status: 'failed', message: error.message, total: transactionIds.length, success_count: 0, failed_count: transactionIds.length, skipped_count: 0, results };
    }
  }

  /**
   * Transmit scrap OUT to INSW (via INSWIntegrationService, with tracking log)
   */
  async transmitScrapOut(
    companyCode: number,
    transactionIds: number[],
    skipEndpointCheck: boolean = false,
    context?: ScrapTransmissionContext
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting scrap OUT transmission', { companyCode, transactionIds, skipEndpointCheck });
    const converter = createInswPayloadConverter();

    let payload: any = null;
    let payloadError: unknown = null;
    try {
      payload = await converter.convertScrapOutToINSW(companyCode, transactionIds);
      await this.attachPayloadToScrapAttempts(context, payload);
    } catch (error) {
      payloadError = error;
    }

    // Fetch scrap documents early (needed for all cases including endpoint disabled)
    let scrapOutDocMap = new Map<number, string>();
    try {
      const scrapDocs = await prisma.$queryRaw<Array<{ id: number; document_number: string }>>`
        SELECT id, document_number FROM scrap_transactions WHERE id = ANY(${transactionIds}::int[]) AND deleted_at IS NULL
      `;
      scrapOutDocMap = new Map(scrapDocs.map(r => [Number(r.id), r.document_number]));
    } catch { /* fallback to empty map */ }

    if (!skipEndpointCheck && !(await this.isEndpointEnabled('SCRAP_OUT'))) {
      for (const id of transactionIds) {
        await this.logTransmission({
          transaction_type: 'scrap_out',
          transaction_id: id,
          wms_id: scrapOutDocMap.get(id),
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.PENDING,
          insw_activity_code: '31',
          insw_request_payload: payload || undefined,
          insw_error: 'Endpoint dinonaktifkan pada pengaturan integrasi',
          existing_tracking_log_id: context?.attempts.get(id)?.trackingLogId,
          metadata: context?.attempts.get(id)?.metadata,
        });
      }
      return {
        status: 'success',
        message: 'Transmisi ke INSW dinonaktifkan untuk endpoint ini',
        total: transactionIds.length,
        success_count: 0,
        failed_count: 0,
        skipped_count: transactionIds.length,
        results: [],
      };
    }

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      if (payloadError) throw payloadError;

      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        for (const id of transactionIds) {
          await this.logTransmission({ transaction_type: 'scrap_out', transaction_id: id, wms_id: scrapOutDocMap.get(id), company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '31', insw_request_payload: payload, insw_error: validation.errors.join('; '), existing_tracking_log_id: context?.attempts.get(id)?.trackingLogId, metadata: context?.attempts.get(id)?.metadata });
          results.push({ id, wms_id: scrapOutDocMap.get(id) || `SCRAP-OUT-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: validation.errors.join('; ') });
          failedCount++;
        }
        return { status: 'failed', message: 'Validation failed', total: transactionIds.length, success_count: 0, failed_count: failedCount, skipped_count: 0, results };
      }

      const inswService = createInswIntegrationService(companyCode);
      const inswResponse = await inswService.postPengeluaran(payload);

      if (inswResponse.status) {
        for (const id of transactionIds) {
          await this.logTransmission({ transaction_type: 'scrap_out', transaction_id: id, wms_id: scrapOutDocMap.get(id), company_code: companyCode, insw_status: INSWTransmissionStatus.SUCCESS, insw_activity_code: '31', insw_request_payload: payload, insw_response: inswResponse, existing_tracking_log_id: context?.attempts.get(id)?.trackingLogId, metadata: context?.attempts.get(id)?.metadata });
          results.push({ id, wms_id: scrapOutDocMap.get(id) || `SCRAP-OUT-${id}`, status: 'success', insw_status: INSWTransmissionStatus.SUCCESS, insw_response: inswResponse });
          successCount++;
        }
      } else {
        for (const id of transactionIds) {
          await this.logTransmission({ transaction_type: 'scrap_out', transaction_id: id, wms_id: scrapOutDocMap.get(id), company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '31', insw_request_payload: payload, insw_response: inswResponse, insw_error: inswResponse.message, existing_tracking_log_id: context?.attempts.get(id)?.trackingLogId, metadata: context?.attempts.get(id)?.metadata });
          results.push({ id, wms_id: scrapOutDocMap.get(id) || `SCRAP-OUT-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: inswResponse.message });
          failedCount++;
        }
      }

      return { status: successCount > 0 ? 'success' : 'failed', message: successCount > 0 ? 'Scrap OUT transmitted to INSW' : 'Failed to transmit scrap OUT', total: transactionIds.length, success_count: successCount, failed_count: failedCount, skipped_count: 0, results };
    } catch (error: any) {
      this.log.error('Error transmitting scrap OUT', { error: error.message });
      for (const id of transactionIds) {
        await this.logTransmission({ transaction_type: 'scrap_out', transaction_id: id, wms_id: scrapOutDocMap.get(id), company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '31', insw_request_payload: payload || undefined, insw_error: error.message, existing_tracking_log_id: context?.attempts.get(id)?.trackingLogId, metadata: context?.attempts.get(id)?.metadata });
        results.push({ id, wms_id: scrapOutDocMap.get(id) || `SCRAP-OUT-${id}`, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: error.message });
      }
      return { status: 'failed', message: error.message, total: transactionIds.length, success_count: 0, failed_count: transactionIds.length, skipped_count: 0, results };
    }
  }

  /**
   * Transmit capital goods OUT to INSW (via INSWIntegrationService, with tracking log)
   */
  async transmitCapitalGoodsOut(
    companyCode: number,
    wmsIds: string[],
    skipEndpointCheck: boolean = false
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting capital goods OUT transmission', { companyCode, wmsIds, skipEndpointCheck });
    const converter = createInswPayloadConverter();

    let payload: any = null;
    try {
      payload = await converter.convertCapitalGoodsOutToINSWByWmsIds(companyCode, wmsIds);
    } catch { /* payload remains null if generation fails */ }

    if (!skipEndpointCheck && !(await this.isEndpointEnabled('CAPITAL_GOODS_OUT'))) {
      for (const wmsId of wmsIds) {
        await this.logTransmission({
          transaction_type: 'capital_goods_out',
          wms_id: wmsId,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.PENDING,
          insw_activity_code: '31',
          insw_request_payload: payload || undefined,
          insw_error: 'Endpoint dinonaktifkan pada pengaturan integrasi',
        });
      }
      return {
        status: 'success',
        message: 'Transmisi ke INSW dinonaktifkan untuk endpoint ini',
        total: wmsIds.length,
        success_count: 0,
        failed_count: 0,
        skipped_count: wmsIds.length,
        results: [],
      };
    }

    const results: INSWTransmitResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      if (!payload) payload = await converter.convertCapitalGoodsOutToINSWByWmsIds(companyCode, wmsIds);

      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        for (const wmsId of wmsIds) {
          await this.logTransmission({ transaction_type: 'capital_goods_out', wms_id: wmsId, company_code: companyCode, insw_status: INSWTransmissionStatus.FAILED, insw_activity_code: '31', insw_request_payload: payload, insw_error: validation.errors.join('; ') });
          results.push({ id: 0, wms_id: wmsId, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: validation.errors.join('; ') });
          failedCount++;
        }
        return { status: 'failed', message: 'Validation failed', total: wmsIds.length, success_count: 0, failed_count: failedCount, skipped_count: 0, results };
      }

      const inswService = createInswIntegrationService(companyCode);
      const inswResponse = await inswService.postPengeluaran(payload);

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

  async transmitStockOpname(
    companyCode: number,
    stockOpnameId: number,
    wmsId: string,
    skipEndpointCheck: boolean = false
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting stock opname transmission', { companyCode, stockOpnameId, wmsId, skipEndpointCheck });
    const converter = createInswPayloadConverter();

    let payload: any = null;
    try {
      payload = await converter.convertStockOpnameToINSW(companyCode, stockOpnameId);
    } catch { /* payload remains null if generation fails */ }

    if (!skipEndpointCheck && !(await this.isEndpointEnabled('STOCK_OPNAME'))) {
      await this.logTransmission({
        transaction_type: 'stock_opname',
        transaction_id: stockOpnameId,
        wms_id: wmsId,
        company_code: companyCode,
        insw_status: INSWTransmissionStatus.PENDING,
        insw_activity_code: '32',
        insw_request_payload: payload || undefined,
        insw_error: 'Endpoint dinonaktifkan pada pengaturan integrasi',
      });
      return {
        status: 'success',
        message: 'Transmisi ke INSW dinonaktifkan untuk endpoint ini',
        total: 1,
        success_count: 0,
        failed_count: 0,
        skipped_count: 1,
        results: [],
      };
    }

    const results: INSWTransmitResult[] = [];

    try {
      if (!payload) payload = await converter.convertStockOpnameToINSW(companyCode, stockOpnameId);

      const validation = INSWHelper.validateINSWPayload(payload);
      if (!validation.valid) {
        await this.logTransmission({
          transaction_type: 'stock_opname',
          transaction_id: stockOpnameId,
          wms_id: wmsId,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '32',
          insw_request_payload: payload,
          insw_error: validation.errors.join('; '),
        });
        results.push({ id: stockOpnameId, wms_id: wmsId, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: validation.errors.join('; ') });
        return { status: 'failed', message: 'Validation failed', total: 1, success_count: 0, failed_count: 1, skipped_count: 0, results };
      }

      const inswService = createInswIntegrationService(companyCode);
      const inswResponse = await inswService.postStockOpname(payload);

      if (inswResponse.status) {
        await this.logTransmission({
          transaction_type: 'stock_opname',
          transaction_id: stockOpnameId,
          wms_id: wmsId,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.SUCCESS,
          insw_activity_code: '32',
          insw_request_payload: payload,
          insw_response: inswResponse,
        });
        results.push({ id: stockOpnameId, wms_id: wmsId, status: 'success', insw_status: INSWTransmissionStatus.SUCCESS, insw_response: inswResponse });
        return { status: 'success', message: 'Stock opname transmitted to INSW', total: 1, success_count: 1, failed_count: 0, skipped_count: 0, results };
      } else {
        await this.logTransmission({
          transaction_type: 'stock_opname',
          transaction_id: stockOpnameId,
          wms_id: wmsId,
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '32',
          insw_request_payload: payload,
          insw_response: inswResponse,
          insw_error: inswResponse.message,
        });
        results.push({ id: stockOpnameId, wms_id: wmsId, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: inswResponse.message });
        return { status: 'failed', message: inswResponse.message || 'Failed to transmit stock opname', total: 1, success_count: 0, failed_count: 1, skipped_count: 0, results };
      }
    } catch (error: any) {
      this.log.error('Error transmitting stock opname', { error: error.message });
      await this.logTransmission({
        transaction_type: 'stock_opname',
        transaction_id: stockOpnameId,
        wms_id: wmsId,
        company_code: companyCode,
        insw_status: INSWTransmissionStatus.FAILED,
        insw_activity_code: '32',
        insw_error: error.message,
      });
      results.push({ id: stockOpnameId, wms_id: wmsId, status: 'failed', insw_status: INSWTransmissionStatus.FAILED, error: error.message });
      return { status: 'failed', message: error.message, total: 1, success_count: 0, failed_count: 1, skipped_count: 0, results };
    }
  }

  /**
   * Transmit saldo awal (beginning balance) to INSW and update status
   */
  async transmitSaldoAwal(
    companyCode: number
  ): Promise<{ status: string; message: string; insw_response?: any }> {
    this.log.info('Starting saldo awal transmission', { companyCode });
    const converter = createInswPayloadConverter();

    let payload: any = null;
    try {
      payload = await converter.convertSaldoAwalToINSW(companyCode);
    } catch { /* payload remains null if generation fails */ }

    if (!(await this.isEndpointEnabled('SALDO_AWAL'))) {
      await this.logTransmission({
        transaction_type: 'saldo_awal',
        company_code: companyCode,
        insw_status: INSWTransmissionStatus.PENDING,
        insw_activity_code: '30',
        insw_request_payload: payload || undefined,
        insw_error: 'Endpoint dinonaktifkan pada pengaturan integrasi',
      });
      return { status: 'success', message: 'Transmisi ke INSW dinonaktifkan untuk endpoint ini' };
    }

    try {
      if (!payload) payload = await converter.convertSaldoAwalToINSW(companyCode);

      const inswService = createInswIntegrationService(companyCode);
      const inswResponse = await inswService.postSaldoAwal(payload);

      if (inswResponse.status) {
        await prisma.$executeRawUnsafe(
          `UPDATE beginning_balances SET status = $1::beginning_balance_status WHERE company_code = $2 AND deleted_at IS NULL`,
          'TRANSMITTED_TO_INSW',
          companyCode
        );

        await this.logTransmission({
          transaction_type: 'saldo_awal',
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.SUCCESS,
          insw_activity_code: '30',
          insw_request_payload: payload,
          insw_response: inswResponse,
        });

        return { status: 'success', message: 'Saldo awal berhasil dikirim ke INSW', insw_response: inswResponse };
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

    if (!(await this.isEndpointEnabled('SALDO_AWAL_FINAL'))) {
      await this.logTransmission({
        transaction_type: 'saldo_awal_final',
        company_code: companyCode,
        insw_status: INSWTransmissionStatus.PENDING,
        insw_activity_code: '30',
        insw_request_payload: undefined,
        insw_error: 'Endpoint dinonaktifkan pada pengaturan integrasi',
      });
      return { status: 'success', message: 'Transmisi ke INSW dinonaktifkan untuk endpoint ini' };
    }

    try {
      const inswService = createInswIntegrationService(companyCode);
      const inswResponse = await inswService.registrasiFinal();

      if (inswResponse.status) {
        await prisma.$executeRawUnsafe(
          `UPDATE beginning_balances SET status = 'LOCKED'::beginning_balance_status WHERE company_code = $1 AND deleted_at IS NULL`,
          companyCode
        );

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
   * Clean up temporary transaction data in INSW (test mode only)
   */
  async cleanupINSWData(
    companyCode: number
  ): Promise<INSWTransmitResponse> {
    this.log.info('Starting INSW temporary data cleanup', { companyCode });

    try {
      const npwp = resolveInswCompanyNpwp(companyCode);
      const inswService = createInswIntegrationService(companyCode);
      const inswResponse = await inswService.cleansingData(npwp);

      if (inswResponse.status) {
        await this.logTransmission({
          transaction_type: 'insw_cleanup',
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.SUCCESS,
          insw_activity_code: '99', // Custom code for cleanup
          insw_request_payload: { companyCode },
          insw_response: inswResponse,
        });

        this.log.info('INSW cleanup completed successfully', { response: inswResponse });

        return {
          status: 'success',
          message: inswResponse.message || 'INSW temporary data cleanup completed successfully',
          total: 1,
          success_count: 1,
          failed_count: 0,
          skipped_count: 0,
          results: [
            {
              id: 0,
              wms_id: 'SYSTEM',
              status: 'success',
              insw_status: INSWTransmissionStatus.SUCCESS,
            },
          ],
        };
      } else {
        await this.logTransmission({
          transaction_type: 'insw_cleanup',
          company_code: companyCode,
          insw_status: INSWTransmissionStatus.FAILED,
          insw_activity_code: '99',
          insw_request_payload: { companyCode },
          insw_response: inswResponse,
          insw_error: inswResponse.message || 'Cleanup failed',
        });

        return {
          status: 'failed',
          message: inswResponse.message || 'Failed to cleanup INSW temporary data',
          total: 1,
          success_count: 0,
          failed_count: 1,
          skipped_count: 0,
          results: [
            {
              id: 0,
              wms_id: 'SYSTEM',
              status: 'failed',
              insw_status: INSWTransmissionStatus.FAILED,
              error: inswResponse.message || 'Cleanup failed',
            },
          ],
        };
      }
    } catch (error: any) {
      this.log.error('Error cleaning up INSW data', { error: error.message });

      await this.logTransmission({
        transaction_type: 'insw_cleanup',
        company_code: companyCode,
        insw_status: INSWTransmissionStatus.FAILED,
        insw_activity_code: '99',
        insw_request_payload: { companyCode },
        insw_error: error.message,
      });

      return {
        status: 'failed',
        message: error.message,
        total: 1,
        success_count: 0,
        failed_count: 1,
        skipped_count: 0,
        results: [
          {
            id: 0,
            wms_id: 'SYSTEM',
            status: 'failed',
            insw_status: INSWTransmissionStatus.FAILED,
            error: error.message,
          },
        ],
      };
    }
  }

  /** Date-only filters use the application's local calendar convention. */
  private buildLogWhere(filters: {
    company_code: number;
    transaction_type?: string;
    insw_status?: string;
    date_from?: string;
    date_to?: string;
    wms_id?: string;
  }, visibilityFilter: Prisma.insw_tracking_logWhereInput): Prisma.insw_tracking_logWhereInput {
    const dateFilter = filters.date_from || filters.date_to ? {
      ...(filters.date_from && { gte: new Date(`${filters.date_from}T00:00:00`) }),
      ...(filters.date_to && {
        // An exclusive start-of-next-day boundary includes sub-second records.
        lt: new Date(new Date(`${filters.date_to}T00:00:00`).setDate(new Date(`${filters.date_to}T00:00:00`).getDate() + 1)),
      }),
    } : undefined;

    return {
      company_code: filters.company_code,
      ...visibilityFilter,
      ...(filters.transaction_type && { transaction_type: filters.transaction_type }),
      ...(filters.insw_status && { insw_status: filters.insw_status }),
      ...(filters.wms_id && { wms_id: { contains: filters.wms_id, mode: 'insensitive' } }),
      ...(dateFilter && { sent_at: dateFilter }),
    };
  }

  private readonly listSelect = {
    id: true,
    transaction_type: true,
    transaction_id: true,
    wms_id: true,
    company_code: true,
    insw_status: true,
    insw_activity_code: true,
    insw_error: true,
    sent_at: true,
    retry_count: true,
    created_at: true,
  } as const;

  async getTransmissionLogPage(filters: {
    company_code: number;
    transaction_type?: string;
    insw_status?: string;
    wms_id?: string;
    date_from?: string;
    date_to?: string;
    limit: number;
    offset: number;
  }) {
    const visibilityFilter = await excludeTechnicalScrapClaims(filters.company_code);
    const where = this.buildLogWhere(filters, visibilityFilter);
    const [total, logs] = await Promise.all([
      prisma.insw_tracking_log.count({ where }),
      prisma.insw_tracking_log.findMany({
        where,
        select: this.listSelect,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: filters.limit,
        skip: filters.offset,
      }),
    ]);
    return { total, logs };
  }

  /**
   * Bounded small-export probe. The extra row detects overflow in the same
   * selection, avoiding count/read races. 100K remains gated on a paced writer.
   */
  async getTransmissionLogsForExcel(filters: {
    company_code: number;
    transaction_type?: string;
    insw_status?: string;
    wms_id?: string;
    date_from?: string;
    date_to?: string;
  }) {
    const visibilityFilter = await excludeTechnicalScrapClaims(filters.company_code);
    const where = this.buildLogWhere(filters, visibilityFilter);
    return prisma.insw_tracking_log.findMany({
      where,
      select: {
        sent_at: true,
        transaction_type: true,
        wms_id: true,
        insw_activity_code: true,
        insw_status: true,
        retry_count: true,
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 10001,
    });
  }

  async getTransmissionLogMetadata(filters: {
    company_code: number;
    date_from?: string;
    date_to?: string;
  }) {
    const visibilityFilter = await excludeTechnicalScrapClaims(filters.company_code);
    const where = this.buildLogWhere(filters, visibilityFilter);
    const [transactionTypes, statuses] = await Promise.all([
      prisma.insw_tracking_log.findMany({ where, distinct: ['transaction_type'], select: { transaction_type: true }, orderBy: { transaction_type: 'asc' } }),
      prisma.insw_tracking_log.findMany({ where, distinct: ['insw_status'], select: { insw_status: true }, orderBy: { insw_status: 'asc' } }),
    ]);
    return {
      transactionTypes: transactionTypes.map(row => row.transaction_type),
      statuses: statuses.map(row => row.insw_status),
    };
  }

  async getTransmissionLogs(filters: {
    company_code: number;
    transaction_type?: string;
    insw_status?: string;
    wms_id?: string;
    limit?: number;
    offset?: number;
    date_from?: string;
    date_to?: string;
  }) {
    const page = await this.getTransmissionLogPage({
      ...filters,
      limit: filters.limit || 100,
      offset: filters.offset || 0,
    });
    return page.logs;
  }

  async getTransmissionLogDetail(companyCode: number, id: bigint) {
    const visibilityFilter = await excludeTechnicalScrapClaims(companyCode);
    return prisma.insw_tracking_log.findFirst({
      // Keep the requested ID and visibility constraints as separate predicates.
      // Spreading visibilityFilter here would overwrite `id` when it contains
      // `{ id: { notIn: [...] } }`, causing findFirst to return another log.
      where: {
        AND: [
          { id, company_code: companyCode },
          visibilityFilter,
        ],
      },
    });
  }
}
