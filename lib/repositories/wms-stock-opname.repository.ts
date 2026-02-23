/**
 * WMS Stock Opname Repository
 * Handles all database operations with transaction safety and batch processing
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import type {
  WmsStockOpnameItemPayload,
  AdjustmentDetail,
  BatchProcessingContext,
} from '@/lib/types/wms-stock-opname-api.types';

export class WmsStockOpnameRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create new stock opname with items
   * Idempotent via unique(company_code, wms_id)
   */
  async create(
    wmsId: string,
    companyCode: number,
    owner: number | null,
    documentDate: Date,
    items: WmsStockOpnameItemPayload[],
    requestUser: string,
  ): Promise<any> {
    const dataChecksum = this.calculateDataChecksum({
      wmsId,
      companyCode,
      owner,
      documentDate,
      items,
    });

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.wms_stock_opnames.findUnique({
        where: {
          company_code_wms_id: {
            company_code: companyCode,
            wms_id: wmsId,
          },
        },
        include: { items: true },
      });

      if (existing) {
        const existingChecksum = this.calculateDataChecksum({
          wmsId: existing.wms_id,
          companyCode: existing.company_code,
          owner: existing.owner,
          documentDate: existing.document_date,
          items: existing.items.map((item: any) => ({
            item_code: item.item_code,
            item_name: item.item_name,
            item_type: item.item_type,
            actual_qty_count: Number(item.actual_qty_count),
            uom: item.uom,
          })),
        });

        if (existingChecksum === dataChecksum && existing.status === 'Active') {
          return existing;
        }
        throw new Error(
          `Stock opname with WMS ID ${wmsId} already exists for company ${companyCode}`,
        );
      }

      const stockOpname = await tx.wms_stock_opnames.create({
        data: {
          wms_id: wmsId,
          company_code: companyCode,
          owner: owner || null,
          document_date: documentDate,
          status: 'Active',
        },
      });

      const [reconciliationData] = await Promise.all([
        this.fetchReconciliationData(companyCode, items, documentDate, tx),
        this.fetchItemTypesMap(items, tx),
      ]);

      const itemsData = items.map((item) => {
        const key = `${item.item_code}:${item.uom}`;
        const recon = reconciliationData[key] || {
          beginning_qty: 0,
          incoming_qty_on_date: 0,
          outgoing_qty_on_date: 0,
        };

        const system_qty = recon.beginning_qty + recon.incoming_qty_on_date - recon.outgoing_qty_on_date;
        const variance_qty = (item.actual_qty_count ?? 0) - system_qty;
        const adjustment_type = variance_qty > 0 ? 'GAIN' : variance_qty < 0 ? 'LOSS' : null;

        return {
          wms_stock_opname_id: stockOpname.id,
          company_code: companyCode,
          item_code: item.item_code,
          item_name: item.item_name,
          item_type: item.item_type,
          actual_qty_count: item.actual_qty_count ?? 0,
          uom: item.uom,
          beginning_qty: recon.beginning_qty,
          incoming_qty_on_date: recon.incoming_qty_on_date,
          outgoing_qty_on_date: recon.outgoing_qty_on_date,
          system_qty,
          variance_qty,
          adjustment_qty_signed: null,
          adjustment_type,
          amount: null,
          final_adjusted_qty: system_qty,
          reason: null,
        };
      });

      await tx.wms_stock_opname_items.createMany({
        data: itemsData,
      });

      const createdItems = await tx.wms_stock_opname_items.findMany({
        where: { wms_stock_opname_id: stockOpname.id },
      });

      return { ...stockOpname, items: createdItems };
    });
  }

  /**
   * Update stock opname status and optionally items
   */
  async update(
    wmsId: string,
    companyCode: number,
    newStatus: 'Confirmed' | 'Cancelled',
    items?: WmsStockOpnameItemPayload[],
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.wms_stock_opnames.findUnique({
        where: {
          company_code_wms_id: {
            company_code: companyCode,
            wms_id: wmsId,
          },
        },
        include: { items: true },
      });

      if (!current) {
        throw new Error(
          `Stock opname with WMS ID ${wmsId} not found for company ${companyCode}`,
        );
      }

      this.validateStatusTransition(current.status, newStatus);

      if (items && items.length > 0) {
        await tx.wms_stock_opname_items.deleteMany({
          where: { wms_stock_opname_id: current.id },
        });

        const recon = await this.fetchReconciliationData(
          companyCode,
          items,
          current.document_date,
          tx,
        );

        const newItemsData = items.map((item) => {
          const key = `${item.item_code}:${item.uom}`;
          const r = recon[key] || {
            beginning_qty: 0,
            incoming_qty_on_date: 0,
            outgoing_qty_on_date: 0,
          };
          const system_qty = r.beginning_qty + r.incoming_qty_on_date - r.outgoing_qty_on_date;
          const variance_qty = (item.actual_qty_count ?? 0) - system_qty;
          const adjustment_type = variance_qty > 0 ? 'GAIN' : variance_qty < 0 ? 'LOSS' : null;

          return {
            wms_stock_opname_id: current.id,
            company_code: companyCode,
            item_code: item.item_code,
            item_name: item.item_name,
            item_type: item.item_type,
            actual_qty_count: item.actual_qty_count ?? 0,
            uom: item.uom,
            beginning_qty: r.beginning_qty,
            incoming_qty_on_date: r.incoming_qty_on_date,
            outgoing_qty_on_date: r.outgoing_qty_on_date,
            system_qty,
            variance_qty,
            adjustment_qty_signed: null,
            adjustment_type,
            amount: item.amount ?? null,
            final_adjusted_qty: system_qty,
            reason: null,
          };
        });

        await tx.wms_stock_opname_items.createMany({
          data: newItemsData,
        });
      }

      const updateData: any = { status: newStatus };
      if (newStatus === 'Confirmed') {
        updateData.confirmed_at = new Date();
      }

      return await tx.wms_stock_opnames.update({
        where: { id: current.id },
        data: updateData,
        include: { items: true },
      });
    });
  }

  /**
   * Find stock opname by WMS ID and company code
   */
  async findByWmsId(wmsId: string, companyCode: number): Promise<any | null> {
    return this.prisma.wms_stock_opnames.findUnique({
      where: {
        company_code_wms_id: {
          company_code: companyCode,
          wms_id: wmsId,
        },
      },
      include: { items: true },
    });
  }

  /**
   * Generate adjustments from stock opname variances
   */
  async generateAdjustments(context: BatchProcessingContext): Promise<void> {
    const { companyCode, transactionDate, wmsId, adjustmentDetails } = context;

    if (adjustmentDetails.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      // Create single adjustment header for all variances
      const adjustment = await tx.adjustments.create({
        data: {
          company_code: companyCode,
          owner: companyCode,
          wms_id: wmsId,
          transaction_date: transactionDate,
          internal_evidence_number: `SO-${wmsId}-${Date.now()}`,
          timestamp: new Date(),
        },
      });

      // Create adjustment items separately
      const adjustmentItemsData = adjustmentDetails.map((detail) => ({
        adjustment_id: adjustment.id,
        adjustment_company: companyCode,
        adjustment_date: transactionDate,
        item_type: detail.item_type,
        item_code: detail.item_code,
        item_name: '', // Will be populated from master
        adjustment_type: detail.adjustment_type,
        uom: detail.uom,
        qty: detail.adjustment_qty,
        notes: detail.notes || null,
      }));

      await tx.adjustment_items.createMany({
        data: adjustmentItemsData,
      });
    });
  }

  private calculateDataChecksum(data: {
    wmsId: string;
    companyCode: number;
    owner: number | null;
    documentDate: Date;
    items: WmsStockOpnameItemPayload[];
  }): string {
    const sortedItems = [...data.items].sort((a, b) => a.item_code.localeCompare(b.item_code));
    const payload = JSON.stringify({
      wmsId: data.wmsId,
      companyCode: data.companyCode,
      owner: data.owner,
      documentDate: data.documentDate.toISOString().split('T')[0],
      items: sortedItems,
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  private async fetchReconciliationData(
    companyCode: number,
    items: WmsStockOpnameItemPayload[],
    documentDate: Date,
    tx: any,
  ): Promise<Record<string, { beginning_qty: number; incoming_qty_on_date: number; outgoing_qty_on_date: number }>> {
    // =========================================================================
    // CORRECTED: Fetch ALL reconciliation data from stock_daily_snapshot
    // WITH FALLBACK TO LATEST PREVIOUS DATE IF EXACT DATE NOT FOUND
    // =========================================================================
    // Per business requirement: Reconciliation must be at UOM level
    // - Query by: company_code, item_code, uom, snapshot_date
    // - All values must come from the snapshot on that date:
    //   - opening_balance → beginning_qty
    //   - incoming_qty → incoming_qty_on_date (only on exact date)
    //   - outgoing_qty → outgoing_qty_on_date (only on exact date)
    //
    // If no snapshot exists on exact date, fallback to latest previous snapshot
    // for that item+uom combination to get opening_balance (incoming/outgoing = 0)
    //
    // This ensures consistency with stock_daily_snapshot calculation method
    // =========================================================================

    // Build composite key: item_code:uom for mapping
    const itemsMap = new Map(items.map((i) => [`${i.item_code}:${i.uom}`, i]));
    const itemUomPairs = Array.from(itemsMap.keys());

    // Build WHERE clause conditions for each item+uom pair
    const itemUomConditions = items.map((i) => ({
      item_code: i.item_code,
      uom: i.uom,
    }));

    // Step 1: Fetch snapshots on exact document date
    const snapshotDataExactDate = await tx.stock_daily_snapshot.findMany({
      where: {
        company_code: companyCode,
        snapshot_date: documentDate,
        OR: itemUomConditions,
      },
      select: {
        item_code: true,
        uom: true,
        opening_balance: true,
        incoming_qty: true,
        outgoing_qty: true,
      },
    });

    const foundPairs = new Set(
      snapshotDataExactDate.map((r: any) => `${r.item_code}:${r.uom}`),
    );
    const missingPairs = itemUomPairs.filter((pair) => !foundPairs.has(pair));

    let snapshotDataFallback: any[] = [];

    // Step 2: For items+uom not found on exact date, fetch latest previous snapshot
    if (missingPairs.length > 0) {
      const missingConditions = missingPairs.map((pair) => {
        const [itemCode, uom] = pair.split(':');
        return { item_code: itemCode, uom };
      });

      // Query all snapshots before document date, then process in JS
      const allFallbackSnapshots = await tx.stock_daily_snapshot.findMany({
        where: {
          company_code: companyCode,
          snapshot_date: { lt: documentDate },
          OR: missingConditions,
        },
        select: {
          item_code: true,
          uom: true,
          opening_balance: true,
          snapshot_date: true,
        },
        orderBy: [{ snapshot_date: 'desc' }],
      });

      // Get latest snapshot for each item+uom combination
      const latestByItemUom = new Map<string, typeof allFallbackSnapshots[0]>();
      for (const snap of allFallbackSnapshots) {
        const key = `${snap.item_code}:${snap.uom}`;
        if (!latestByItemUom.has(key)) {
          latestByItemUom.set(key, snap);
        }
      }

      snapshotDataFallback = Array.from(latestByItemUom.values()).map((snap) => ({
        item_code: snap.item_code,
        uom: snap.uom,
        opening_balance: snap.opening_balance,
        incoming_qty: 0,
        outgoing_qty: 0,
      }));
    }

    const result: Record<string, { beginning_qty: number; incoming_qty_on_date: number; outgoing_qty_on_date: number }> = {};

    // Process exact date snapshots
    for (const record of snapshotDataExactDate) {
      const key = `${record.item_code}:${record.uom}`;
      result[key] = {
        beginning_qty: Number(record.opening_balance || 0),
        incoming_qty_on_date: Number(record.incoming_qty || 0),
        outgoing_qty_on_date: Number(record.outgoing_qty || 0),
      };
    }

    // Process fallback snapshots (incoming/outgoing = 0 for fallback dates)
    for (const record of snapshotDataFallback) {
      const key = `${record.item_code}:${record.uom}`;
      result[key] = {
        beginning_qty: Number(record.opening_balance || 0),
        incoming_qty_on_date: 0, // No incoming on non-exact date
        outgoing_qty_on_date: 0, // No outgoing on non-exact date
      };
    }

    // Default to zero for items with no snapshot at all
    for (const pair of itemUomPairs) {
      if (!result[pair]) {
        result[pair] = {
          beginning_qty: 0,
          incoming_qty_on_date: 0,
          outgoing_qty_on_date: 0,
        };
      }
    }

    return result;
  }

  private async fetchItemTypesMap(items: WmsStockOpnameItemPayload[], tx: any): Promise<Map<string, string>> {
    const itemTypes = [...new Set(items.map((i) => i.item_type))];
    const types = await tx.item_types.findMany({
      where: { item_type_code: { in: itemTypes } },
      select: { item_type_code: true },
    });
    return new Map(types.map((t: any) => [t.item_type_code, t.item_type_code]));
  }

  private validateStatusTransition(currentStatus: string, newStatus: 'Confirmed' | 'Cancelled'): void {
    const validTransitions: Record<string, string[]> = {
      Active: ['Confirmed', 'Cancelled'],
      Confirmed: [],
      Cancelled: [],
    };

    if (!validTransitions[currentStatus].includes(newStatus)) {
      throw new Error(
        `Cannot transition from ${currentStatus} to ${newStatus}. Valid transitions from ${currentStatus}: ${validTransitions[currentStatus].join(', ')}`,
      );
    }
  }
}

export function createWmsStockOpnameRepository(prisma: PrismaClient): WmsStockOpnameRepository {
  return new WmsStockOpnameRepository(prisma);
}
