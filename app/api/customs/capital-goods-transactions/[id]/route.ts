import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { checkStockAvailability } from '@/lib/utils/stock-checker';
import { logActivity } from '@/lib/log-activity';
import { Prisma } from '@prisma/client';

/**
 * Calculate priority for snapshot recalculation queue
 * Backdated transactions (date < today) should have priority 0
 * Same-day transactions (date = today) should have priority -1
 */
function calculatePriority(transactionDate: Date): number {
  const now = new Date();
  const today = new Date(Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
  ));

  if (transactionDate < today) {
    return 0; // Backdated transaction
  } else if (transactionDate.getTime() === today.getTime()) {
    return -1; // Same-day transaction
  }
  return -1; // Default to same-day priority
}

/**
 * Handle snapshot recalculation in transaction
 * Returns the date and whether it's backdated for later direct execution
 */
async function handleTxSnapshotRecalc(
  tx: any,
  companyCode: number,
  date: Date
): Promise<{ date: Date; isBackdated: boolean }> {
  const priority = calculatePriority(date);
  const isBackdated = priority === 0;

  const existingQueue = await tx.snapshot_recalc_queue.findFirst({
    where: {
      company_code: companyCode,
      recalc_date: date,
      item_type: null,
      item_code: null,
    },
  });

  if (existingQueue) {
    await tx.snapshot_recalc_queue.update({
      where: { id: existingQueue.id },
      data: {
        status: 'PENDING',
        priority: priority,
        reason: `Capital goods transaction update for ${date.toISOString().split('T')[0]}`,
        queued_at: new Date(),
      },
    });
  } else {
    await tx.snapshot_recalc_queue.create({
      data: {
        company_code: companyCode,
        item_type: null,
        item_code: null,
        recalc_date: date,
        status: 'PENDING',
        priority: priority,
        reason: `Capital goods transaction update for ${date.toISOString().split('T')[0]}`,
      },
    });
  }

  return { date, isBackdated };
}

/**
 * PUT /api/customs/capital-goods-transactions/[id]
 * Update a capital goods transaction
 *
 * ID format: OUT-{id}-{item_code}-{index}
 * Capital goods transactions come from outgoing_goods table
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };

    // Validate company code
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    const { id } = await params;
    const transactionId = id;

    // Parse the ID to extract the actual DB ID
    if (!transactionId.startsWith('OUT-')) {
      return NextResponse.json(
        { message: 'Invalid transaction ID format' },
        { status: 400 }
      );
    }

    const parts = transactionId.replace('OUT-', '').split('-');
    const actualId = parseInt(parts[0], 10);

    if (isNaN(actualId)) {
      return NextResponse.json(
        { message: 'Invalid transaction ID' },
        { status: 400 }
      );
    }

    // Get the request body
    const body = await request.json();
    const {
      docDate,
      qty,
      currency,
      amount,
      recipientName,
      remarks,
      ppkekNumber,
      registrationDate,
      documentType,
    } = body;

    // Validate qty is provided and is positive
    if (!qty || qty <= 0) {
      return NextResponse.json(
        { message: 'Quantity must be a positive number' },
        { status: 400 }
      );
    }

    // Verify the transaction exists and belongs to the company
    const transaction = await prisma.outgoing_goods.findFirst({
      where: {
        id: actualId,
        company_code: companyCode,
        deleted_at: null,
      },
      include: {
        items: {
          where: {
            deleted_at: null,
            item_type: { in: ['HIBE-M', 'HIBE-E', 'HIBE-T'] },
          },
        },
      },
    });

    if (!transaction) {
      return NextResponse.json(
        { message: 'Transaction not found or already deleted' },
        { status: 404 }
      );
    }

    if (!transaction.items || transaction.items.length === 0) {
      return NextResponse.json(
        { message: 'Transaction item not found' },
        { status: 404 }
      );
    }

    const existingItem = transaction.items[0];
    const qtyDifference = qty - Number(existingItem.qty);

    // Early validation: Check stock availability with detailed information
    let stockCheckResult = null;
    if (qtyDifference > 0) {
      stockCheckResult = await checkStockAvailability(
        companyCode,
        existingItem.item_code,
        existingItem.item_type,
        qtyDifference,
        transaction.outgoing_date
      );

      if (!stockCheckResult.available) {
        return NextResponse.json(
          {
            success: false,
            message: `Stock tidak cukup untuk ${existingItem.item_code}. Tersedia: ${stockCheckResult.currentStock}, Diminta: ${qtyDifference}`,
            errors: [
              {
                field: 'qty',
                message: `Hanya tersedia ${stockCheckResult.currentStock} unit. Anda mencoba menambah ${qtyDifference} unit, kurang ${stockCheckResult.shortfall} unit`,
              },
            ],
            data: {
              itemCode: existingItem.item_code,
              itemType: existingItem.item_type,
              itemName: existingItem.item_name,
              currentQty: Number(existingItem.qty),
              newQty: qty,
              qtyDifference: qtyDifference,
              availableStock: stockCheckResult.currentStock,
              requestedQty: qtyDifference,
              shortfall: stockCheckResult.shortfall,
            },
          },
          { status: 400 }
        );
      }
    } else if (qtyDifference < 0) {
      // When qty is decreased, provide info about stock release
      stockCheckResult = await checkStockAvailability(
        companyCode,
        existingItem.item_code,
        existingItem.item_type,
        Math.abs(qtyDifference),
        transaction.outgoing_date
      );
    } else {
      // When qty is not changed, still fetch current stock info
      stockCheckResult = await checkStockAvailability(
        companyCode,
        existingItem.item_code,
        existingItem.item_type,
        0,
        transaction.outgoing_date
      );
    }

    // Execute update with snapshot recalculation
    const result = await prisma.$transaction(async (tx) => {
      // Update the outgoing good
      // Note: outgoing_date is part of compound key and should not be updated
      await tx.outgoing_goods.update({
        where: { id: actualId },
        data: {
          ppkek_number: ppkekNumber || '',
          customs_registration_date: registrationDate ? new Date(registrationDate) : undefined,
          customs_document_type: documentType || '',
          recipient_name: recipientName || '',
        },
      });

      // Update the outgoing good items using Prisma client (not raw query)
      await tx.outgoing_good_items.update({
        where: {
          id: existingItem.id,
        },
        data: {
          qty: new Prisma.Decimal(qty),
          currency: currency,
          amount: new Prisma.Decimal(amount),
        },
      });

      // Handle snapshot recalculation
      const recalcResult = await handleTxSnapshotRecalc(tx, companyCode, transaction.outgoing_date);

      return recalcResult;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    });

    // Execute direct snapshot recalculation for backdated transactions
    if (result.isBackdated) {
      try {
        await prisma.$executeRawUnsafe(
          'SELECT calculate_stock_snapshot($1::int, $2::date)',
          companyCode,
          result.date
        );
        console.log('[API Info] Backdated snapshot recalculation executed', {
          companyCode,
          date: result.date.toISOString().split('T')[0],
        });
      } catch (recalcError) {
        console.warn('[API Warning] Backdated snapshot recalculation failed', {
          companyCode,
          date: result.date.toISOString().split('T')[0],
          errorMessage: recalcError instanceof Error ? recalcError.message : String(recalcError),
        });
      }
    }

    // Log activity
    await logActivity({
      action: 'EDIT_CAPITAL_GOODS_TRANSACTION',
      description: `Updated capital goods transaction: ${transaction.wms_id} - ${transaction.recipient_name}. Qty changed from ${existingItem.qty} to ${qty}`,
      status: 'success',
      metadata: {
        transactionId,
        wmsId: transaction.wms_id,
        recipientName: transaction.recipient_name,
        oldQty: Number(existingItem.qty),
        newQty: qty,
        companyCode,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Transaction updated successfully',
      data: {
        transactionId,
        wmsId: transaction.wms_id,
        itemCode: existingItem.item_code,
        itemName: existingItem.item_name,
        itemType: existingItem.item_type,
        oldQty: Number(existingItem.qty),
        newQty: qty,
        qtyDifference: qtyDifference,
        currency: currency,
        amount: amount,
        stockInfo: {
          availableStock: stockCheckResult?.currentStock || 0,
          qtyAfterUpdate: qtyDifference < 0 
            ? `${stockCheckResult?.currentStock || 0} + ${Math.abs(qtyDifference)}` 
            : `${stockCheckResult?.currentStock || 0} - ${qtyDifference}`,
        },
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to update capital goods transaction:', error);
    return NextResponse.json(
      { message: 'Error updating transaction', error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customs/capital-goods-transactions/[id]
 * Soft delete a capital goods transaction
 *
 * ID format: OUT-{id}-{item_code}-{index}
 * Capital goods transactions only come from outgoing_goods table
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };

    // Validate company code
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    const { id } = await params;
    const transactionId = id;

    // Parse the ID to extract the actual DB ID
    // Format: OUT-{id}-{item_code}-{index}
    if (!transactionId.startsWith('OUT-')) {
      return NextResponse.json(
        { message: 'Invalid transaction ID format' },
        { status: 400 }
      );
    }

    const parts = transactionId.replace('OUT-', '').split('-');
    const actualId = parseInt(parts[0], 10);

    if (isNaN(actualId)) {
      return NextResponse.json(
        { message: 'Invalid transaction ID' },
        { status: 400 }
      );
    }

    // Check if transaction exists and belongs to the company
    const transaction = await prisma.outgoing_goods.findFirst({
      where: {
        id: actualId,
        company_code: companyCode,
        deleted_at: null,
      },
    });

    if (!transaction) {
      return NextResponse.json(
        { message: 'Transaction not found or already deleted' },
        { status: 404 }
      );
    }

    // Execute delete with snapshot recalculation
    const result = await prisma.$transaction(async (tx) => {
      // Soft delete the record
      await tx.outgoing_goods.update({
        where: { id: actualId },
        data: { deleted_at: new Date() },
      });

      // Handle snapshot recalculation
      const recalcResult = await handleTxSnapshotRecalc(tx, companyCode, transaction.outgoing_date);

      return recalcResult;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    });

    // Execute direct snapshot recalculation for backdated transactions
    if (result.isBackdated) {
      try {
        await prisma.$executeRawUnsafe(
          'SELECT calculate_stock_snapshot($1::int, $2::date)',
          companyCode,
          result.date
        );
        console.log('[API Info] Backdated snapshot recalculation executed', {
          companyCode,
          date: result.date.toISOString().split('T')[0],
        });
      } catch (recalcError) {
        console.warn('[API Warning] Backdated snapshot recalculation failed', {
          companyCode,
          date: result.date.toISOString().split('T')[0],
          errorMessage: recalcError instanceof Error ? recalcError.message : String(recalcError),
        });
      }
    }

    // Log activity
    await logActivity({
      action: 'DELETE_CAPITAL_GOODS_TRANSACTION',
      description: `Deleted capital goods transaction ID: ${transactionId}`,
      status: 'success',
      metadata: {
        transactionId,
        companyCode,
      },
    });

    return NextResponse.json({
      message: 'Transaction deleted successfully',
    });
  } catch (error) {
    console.error('[API Error] Failed to delete capital goods transaction:', error);
    return NextResponse.json(
      { message: 'Error deleting transaction' },
      { status: 500 }
    );
  }
}
