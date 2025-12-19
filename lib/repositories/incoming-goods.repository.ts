import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { BaseTransactionRepository } from './base-transaction.repository';
import { logger } from '../utils/logger';
import type { IncomingGoodsValidated } from '../validators/incoming-goods.validator';

export interface IncomingGoodsCreateResult {
  id: number;
  wms_id: string;
  company_code: number;
  incoming_date: Date;
  items_count: number;
}

export class IncomingGoodsRepository extends BaseTransactionRepository {
  /**
   * Create or update incoming goods with items (Upsert pattern for idempotency)
   */
  async createOrUpdate(data: IncomingGoodsValidated): Promise<IncomingGoodsCreateResult> {
    const requestLogger = logger.child({ wmsId: data.wms_id });

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Parse dates
        const incomingDate = new Date(data.incoming_date);
        const customsRegDate = new Date(data.customs_registration_date);
        const invoiceDate = new Date(data.invoice_date);
        const timestamp = new Date(data.timestamp);

        // Upsert incoming goods header
        const incomingGood = await tx.incoming_goods.upsert({
          where: {
            company_code_wms_id_incoming_date: {
              company_code: data.company_code,
              wms_id: data.wms_id,
              incoming_date: incomingDate,
            },
          },
          update: {
            owner: data.owner,
            customs_document_type: data.customs_document_type as any,
            ppkek_number: data.ppkek_number,
            customs_registration_date: customsRegDate,
            incoming_evidence_number: data.incoming_evidence_number,
            invoice_number: data.invoice_number,
            invoice_date: invoiceDate,
            shipper_name: data.shipper_name,
            timestamp: timestamp,
            updated_at: new Date(),
            deleted_at: null,
          },
          create: {
            wms_id: data.wms_id,
            company_code: data.company_code,
            owner: data.owner,
            customs_document_type: data.customs_document_type as any,
            ppkek_number: data.ppkek_number,
            customs_registration_date: customsRegDate,
            incoming_evidence_number: data.incoming_evidence_number,
            incoming_date: incomingDate,
            invoice_number: data.invoice_number,
            invoice_date: invoiceDate,
            shipper_name: data.shipper_name,
            timestamp: timestamp,
          },
        });

        // Delete existing items (for update case)
        await tx.incoming_good_items.deleteMany({
          where: {
            incoming_good_id: incomingGood.id,
            incoming_good_company: data.company_code,
            incoming_good_date: incomingDate,
          },
        });

        // Create items
        const itemsData = data.items.map((item) => ({
          incoming_good_id: incomingGood.id,
          incoming_good_company: data.company_code,
          incoming_good_date: incomingDate,
          item_type: item.item_type,
          item_code: item.item_code,
          item_name: item.item_name,
          hs_code: item.hs_code || null,
          uom: item.uom,
          qty: new Prisma.Decimal(item.qty),
          currency: item.currency as any,
          amount: new Prisma.Decimal(item.amount),
        }));

        await tx.incoming_good_items.createMany({
          data: itemsData,
        });

        requestLogger.info(
          'Incoming goods saved successfully',
          {
            incomingGoodId: incomingGood.id,
            itemsCount: data.items.length,
            companyCode: data.company_code,
            incomingDate: incomingDate,
          }
        );

        return {
          id: incomingGood.id,
          wms_id: incomingGood.wms_id,
          company_code: incomingGood.company_code,
          incoming_date: incomingGood.incoming_date,
          items_count: data.items.length,
        };
      });

      // Handle backdated transaction (non-blocking)
      await this.handleBackdatedTransaction(
        data.company_code,
        result.incoming_date,
        data.wms_id,
        'incoming_goods'
      );

      return result;
    } catch (error) {
      requestLogger.error('Failed to save incoming goods', { error });
      throw error;
    }
  }

  /**
   * Find incoming goods by wms_id
   */
  async findByWmsId(
    company_code: number,
    wms_id: string,
    incoming_date: Date
  ): Promise<any | null> {
    return await prisma.incoming_goods.findUnique({
      where: {
        company_code_wms_id_incoming_date: {
          company_code,
          wms_id,
          incoming_date,
        },
      },
      include: {
        // companies: true, // Removed as it does not exist in the model
      },
    });
  }

  /**
   * Batch query companies by code (optimization)
   * Fetch multiple companies in one query instead of individual lookups
   */
  async getCompaniesByCode(companyCodes: number[]) {
    try {
      const companies = await prisma.companies.findMany({
        where: {
          code: {
            in: companyCodes,
          },
        },
        select: {
          code: true,
          status: true,
        },
      });
      return companies;
    } catch (error) {
      logger.error('Error in IncomingGoodsRepository.getCompaniesByCode:', { error, companyCodes });
      return [];
    }
  }

  /**
   * Check if company exists and is active
   */
  async companyExists(company_code: number): Promise<boolean> {
    try {
      const company = await prisma.companies.findUnique({ // Change 'company' to 'companies'
        where: { code: company_code },
      });
      return company !== null && company.status === 'ACTIVE';
    } catch (error) {
      logger.error({ error, company_code });
      return false;
    }
  }
}