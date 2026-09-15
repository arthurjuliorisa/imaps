import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { acquireStockIdentityLocks, checkScrapInBalance, checkStockAvailability, type StockCheckResult } from '@/lib/utils/stock-checker';
import { parseScrapRecordId } from '@/lib/utils/scrap-record-id';
import { logActivity } from '@/lib/log-activity';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { SCRAP_CUSTOMS_TYPES } from '@/lib/validators/constants/customs-document-types';
import { acquireScrapInswLock, assertScrapMutable, ScrapInswLockedError } from '@/lib/scrap-insw-finalization';

class PairIntegrityError extends Error {}
class InsufficientScrapStockError extends Error {
  constructor(public readonly stockCheck: StockCheckResult) {
    super('INSUFFICIENT_SCRAP_STOCK');
  }
}

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Loads one transaction header for the details dialog. The list intentionally
 * remains line-addressable for edit/delete compatibility, while this endpoint
 * makes the header scope (and all active lines) explicit for viewing/sending.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) return authCheck.response;
    const companyValidation = validateCompanyCode((authCheck as any).session);
    if (!companyValidation.success) return companyValidation.response;
    const { companyCode } = companyValidation;
    const parsedId = parseScrapRecordId((await params).id);
    if (!parsedId) return NextResponse.json({ message: 'Invalid scrap transaction record ID' }, { status: 400 });

    const company = await prisma.companies.findUnique({
      where: { code: companyCode },
      select: { company_type: true, name: true },
    });
    const isSez = company?.company_type === 'SEZ';

    let header: any;
    let items: any[];
    let inswTransactionId: number | null;
    let transactionType: 'IN' | 'OUT';

    if (parsedId.source === 'scrap_transactions') {
      header = await prisma.scrap_transactions.findFirst({
        where: { id: parsedId.headerId, company_code: companyCode, transaction_type: 'IN', deleted_at: null },
        include: { items: { where: { deleted_at: null }, orderBy: { id: 'asc' } } },
      });
      if (!header) return NextResponse.json({ message: 'Scrap transaction not found' }, { status: 404 });
      items = header.items;
      inswTransactionId = header.id;
      transactionType = 'IN';
    } else {
      header = await prisma.outgoing_goods.findFirst({
        where: { id: parsedId.headerId, company_code: companyCode, deleted_at: null },
        include: { items: { where: { item_type: 'SCRAP', deleted_at: null }, orderBy: { id: 'asc' } }, scrap_transaction: { select: { remarks: true } } },
      });
      if (!header) return NextResponse.json({ message: 'Scrap transaction not found' }, { status: 404 });
      items = header.items;
      inswTransactionId = header.scrap_transaction_id;
      transactionType = 'OUT';
    }

    const trackingAttempts = isSez && inswTransactionId
      ? await prisma.insw_tracking_log.findMany({
          where: { company_code: companyCode, transaction_type: transactionType === 'IN' ? 'scrap_in' : 'scrap_out', transaction_id: inswTransactionId },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          select: { insw_status: true, created_at: true, insw_error: true },
        })
      : [];
    const tracking = trackingAttempts[0] ?? null;

    const inswStatus = !isSez ? undefined : trackingAttempts.some(attempt => attempt.insw_status === 'SUCCESS') ? 'SUCCESS'
      : tracking?.insw_status === 'FAILED' ? 'FAILED'
      : tracking ? 'PENDING' : 'NOT_SENT';

    const detail = transactionType === 'IN'
      ? {
          transactionNumber: header.document_number,
          transactionDate: header.transaction_date,
          direction: 'IN',
          documentNumber: header.document_number,
          documentDate: header.transaction_date,
          documentType: header.customs_document_type,
          registrationNumber: header.ppkek_number,
          registrationDate: header.customs_registration_date,
          recipientName: null,
          remarks: header.remarks,
          items: items.map(item => ({ code: item.item_code, name: item.item_name, itemType: item.item_type, quantity: item.qty, uom: item.uom, currency: item.currency, valueAmount: item.amount })),
        }
      : {
          transactionNumber: header.outgoing_evidence_number,
          transactionDate: header.outgoing_date,
          direction: 'OUT',
          documentNumber: header.outgoing_evidence_number,
          documentDate: header.invoice_date,
          documentType: header.customs_document_type,
          registrationNumber: header.ppkek_number,
          registrationDate: header.customs_registration_date,
          recipientName: header.recipient_name,
          // The paired Scrap header remains the canonical home for Scrap OUT remarks.
          remarks: header.scrap_transaction?.remarks ?? null,
          items: items.map(item => ({ code: item.item_code, name: item.item_name, itemType: item.item_type, quantity: item.qty, uom: item.uom, currency: item.currency, valueAmount: item.amount })),
        };

    return NextResponse.json(serializeBigInt({
      data: { ...detail, companyName: company?.name, isSez, inswStatus, lastAttempt: tracking ? { status: tracking.insw_status, at: tracking.created_at, message: tracking.insw_error } : null },
    }));
  } catch (error) {
    console.error('[API Error] Failed to fetch scrap transaction details:', error);
    return NextResponse.json({ message: 'Error fetching scrap transaction details' }, { status: 500 });
  }
}

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
    // Header edits intentionally do not accept line values.  The stable line
    // reference only identifies the parent header; the mutation itself is
    // locked and checked against that parent INSW finalization state.
    if (body.scope === 'header') {
      if (parsedId.source === 'outgoing_goods' && body.customsDocumentType && !SCRAP_CUSTOMS_TYPES.includes(body.customsDocumentType)) {
        return NextResponse.json({ message: `Customs document type must be one of: ${SCRAP_CUSTOMS_TYPES.join(', ')}` }, { status: 400 });
      }
      await prisma.$transaction(async tx => {
        if (parsedId.source === 'scrap_transactions') {
          const header = await tx.scrap_transactions.findFirst({
            where: { id: parsedId.headerId, company_code: companyCode, transaction_type: 'IN', deleted_at: null },
          });
          if (!header) throw new PairIntegrityError('Scrap transaction not found');
          await acquireScrapInswLock(tx, companyCode, header.id);
          await assertScrapMutable(tx, companyCode, header.id, 'IN');
          await tx.scrap_transactions.update({ where: { id: header.id }, data: {
            document_number: body.transactionNumber || header.document_number,
            ppkek_number: body.ppkekNumber || null,
            customs_registration_date: body.registrationDate ? new Date(body.registrationDate) : null,
            // Manual Scrap IN has no customs document type or recipient.
            customs_document_type: null,
            recipient_name: null,
            remarks: body.remarks || null,
          }});
        } else {
          const pair = await loadOutgoingPair(tx, companyCode, parsedId.headerId, parsedId.itemId);
          await acquireScrapInswLock(tx, companyCode, pair.scrap.id);
          await assertScrapMutable(tx, companyCode, pair.scrap.id, 'OUT');
          const documentNumber = body.transactionNumber || pair.outgoing.outgoing_evidence_number;
          const shared = {
            ppkek_number: body.ppkekNumber || null,
            customs_registration_date: body.registrationDate ? new Date(body.registrationDate) : null,
            customs_document_type: body.customsDocumentType || null,
            recipient_name: body.recipientName || '',
          };
          await tx.outgoing_goods.update({ where: { id: pair.outgoing.id }, data: { ...shared, outgoing_evidence_number: documentNumber } });
          await tx.scrap_transactions.update({ where: { id: pair.scrap.id }, data: { ...shared, document_number: documentNumber, remarks: body.remarks || null } });
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
      await logActivity({ action: 'EDIT_SCRAP_TRANSACTION_HEADER', description: `Updated Scrap header: ${rawId}`,
        status: 'success', metadata: { transactionId: rawId, companyCode } });
      return NextResponse.json({ success: true, message: 'Transaction header updated successfully' });
    }
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
        await acquireScrapInswLock(tx, companyCode, current.id);
        await assertScrapMutable(tx, companyCode, current.id, 'IN');
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
        await acquireScrapInswLock(tx, companyCode, scrap.id);
        await assertScrapMutable(tx, companyCode, scrap.id, 'OUT');
        const difference = qty - Number(outgoingItem.qty);
        if (difference > 0) {
          const stock = await checkStockAvailability(companyCode, outgoingItem.item_code,
            outgoingItem.item_type, difference, outgoing.outgoing_date, undefined, outgoingItem.uom, tx);
          if (!stock.available) throw new InsufficientScrapStockError(stock);
        }

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
    if (error instanceof ScrapInswLockedError) {
      return NextResponse.json({ message: error.message, status: error.status, code: 'SCRAP_INSW_LOCKED' }, { status: 409 });
    }
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

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) return authCheck.response;
    const companyValidation = validateCompanyCode((authCheck as any).session);
    if (!companyValidation.success) return companyValidation.response;
    const { companyCode } = companyValidation;
    const rawId = (await params).id;
    const deleteHeader = new URL(request.url).searchParams.get('scope') === 'header';
    const parsedId = parseScrapRecordId(rawId);
    if (!parsedId) {
      return NextResponse.json({ message: 'A stable header and line ID is required. Refresh and retry.' }, { status: 400 });
    }

    if (parsedId.source === 'scrap_transactions') {
      const current = await prisma.scrap_transactions.findFirst({
        where: { id: parsedId.headerId, company_code: companyCode, transaction_type: 'IN', deleted_at: null },
        include: { items: { where: deleteHeader ? { deleted_at: null } : { id: parsedId.itemId, deleted_at: null } } },
      });
      if (!current || current.items.length === 0 || (!deleteHeader && current.items.length !== 1)) {
        return NextResponse.json({ message: 'Scrap IN line not found' }, { status: 404 });
      }
      for (const item of current.items) {
        const balance = await checkScrapInBalance(companyCode, item.item_code, item.item_type,
          Number(item.qty), 0, current.transaction_date, current.id);
        if (!balance.available) {
          return NextResponse.json({ message: 'Stock would become negative', data: balance }, { status: 400 });
        }
      }
      await prisma.$transaction(async tx => {
        await acquireScrapInswLock(tx, companyCode, current.id);
        await assertScrapMutable(tx, companyCode, current.id, 'IN');
        const deletedAt = new Date();
        if (deleteHeader) {
          await tx.scrap_transaction_items.updateMany({ where: { scrap_transaction_id: current.id, deleted_at: null }, data: { deleted_at: deletedAt } });
          await tx.scrap_transactions.update({ where: { id: current.id }, data: { deleted_at: deletedAt } });
        } else {
          const [item] = current.items;
          await tx.scrap_transaction_items.update({ where: { id: item.id }, data: { deleted_at: deletedAt } });
          const remaining = await tx.scrap_transaction_items.count({ where: { scrap_transaction_id: current.id, deleted_at: null } });
          if (remaining === 0) await tx.scrap_transactions.update({ where: { id: current.id }, data: { deleted_at: deletedAt } });
        }
        for (const item of current.items) await refreshSnapshot(tx, companyCode, item, current.transaction_date);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    } else {
      await prisma.$transaction(async tx => {
        const initial = await loadOutgoingPair(tx, companyCode, parsedId.headerId, parsedId.itemId);
        await acquireStockIdentityLocks(tx, companyCode, (deleteHeader ? initial.outgoing.items : [initial.outgoingItem]).map(item => ({ itemType: item.item_type, itemCode: item.item_code, uom: item.uom })));
        const { outgoing, outgoingItem, scrap, scrapItem } = await loadOutgoingPair(
          tx, companyCode, parsedId.headerId, parsedId.itemId
        );
        await acquireScrapInswLock(tx, companyCode, scrap.id);
        await assertScrapMutable(tx, companyCode, scrap.id, 'OUT');
        const deletedAt = new Date();
        if (deleteHeader) {
          await tx.outgoing_good_items.updateMany({ where: { outgoing_good_id: outgoing.id, item_type: 'SCRAP', deleted_at: null }, data: { deleted_at: deletedAt } });
          await tx.scrap_transaction_items.updateMany({ where: { scrap_transaction_id: scrap.id, deleted_at: null }, data: { deleted_at: deletedAt } });
          await tx.outgoing_goods.update({ where: { id: outgoing.id }, data: { deleted_at: deletedAt } });
          await tx.scrap_transactions.update({ where: { id: scrap.id }, data: { deleted_at: deletedAt } });
        } else {
          const outgoingRemaining = outgoing.items.length - 1;
          await tx.outgoing_good_items.update({ where: { id: outgoingItem.id }, data: { deleted_at: deletedAt } });
          await tx.scrap_transaction_items.update({ where: { id: scrapItem.id }, data: { deleted_at: deletedAt } });
          if (outgoingRemaining === 0) {
            await tx.outgoing_goods.update({ where: { id: outgoing.id }, data: { deleted_at: deletedAt } });
            await tx.scrap_transactions.update({ where: { id: scrap.id }, data: { deleted_at: deletedAt } });
          }
        }
        for (const item of deleteHeader ? outgoing.items : [outgoingItem]) await refreshSnapshot(tx, companyCode, item, outgoing.outgoing_date);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    }

    await logActivity({ action: 'DELETE_SCRAP_TRANSACTION', description: `Deleted exact Scrap line: ${rawId}`,
      status: 'success', metadata: { transactionId: rawId, sourceTable: parsedId.source, companyCode } });
    return NextResponse.json({ success: true, message: 'Transaction line deleted successfully' });
  } catch (error) {
    if (error instanceof ScrapInswLockedError) {
      return NextResponse.json({ message: error.message, status: error.status, code: 'SCRAP_INSW_LOCKED' }, { status: 409 });
    }
    if (error instanceof PairIntegrityError) {
      return NextResponse.json({ message: error.message, code: 'SCRAP_PAIR_INTEGRITY_ERROR' }, { status: 409 });
    }
    console.error('[Scrap delete]', error);
    return NextResponse.json({ message: 'Error deleting transaction' }, { status: 500 });
  }
}
