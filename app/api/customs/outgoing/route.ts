import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';

export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const where: any = {};

    if (startDate || endDate) {
      where.outgoing_date = {};
      if (startDate) {
        where.outgoing_date.gte = new Date(startDate);
      }
      if (endDate) {
        where.outgoing_date.lte = new Date(endDate);
      }
    }

    const outgoingHeaders = await prisma.outgoing_goods.findMany({
      where,
      include: {
        items: {
          select: {
            item_code: true,
            item_name: true,
            uom: true,
            qty: true,
            currency: true,
            amount: true,
            hs_code: true,
          },
        },
      },
      orderBy: [
        { outgoing_date: 'desc' },
        { customs_registration_date: 'desc' },
      ],
    });

    const transformedData = outgoingHeaders.flatMap((header) =>
      header.items.map((detail) => ({
        id: header.wms_id + '-' + detail.item_code,
        wmsId: header.wms_id,
        companyCode: header.company_code,
        documentType: header.customs_document_type,
        ppkekNumber: header.ppkek_number,
        registrationDate: header.customs_registration_date,
        documentNumber: header.outgoing_evidence_number,
        date: header.outgoing_date,
        invoiceNumber: header.invoice_number,
        invoiceDate: header.invoice_date,
        recipientName: header.recipient_name,
        itemCode: detail.item_code,
        itemName: detail.item_name,
        unit: detail.uom,
        qty: Number(detail.qty),
        currency: detail.currency,
        amount: Number(detail.amount),
        hsCode: detail.hs_code,
      }))
    );

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error('[API Error] Failed to fetch outgoing documents:', error);
    return NextResponse.json(
      { message: 'Error fetching outgoing documents' },
      { status: 500 }
    );
  }
}
