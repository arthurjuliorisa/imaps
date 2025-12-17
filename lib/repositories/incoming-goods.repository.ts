// lib/repositories/incoming-goods.repository.ts

/**
 * Incoming Goods Repository
 * 
 * Purpose:
 * - Handle all database operations for incoming goods
 * - Implement idempotency via upsert
 * - Manage transactions for header-detail pattern
 * 
 * Database Schema:
 * - incoming_goods (header table - partitioned)
 * - incoming_good_items (detail table - partitioned)
 * - Unique constraint: [company_code, wms_id, incoming_date]
 */

import { Prisma } from '@prisma/client';
import prisma from '@/lib/utils/prisma';
import { IncomingGoodData } from '@/lib/types/incoming-goods.types';

/**
 * Result of upsert operation
 */
export interface UpsertResult {
  success: boolean;
  record_id: number;
  was_updated: boolean;
  error?: string;
}

/**
 * Repository for incoming goods operations
 */
export class IncomingGoodRepository {
  /**
   * Create incoming_good_items in chunks to avoid exceeding query/parameter limits
   * when item count is very large (e.g., thousands of rows).
   */
  private async createItemsInChunks(
    tx: any,
    recordId: number,
    company_code: number,
    incoming_date: Date,
    items: IncomingGoodData['items'],
    chunkSize = 1000
  ) {
    if (!items?.length) return;

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);

      await tx.incomingGoodItem.createMany({
        data: chunk.map((item) => ({
          incoming_good_id: recordId,
          incoming_good_company: company_code,
          incoming_good_date: incoming_date,
          item_type: item.item_type,
          item_code: item.item_code,
          item_name: item.item_name,
          hs_code: item.hs_code,
          uom: item.uom,
          qty: new Prisma.Decimal(item.qty),
          currency: item.currency,
          amount: new Prisma.Decimal(item.amount),
        })),
      });
    }
  }

  /**
   * Upsert incoming good with items (idempotent operation)
   * 
   * How it works:
   * 1. Check if record exists using unique constraint
   * 2. If exists: DELETE old items, UPDATE header, INSERT new items
   * 3. If not exists: INSERT header and items
   * 
   * Why this approach:
   * - Prisma doesn't support nested upsert with array of children
   * - We need to replace all items (WMS is single source of truth)
   * - All operations wrapped in transaction for atomicity
   * 
   * @param data - Incoming good data with items
   * @returns Upsert result with record ID
   */
  async upsert(data: IncomingGoodData): Promise<UpsertResult> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Step 1: Check if record exists
        const existing = await tx.incomingGood.findUnique({
          where: {
            company_code_wms_id_incoming_date: {
              company_code: data.company_code,
              wms_id: data.wms_id,
              incoming_date: data.incoming_date,
            },
          },
          select: { id: true },
        });

        let recordId: number;
        let wasUpdated = false;

        if (existing) {
          // Record exists - UPDATE flow
          wasUpdated = true;
          recordId = existing.id;

          // Step 2a: Delete existing items
          await tx.incomingGoodItem.deleteMany({
            where: {
              incoming_good_id: recordId,
            },
          });

          // Step 2b: Update header
          await tx.incomingGood.update({
            where: { id: recordId },
            data: {
              owner: data.owner,
              customs_document_type: data.customs_document_type,
              ppkek_number: data.ppkek_number,
              customs_registration_date: data.customs_registration_date,
              incoming_evidence_number: data.incoming_evidence_number,
              incoming_date: data.incoming_date,
              invoice_number: data.invoice_number,
              invoice_date: data.invoice_date,
              shipper_name: data.shipper_name,
              timestamp: data.timestamp,
              updated_at: new Date(),
            },
          });

          // Step 2c: Insert new items
          await this.createItemsInChunks(
            tx,
            recordId,
            data.company_code,
            data.incoming_date,
            data.items
          );
        } else {
          // Record doesn't exist - INSERT flow
          // IMPORTANT:
          // - We intentionally avoid Prisma relation field `items` (partitioning constraints/FK issues)
          // - Therefore we must do header insert first, then insert detail rows via incomingGoodItem
          const created = await tx.incomingGood.create({
            data: {
              wms_id: data.wms_id,
              company_code: data.company_code,
              owner: data.owner,
              customs_document_type: data.customs_document_type,
              ppkek_number: data.ppkek_number,
              customs_registration_date: data.customs_registration_date,
              incoming_evidence_number: data.incoming_evidence_number,
              incoming_date: data.incoming_date,
              invoice_number: data.invoice_number,
              invoice_date: data.invoice_date,
              shipper_name: data.shipper_name,
              timestamp: data.timestamp,
            },
            select: { id: true },
          });

          recordId = created.id;

          await this.createItemsInChunks(
            tx,
            recordId,
            data.company_code,
            data.incoming_date,
            data.items
          );
        }

        return { recordId, wasUpdated };
      });

      return {
        success: true,
        record_id: result.recordId,
        was_updated: result.wasUpdated,
      };
    } catch (error) {
      console.error('Error in IncomingGoodRepository.upsert:', error);

      let errorMessage = 'Unknown database error';
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        errorMessage = `Database error: ${error.code} - ${error.message}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        success: false,
        record_id: 0,
        was_updated: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Find incoming good by WMS ID (for debugging/verification)
   * 
   * @param company_code - Company code
   * @param wms_id - WMS transaction ID
   * @returns Incoming good with items or null
   */
  async findByWmsId(company_code: number, wms_id: string) {
    try {
      // NOTE: We avoid Prisma relation `items` due to partitioning constraints,
      // so we fetch header and items separately.
      const header = await prisma.incomingGood.findFirst({
        where: {
          company_code,
          wms_id,
          deleted_at: null,
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      if (!header) return null;

      const items = await prisma.incomingGoodItem.findMany({
        where: {
          incoming_good_id: header.id,
          deleted_at: null,
        },
        orderBy: {
          id: 'asc',
        },
      });

      return { ...header, items };
    } catch (error) {
      console.error('Error in IncomingGoodRepository.findByWmsId:', error);
      return null;
    }
  }

  /**
   * Soft delete incoming good and its items
   * 
   * Note: This is for future use (not part of current API contract)
   * 
   * @param id - Record ID
   * @returns Success status
   */
  async softDelete(id: number): Promise<boolean> {
    try {
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        // Soft delete header
        await tx.incomingGood.update({
          where: { id },
          data: { deleted_at: now },
        });

        // Soft delete items
        await tx.incomingGoodItem.updateMany({
          where: { incoming_good_id: id },
          data: { deleted_at: now },
        });
      });

      return true;
    } catch (error) {
      console.error('Error in IncomingGoodRepository.softDelete:', error);
      return false;
    }
  }

  /**
   * Get statistics for monitoring
   * 
   * @param company_code - Company code
   * @param from_date - Start date
   * @param to_date - End date
   * @returns Statistics object
   */
  async getStatistics(
    company_code: number,
    from_date: Date,
    to_date: Date
  ): Promise<{
    total_transactions: number;
    total_items: number;
    total_amount_usd: number;
  }> {
    try {
      const transactions = await prisma.incomingGood.count({
        where: {
          company_code,
          incoming_date: {
            gte: from_date,
            lte: to_date,
          },
          deleted_at: null,
        },
      });

      const items = await prisma.incomingGoodItem.findMany({
        where: {
          incoming_good_company: company_code,
          incoming_good_date: {
            gte: from_date,
            lte: to_date,
          },
          deleted_at: null,
        },
        select: {
          currency: true,
          amount: true,
        },
      });

      const totalItems = items.length;
      
      // Simple total (you may want to add currency conversion logic)
      const totalAmountUsd = items
        .filter(item => item.currency === 'USD')
        .reduce((sum, item) => sum + Number(item.amount), 0);

      return {
        total_transactions: transactions,
        total_items: totalItems,
        total_amount_usd: totalAmountUsd,
      };
    } catch (error) {
      console.error('Error in IncomingGoodRepository.getStatistics:', error);
      return {
        total_transactions: 0,
        total_items: 0,
        total_amount_usd: 0,
      };
    }
  }
}

// Export singleton instance
export const incomingGoodRepository = new IncomingGoodRepository();
