import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { acquireStockIdentityLocks, checkScrapInBalance, checkStockAvailability, type StockCheckResult } from '@/lib/utils/stock-checker';
import { parseScrapRecordId } from '@/lib/utils/scrap-record-id';
import { logActivity } from '@/lib/log-activity';
import { SCRAP_CUSTOMS_TYPES } from '@/lib/validators/constants/customs-document-types';

class PairIntegrityError extends Error {}
class InsufficientScrapStockError extends Error {
  constructor(public readonly stockCheck: StockCheckResult) {
    super('INSUFFICIENT_SCRAP_STOCK');
  }
}

type RouteContext = { params: Promise<{ id: string }> };

function sameDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

function sharedLineIsConsistent(outgoingItem: any, scrapItem: any): boolean {
  return outgoingItem.item_type === scrapItem.item_type
    && outgoingItem.item_code === scrapItem.item_code
    && outgoingItem.item_name === scrapItem.item_name
    && outgoingItem.uom === scrapItem.uom
    && outgoingItem.qty.equals(scrapItem.qty)
    && outgoingItem.currency === scrapItem.currency
    && outgoingItem.amount.equals(scrapItem.amount)
    && sameDay(outgoingItem.outgoing_good_date, scrapItem.scrap_transaction_date);
}

async function refreshSnapshot(
  tx: Prisma.TransactionClient,
  companyCode: number,
  item: { item_type: string; item_code: string; item_name: string; uom: string },
  date: Date
) {
  await tx.$executeRaw`
    SELECT upsert_item_stock_snapshot(
      ${companyCode}::INTEGER, ${item.item_type}::VARCHAR, ${item.item_code}::VARCHAR,
      ${item.item_name}::VARCHAR, ${item.uom}::VARCHAR, ${date}::DATE
    )
  `;
  await tx.$executeRaw`
    SELECT recalculate_item_snapshots_from_date(
      ${companyCode}::INTEGER, ${item.item_type}::VARCHAR, ${item.item_code}::VARCHAR,
      ${item.uom}::VARCHAR, ${date}::DATE
    )
  `;
}

async function loadOutgoingPair(
  tx: Prisma.TransactionClient,
  companyCode: number,
  headerId: number,
  itemId: number
) {
  const outgoing = await tx.outgoing_goods.findFirst({
    where: { id: headerId, company_code: companyCode, deleted_at: null },
    include: { items: { where: { deleted_at: null } } },
  });
  const outgoingItem = outgoing?.items.find(item => item.id === itemId);
  if (!outgoing || !outgoingItem) {
    throw new PairIntegrityError('Selected Scrap OUT line was not found');
  }

  const [headerReference] = await tx.$queryRaw<Array<{ scrap_transaction_id: number | null }>>`
    SELECT scrap_transaction_id
    FROM outgoing_goods
    WHERE company_code = ${companyCode}
      AND id = ${headerId}
      AND outgoing_date = ${outgoing.outgoing_date}::DATE
  `;
  if (!headerReference?.scrap_transaction_id) {
    throw new PairIntegrityError('Scrap OUT header pair is missing');
  }
  const scrap = await tx.scrap_transactions.findFirst({
    where: { id: headerReference.scrap_transaction_id },
    include: { items: { where: { deleted_at: null } } },
  });
  if (!scrap) throw new PairIntegrityError('Scrap OUT header pair is missing');
  if (scrap.company_code !== companyCode || scrap.transaction_type !== 'OUT' || scrap.deleted_at
    || !sameDay(scrap.transaction_date, outgoing.outgoing_date)
    || scrap.document_number !== outgoing.outgoing_evidence_number
    || scrap.ppkek_number !== outgoing.ppkek_number
    || (scrap.customs_registration_date && outgoing.customs_registration_date
      ? !sameDay(scrap.customs_registration_date, outgoing.customs_registration_date)
      : scrap.customs_registration_date !== outgoing.customs_registration_date)
    || scrap.customs_document_type !== outgoing.customs_document_type
    || scrap.recipient_name !== outgoing.recipient_name) {
    throw new PairIntegrityError('Scrap OUT header pair is inconsistent');
  }
  const itemReferences = await tx.$queryRaw<Array<{ id: number; scrap_transaction_item_id: number | null }>>`
    SELECT id, scrap_transaction_item_id
    FROM outgoing_good_items
    WHERE outgoing_good_company = ${companyCode}
      AND outgoing_good_id = ${headerId}
      AND outgoing_good_date = ${outgoing.outgoing_date}::DATE
      AND deleted_at IS NULL
  `;
  const itemReference = itemReferences.find(reference => reference.id === itemId);
  if (!itemReference?.scrap_transaction_item_id) {
    throw new PairIntegrityError('Scrap OUT line pair is missing');
  }
  if (outgoing.items.length !== scrap.items.length || itemReferences.length !== outgoing.items.length) {
    throw new PairIntegrityError('Paired Scrap OUT headers have different active line counts');
  }
  const scrapItemsById = new Map(scrap.items.map(item => [item.id, item]));
  const referencesById = new Map(itemReferences.map(reference => [reference.id, reference.scrap_transaction_item_id]));
  const allLinesConsistent = outgoing.items.every(item => {
    const pairedId = referencesById.get(item.id);
    const pairedItem = pairedId ? scrapItemsById.get(pairedId) : undefined;
    return pairedItem?.scrap_transaction_id === scrap.id && sharedLineIsConsistent(item, pairedItem);
  });
  if (!allLinesConsistent || new Set(itemReferences.map(item => item.scrap_transaction_item_id)).size !== itemReferences.length) {
    throw new PairIntegrityError('Scrap OUT line pairing is missing or inconsistent');
  }
  const scrapItem = scrap.items.find(item => item.id === itemReference.scrap_transaction_item_id);
  if (!scrapItem || scrapItem.scrap_transaction_id !== scrap.id) {
    throw new PairIntegrityError('Scrap OUT line pair does not belong to its paired header');
  }
  if (!sharedLineIsConsistent(outgoingItem, scrapItem)) {
    throw new PairIntegrityError('Scrap OUT copies have diverged; no changes were applied');
  }
  return { outgoing, outgoingItem, scrap, scrapItem };
}

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) return authCheck.response;
    const companyValidation = validateCompanyCode((authCheck as any).session);
    if (!companyValidation.success) return companyValidation.response;
    const { companyCode } = companyValidation;
    const rawId = (await params).id;
    const parsedId = parseScrapRecordId(rawId);
    if (!parsedId) {
      return NextResponse.json({ message: 'A stable header and line ID is required. Refresh and retry.' }, { status: 400 });
    }

    const body = await request.json();
    const qty = Number(body.qty);
    const amount = Number(body.amount);
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ message: 'Quantity must be a positive number' }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ message: 'Amount must be non-negative' }, { status: 400 });
    }
    if (!body.currency) return NextResponse.json({ message: 'Currency is required' }, { status: 400 });
    if (body.customsDocumentType && !SCRAP_CUSTOMS_TYPES.includes(body.customsDocumentType)) {
      return NextResponse.json({ message: `Customs document type must be one of: ${SCRAP_CUSTOMS_TYPES.join(', ')}` }, { status: 400 });
    }

    if (parsedId.source === 'scrap_transactions') {
      const current = await prisma.scrap_transactions.findFirst({
        where: { id: parsedId.headerId, company_code: companyCode, transaction_type: 'IN', deleted_at: null },
        include: { items: { where: { id: parsedId.itemId, deleted_at: null } } },
      });
      if (!current || current.items.length !== 1) {
        return NextResponse.json({ message: 'Scrap IN line not found' }, { status: 404 });
      }
      const [item] = current.items;
      const balance = await checkScrapInBalance(companyCode, item.item_code, item.item_type,
        Number(item.qty), qty, current.transaction_date, current.id);
      if (!balance.available) {
        return NextResponse.json({ message: 'Stock would become negative', data: balance }, { status: 400 });
      }
      await prisma.$transaction(async tx => {
        await tx.scrap_transactions.update({
          where: { id: current.id },
          data: {
            ppkek_number: body.ppkekNumber || null,
            customs_registration_date: body.registrationDate ? new Date(body.registrationDate) : null,
            customs_document_type: body.customsDocumentType || null,
            recipient_name: body.recipientName || null,
            remarks: body.remarks || null,
            ...(body.transactionNumber && { document_number: body.transactionNumber }),
          },
        });
        await tx.scrap_transaction_items.update({
          where: { id: item.id },
          data: { qty: new Prisma.Decimal(qty), currency: body.currency, amount: new Prisma.Decimal(amount) },
        });
        await refreshSnapshot(tx, companyCode, item, current.transaction_date);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    } else {
      await prisma.$transaction(async tx => {
        const initial = await loadOutgoingPair(tx, companyCode, parsedId.headerId, parsedId.itemId);
        await acquireStockIdentityLocks(tx, companyCode, [{
          itemType: initial.outgoingItem.item_type,
          itemCode: initial.outgoingItem.item_code,
          uom: initial.outgoingItem.uom,
        }]);
        const { outgoing, outgoingItem, scrap, scrapItem } = await loadOutgoingPair(
          tx, companyCode, parsedId.headerId, parsedId.itemId
        );
        const difference = qty - Number(outgoingItem.qty);
        if (difference > 0) {
          const stock = await checkStockAvailability(companyCode, outgoingItem.item_code,
            outgoingItem.item_type, difference, outgoing.outgoing_date, undefined, outgoingItem.uom, tx);
          if (!stock.available) throw new InsufficientScrapStockError(stock);
        }

        const documentNumber = body.transactionNumber || outgoing.outgoing_evidence_number;
        const ppkekNumber = body.ppkekNumber || outgoing.ppkek_number;
        const sharedHeaderData = {
          ppkek_number: ppkekNumber,
          customs_registration_date: body.registrationDate ? new Date(body.registrationDate) : null,
          customs_document_type: body.customsDocumentType || null,
          recipient_name: body.recipientName || '',
        };
        await tx.outgoing_goods.update({
          where: { id: outgoing.id },
          data: { ...sharedHeaderData, outgoing_evidence_number: documentNumber },
        });
        await tx.scrap_transactions.update({
          where: { id: scrap.id },
          data: { ...sharedHeaderData, document_number: documentNumber, remarks: body.remarks || null },
        });
        const sharedItemData = {
          qty: new Prisma.Decimal(qty), currency: body.currency, amount: new Prisma.Decimal(amount),
        };
        await tx.outgoing_good_items.update({
          where: { id: outgoingItem.id },
          data: { ...sharedItemData, incoming_ppkek_numbers: body.incomingPpkekNumbers || [] },
        });
        await tx.scrap_transaction_items.update({ where: { id: scrapItem.id }, data: sharedItemData });
        await refreshSnapshot(tx, companyCode, outgoingItem, outgoing.outgoing_date);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    }

    await logActivity({ action: 'EDIT_SCRAP_TRANSACTION', description: `Updated exact Scrap line: ${rawId}`,
      status: 'success', metadata: { transactionId: rawId, companyCode } });
    return NextResponse.json({ success: true, message: 'Transaction line updated successfully' });
  } catch (error) {
    if (error instanceof PairIntegrityError) {
      return NextResponse.json({ message: error.message, code: 'SCRAP_PAIR_INTEGRITY_ERROR' }, { status: 409 });
    }
    if (error instanceof InsufficientScrapStockError) {
      return NextResponse.json({ message: 'Insufficient Scrap stock', data: error.stockCheck }, { status: 400 });
    }
    console.error('[Scrap edit]', error);
    return NextResponse.json({ message: 'Error updating transaction' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) return authCheck.response;
    const companyValidation = validateCompanyCode((authCheck as any).session);
    if (!companyValidation.success) return companyValidation.response;
    const { companyCode } = companyValidation;
    const rawId = (await params).id;
    const parsedId = parseScrapRecordId(rawId);
    if (!parsedId) {
      return NextResponse.json({ message: 'A stable header and line ID is required. Refresh and retry.' }, { status: 400 });
    }

    if (parsedId.source === 'scrap_transactions') {
      const current = await prisma.scrap_transactions.findFirst({
        where: { id: parsedId.headerId, company_code: companyCode, transaction_type: 'IN', deleted_at: null },
        include: { items: { where: { id: parsedId.itemId, deleted_at: null } } },
      });
      if (!current || current.items.length !== 1) {
        return NextResponse.json({ message: 'Scrap IN line not found' }, { status: 404 });
      }
      const [item] = current.items;
      const balance = await checkScrapInBalance(companyCode, item.item_code, item.item_type,
        Number(item.qty), 0, current.transaction_date, current.id);
      if (!balance.available) {
        return NextResponse.json({ message: 'Stock would become negative', data: balance }, { status: 400 });
      }
      await prisma.$transaction(async tx => {
        const deletedAt = new Date();
        await tx.scrap_transaction_items.update({ where: { id: item.id }, data: { deleted_at: deletedAt } });
        const remaining = await tx.scrap_transaction_items.count({
          where: { scrap_transaction_id: current.id, deleted_at: null },
        });
        if (remaining === 0) {
          await tx.scrap_transactions.update({ where: { id: current.id }, data: { deleted_at: deletedAt } });
        }
        await refreshSnapshot(tx, companyCode, item, current.transaction_date);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    } else {
      await prisma.$transaction(async tx => {
        const initial = await loadOutgoingPair(tx, companyCode, parsedId.headerId, parsedId.itemId);
        await acquireStockIdentityLocks(tx, companyCode, [{
          itemType: initial.outgoingItem.item_type,
          itemCode: initial.outgoingItem.item_code,
          uom: initial.outgoingItem.uom,
        }]);
        const { outgoing, outgoingItem, scrap, scrapItem } = await loadOutgoingPair(
          tx, companyCode, parsedId.headerId, parsedId.itemId
        );
        const outgoingRemaining = outgoing.items.length - 1;
        const deletedAt = new Date();
        await tx.outgoing_good_items.update({ where: { id: outgoingItem.id }, data: { deleted_at: deletedAt } });
        await tx.scrap_transaction_items.update({ where: { id: scrapItem.id }, data: { deleted_at: deletedAt } });
        if (outgoingRemaining === 0) {
          await tx.outgoing_goods.update({ where: { id: outgoing.id }, data: { deleted_at: deletedAt } });
          await tx.scrap_transactions.update({ where: { id: scrap.id }, data: { deleted_at: deletedAt } });
        }
        await refreshSnapshot(tx, companyCode, outgoingItem, outgoing.outgoing_date);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    }

    await logActivity({ action: 'DELETE_SCRAP_TRANSACTION', description: `Deleted exact Scrap line: ${rawId}`,
      status: 'success', metadata: { transactionId: rawId, sourceTable: parsedId.source, companyCode } });
    return NextResponse.json({ success: true, message: 'Transaction line deleted successfully' });
  } catch (error) {
    if (error instanceof PairIntegrityError) {
      return NextResponse.json({ message: error.message, code: 'SCRAP_PAIR_INTEGRITY_ERROR' }, { status: 409 });
    }
    console.error('[Scrap delete]', error);
    return NextResponse.json({ message: 'Error deleting transaction' }, { status: 500 });
  }
}
