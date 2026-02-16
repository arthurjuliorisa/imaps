import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export interface LaporanPemasukanView {
  id: number;
  company_code: number;
  company_name: string;
  customs_document_type: string;
  cust_doc_registration_no: string | null;
  reg_date: Date | null;
  doc_number: string;
  doc_date: Date;
  shipper_name: string | null;
  type_code: string;
  item_code: string;
  item_name: string;
  unit: string;
  quantity: Prisma.Decimal;
  currency: string | null;
  value_amount: Prisma.Decimal | null;
}

export interface LaporanPengeluaranView {
  id: number;
  wms_id: string | null;
  company_code: number;
  company_name: string;
  customs_document_type: string;
  cust_doc_registration_no: string | null;
  reg_date: Date | null;
  doc_number: string;
  doc_date: Date;
  recipient_name: string | null;
  type_code: string;
  item_code: string;
  item_name: string;
  unit: string;
  quantity: Prisma.Decimal;
  currency: string | null;
  value_amount: Prisma.Decimal | null;
}

export interface BeginningBalanceData {
  id: number;
  company_code: number;
  item_code: string;
  item_name: string;
  item_type: string;
  uom: string;
  qty: Prisma.Decimal;
  balance_date: Date;
  remarks: string | null;
}

export interface ScrapTransactionData {
  transaction_id: number;
  company_code: number;
  company_name: string;
  transaction_type: string;
  transaction_date: Date;
  document_number: string;
  source: string | null;
  recipient_name: string | null;
  ppkek_number: string | null;
  customs_registration_date: Date | null;
  customs_document_type: string | null;
  item_type: string;
  item_code: string;
  item_name: string;
  uom: string;
  qty: Prisma.Decimal;
  currency: string;
  amount: Prisma.Decimal;
}

export class INSWIntegrationRepository {
  async getLaporanPemasukanByIds(
    companyCode: number,
    ids: number[]
  ): Promise<LaporanPemasukanView[]> {
    if (ids.length === 0) {
      return [];
    }

    const query = `
      SELECT
        id,
        company_code,
        company_name,
        customs_document_type,
        cust_doc_registration_no,
        reg_date,
        doc_number,
        doc_date,
        shipper_name,
        type_code,
        item_code,
        item_name,
        unit,
        quantity,
        currency,
        value_amount
      FROM vw_laporan_pemasukan
      WHERE company_code = $1
        AND id = ANY($2::int[])
      ORDER BY doc_date, id
    `;

    const result = await prisma.$queryRawUnsafe<LaporanPemasukanView[]>(
      query,
      companyCode,
      ids
    );

    return result;
  }

  async getLaporanPengeluaranByIds(
    companyCode: number,
    ids: number[]
  ): Promise<LaporanPengeluaranView[]> {
    if (ids.length === 0) {
      return [];
    }

    const query = `
      SELECT
        id,
        wms_id,
        company_code,
        company_name,
        customs_document_type,
        cust_doc_registration_no,
        reg_date,
        doc_number,
        doc_date,
        recipient_name,
        type_code,
        item_code,
        item_name,
        unit,
        quantity,
        currency,
        value_amount
      FROM vw_laporan_pengeluaran
      WHERE company_code = $1
        AND id = ANY($2::int[])
      ORDER BY doc_date, id
    `;

    const result = await prisma.$queryRawUnsafe<LaporanPengeluaranView[]>(
      query,
      companyCode,
      ids
    );

    return result;
  }

  async getLaporanPengeluaranByWmsIds(
    companyCode: number,
    wmsIds: string[]
  ): Promise<LaporanPengeluaranView[]> {
    if (wmsIds.length === 0) {
      return [];
    }

    const query = `
      SELECT
        id,
        wms_id,
        company_code,
        company_name,
        customs_document_type,
        cust_doc_registration_no,
        reg_date,
        doc_number,
        doc_date,
        recipient_name,
        type_code,
        item_code,
        item_name,
        unit,
        quantity,
        currency,
        value_amount
      FROM vw_laporan_pengeluaran
      WHERE company_code = $1
        AND wms_id = ANY($2::text[])
      ORDER BY doc_date, id
    `;

    const result = await prisma.$queryRawUnsafe<LaporanPengeluaranView[]>(
      query,
      companyCode,
      wmsIds
    );

    return result;
  }

  async getBeginningBalances(
    companyCode: number,
    balanceDate?: Date
  ): Promise<BeginningBalanceData[]> {
    const whereConditions: Prisma.beginning_balancesWhereInput = {
      company_code: companyCode,
      deleted_at: null,
    };

    if (balanceDate) {
      whereConditions.balance_date = balanceDate;
    }

    const result = await prisma.beginning_balances.findMany({
      where: whereConditions,
      select: {
        id: true,
        company_code: true,
        item_code: true,
        item_name: true,
        item_type: true,
        uom: true,
        qty: true,
        balance_date: true,
        remarks: true,
      },
      orderBy: {
        item_code: 'asc',
      },
    });

    return result;
  }

  async getScrapTransactionByIds(
    companyCode: number,
    transactionIds: number[]
  ): Promise<ScrapTransactionData[]> {
    if (transactionIds.length === 0) {
      return [];
    }

    const query = `
      SELECT
        st.id as transaction_id,
        st.company_code,
        c.name as company_name,
        st.transaction_type,
        st.transaction_date,
        st.document_number,
        st.source,
        st.recipient_name,
        st.ppkek_number,
        st.customs_registration_date,
        st.customs_document_type,
        sti.item_type,
        sti.item_code,
        sti.item_name,
        sti.uom,
        sti.qty,
        sti.currency,
        sti.amount
      FROM scrap_transactions st
      INNER JOIN scrap_transaction_items sti
        ON st.id = sti.scrap_transaction_id
        AND st.company_code = sti.scrap_transaction_company
        AND st.transaction_date = sti.scrap_transaction_date
      INNER JOIN companies c
        ON st.company_code = c.code
      WHERE st.company_code = $1
        AND st.id = ANY($2::int[])
        AND st.deleted_at IS NULL
        AND sti.deleted_at IS NULL
      ORDER BY st.transaction_date, st.id
    `;

    const result = await prisma.$queryRawUnsafe<ScrapTransactionData[]>(
      query,
      companyCode,
      transactionIds
    );

    return result;
  }
}
