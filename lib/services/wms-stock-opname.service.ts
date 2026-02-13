/**
 * WMS Stock Opname Service
 * Orchestrates business logic, validation, and repository operations
 */

import { PrismaClient } from '@prisma/client';
import type { CreateStockOpnameInput, UpdateStockOpnameInput } from '@/lib/validators/schemas/wms-stock-opname.schema';
import type { AdjustmentDetail, BatchProcessingContext } from '@/lib/types/wms-stock-opname-api.types';
import { WmsStockOpnameRepository } from '@/lib/repositories/wms-stock-opname.repository';
import { parseISODate, validateDateString } from '@/lib/validators/schemas/wms-stock-opname.schema';

export class WmsStockOpnameService {
  private repository: WmsStockOpnameRepository;
  private companyCache: Map<number, boolean>;

  constructor(private prisma: PrismaClient) {
    this.repository = new WmsStockOpnameRepository(prisma);
    this.companyCache = new Map();
  }

  /**
   * Process POST request - Create new stock opname
   */
  async processCreate(payload: CreateStockOpnameInput, requestUser: string): Promise<any> {
    await this.validateCompany(payload.company_code);

    if (!validateDateString(payload.document_date)) {
      throw new Error('Invalid document date format');
    }

    if (!payload.items || payload.items.length === 0) {
      throw new Error('At least one item is required');
    }

    await this.validateItemTypes(payload.items.map((i) => i.item_type));

    const documentDate = parseISODate(payload.document_date);

    const result = await this.repository.create(
      payload.wms_id,
      payload.company_code,
      payload.owner || null,
      documentDate,
      payload.items,
      requestUser,
    );

    // Generate adjustments asynchronously (fire-and-forget pattern)
    this.generateAdjustmentsAsync(result.id, result.company_code, documentDate, result.wms_id, result.items).catch(
      (err) => {
        console.error('[WmsStockOpnameService] Error generating adjustments:', err);
      },
    );

    return this.formatResponse(result);
  }

  /**
   * Process PATCH request - Update stock opname status
   */
  async processUpdate(payload: UpdateStockOpnameInput, requestUser: string): Promise<any> {
    const existing = await this.prisma.wms_stock_opnames.findFirst({
      where: { wms_id: payload.wms_id },
      include: { items: true },
    });

    if (!existing) {
      throw new Error(`Stock opname with WMS ID ${payload.wms_id} not found`);
    }

    if (payload.status === existing.status) {
      return this.formatResponse(existing);
    }

    const result = await this.repository.update(
      payload.wms_id,
      existing.company_code,
      payload.status as 'CONFIRMED' | 'CANCELLED',
      payload.items,
      payload.notes ?? undefined,
    );

    return this.formatResponse(result);
  }

  /**
   * Validate company exists (with caching)
   */
  private async validateCompany(companyCode: number): Promise<void> {
    if (this.companyCache.has(companyCode)) {
      const cached = this.companyCache.get(companyCode);
      if (!cached) {
        throw new Error(`Company ${companyCode} not found`);
      }
      return;
    }

    const company = await this.prisma.companies.findUnique({
      where: { code: companyCode },
      select: { code: true },
    });

    if (!company) {
      this.companyCache.set(companyCode, false);
      throw new Error(`Company ${companyCode} not found`);
    }

    this.companyCache.set(companyCode, true);
  }

  /**
   * Validate item types exist
   */
  private async validateItemTypes(itemTypes: string[]): Promise<void> {
    const uniqueTypes = [...new Set(itemTypes)];

    const foundTypes = await this.prisma.item_types.findMany({
      where: { item_type_code: { in: uniqueTypes } },
      select: { item_type_code: true },
    });

    const foundSet = new Set(foundTypes.map((t) => t.item_type_code));
    const missing = uniqueTypes.filter((t) => !foundSet.has(t));

    if (missing.length > 0) {
      throw new Error(`Item types not found: ${missing.join(', ')}`);
    }
  }

  /**
   * Generate adjustments from stock opname items (async)
   */
  private async generateAdjustmentsAsync(
    stockOpnameId: bigint,
    companyCode: number,
    documentDate: Date,
    wmsId: string,
    items: any[],
  ): Promise<void> {
    const itemsWithVariance = items.filter((item) => Number(item.variance_qty) !== 0);

    if (itemsWithVariance.length === 0) return;

    const adjustmentDetails: AdjustmentDetail[] = itemsWithVariance.map((item) => ({
      item_code: item.item_code,
      item_type: item.item_type,
      adjustment_type: Number(item.adjustment_qty_signed) > 0 ? 'GAIN' : 'LOSS',
      adjustment_qty: Math.abs(Number(item.adjustment_qty_signed)),
      uom: item.uom,
      notes: `Stock opname variance: physical=${item.physical_qty}, system=${item.system_qty}`,
    }));

    const context: BatchProcessingContext = {
      stockOpnameId,
      companyCode,
      transactionDate: documentDate,
      wmsId,
      adjustmentDetails,
    };

    await this.repository.generateAdjustments(context);
  }

  /**
   * Format response for API output
   */
  private formatResponse(stockOpname: any): any {
    const items = (stockOpname.items || []).map((item: any) => ({
      id: item.id,
      item_code: item.item_code,
      item_type: item.item_type,
      physical_qty: Number(item.physical_qty),
      uom: item.uom,
      beginning_qty: Number(item.beginning_qty),
      incoming_qty_on_date: Number(item.incoming_qty_on_date),
      outgoing_qty_on_date: Number(item.outgoing_qty_on_date),
      system_qty: Number(item.system_qty),
      variance_qty: Number(item.variance_qty),
      adjustment_qty_signed: Number(item.adjustment_qty_signed),
      adjustment_type: item.adjustment_type,
      notes: item.notes,
    }));

    return {
      id: stockOpname.id,
      wms_id: stockOpname.wms_id,
      company_code: stockOpname.company_code,
      owner: stockOpname.owner,
      document_date: stockOpname.document_date.toISOString().split('T')[0],
      status: stockOpname.status,
      items,
      confirmed_at: stockOpname.confirmed_at ? stockOpname.confirmed_at.toISOString() : undefined,
      cancelled_at: stockOpname.cancelled_at ? stockOpname.cancelled_at.toISOString() : undefined,
      created_at: stockOpname.created_at.toISOString(),
    };
  }
}

export function createWmsStockOpnameService(prisma: PrismaClient): WmsStockOpnameService {
  return new WmsStockOpnameService(prisma);
}
