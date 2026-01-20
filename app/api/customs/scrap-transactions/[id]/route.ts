import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { checkStockAvailability, checkScrapInBalance } from '@/lib/utils/stock-checker';
import { logActivity } from '@/lib/log-activity';
import { Prisma } from '@prisma/client';



/**
 * PUT /api/customs/scrap-transactions/[id]
 * Update a scrap transaction
 *
 * Only scrap_transactions table records can be updated (ID starts with SCRAP_)
 * Outgoing_goods records should be updated from the outgoing page
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

    // Parse the ID to determine the source and extract the actual DB ID
    let sourceTable: 'scrap_transactions' | 'outgoing_goods';
    let actualId: number;

    if (transactionId.startsWith('SCRAP_')) {
      sourceTable = 'scrap_transactions';
      // Extract ID from format: SCRAP_{id}-{item_code}-{index}
      const parts = transactionId.replace('SCRAP_', '').split('-');
      actualId = parseInt(parts[0], 10);
    } else if (transactionId.startsWith('OUTGOING_')) {
      sourceTable = 'outgoing_goods';
      // Extract ID from format: OUTGOING_{id}-{item_code}-{index}
      const parts = transactionId.replace('OUTGOING_', '').split('-');
      actualId = parseInt(parts[0], 10);
    } else {
      return NextResponse.json(
        { message: 'Invalid transaction ID format' },
        { status: 400 }
      );
    }

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
      customsDocumentType,
      transactionNumber,
      incomingPpkekNumbers,
    } = body;

    // Validate qty is provided and is positive
    if (!qty || qty <= 0) {
      return NextResponse.json(
        { message: 'Quantity must be a positive number' },
        { status: 400 }
      );
    }

    // Verify the transaction exists and belongs to the company
    let transaction: any;
    let existingItem: any;

    if (sourceTable === 'scrap_transactions') {
      const scrapTx = await prisma.scrap_transactions.findFirst({
        where: {
          id: actualId,
          company_code: companyCode,
          deleted_at: null,
        },
        include: {
          items: {
            where: {
              deleted_at: null,
            },
          },
        },
      });

      if (!scrapTx) {
        return NextResponse.json(
          { message: 'Transaction not found or already deleted' },
          { status: 404 }
        );
      }

      if (!scrapTx.items || scrapTx.items.length === 0) {
        return NextResponse.json(
          { message: 'Transaction item not found' },
          { status: 404 }
        );
      }

      transaction = scrapTx;
      existingItem = scrapTx.items[0];
    } else {
      // outgoing_goods
      const outgoingTx = await prisma.outgoing_goods.findFirst({
        where: {
          id: actualId,
          company_code: companyCode,
          deleted_at: null,
        },
        include: {
          items: {
            where: {
              deleted_at: null,
            },
          },
        },
      });

      if (!outgoingTx) {
        return NextResponse.json(
          { message: 'Transaction not found or already deleted' },
          { status: 404 }
        );
      }

      if (!outgoingTx.items || outgoingTx.items.length === 0) {
        return NextResponse.json(
          { message: 'Transaction item not found' },
          { status: 404 }
        );
      }

      transaction = outgoingTx;
      existingItem = outgoingTx.items[0];
    }

    const qtyDifference = qty - Number(existingItem.qty);

    // Validation for SCRAP IN: Check stock balance won't go negative
    // Validation for SCRAP OUT: Check stock availability when qty increases
    let stockCheckResult = null;
    if (sourceTable === 'scrap_transactions') {
      // For SCRAP IN, use balance check to ensure balance won't go negative
      stockCheckResult = await checkScrapInBalance(
        companyCode,
        existingItem.item_code,
        existingItem.item_type,
        Number(existingItem.qty),
        qty,
        transaction.transaction_date,
        actualId
      );

      // If balance would go negative, reject
      if (!stockCheckResult.available) {
        const qtyDecrease = Number(existingItem.qty) - qty;
        return NextResponse.json(
          {
            success: false,
            message: `Stock akan menjadi minus. Saat ini balance ${stockCheckResult.currentStock} unit. Anda mencoba mengurangi ${qtyDecrease} unit.`,
            errors: [
              {
                field: 'qty',
                message: `Mengurangi qty sebesar ${qtyDecrease} akan membuat balance minus ${stockCheckResult.shortfall} unit. Current balance: ${stockCheckResult.currentStock}`,
              },
            ],
            data: {
              itemCode: existingItem.item_code,
              itemType: existingItem.item_type,
              itemName: existingItem.item_name,
              currentQty: Number(existingItem.qty),
              newQty: qty,
              qtyDifference: qtyDifference,
              currentBalance: stockCheckResult.currentStock,
              qtyReduction: qtyDecrease,
              shortfall: stockCheckResult.shortfall,
            },
          },
          { status: 400 }
        );
      }
    } else if (sourceTable === 'outgoing_goods' && qtyDifference > 0) {
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
    } else if (sourceTable === 'outgoing_goods') {
      // For outgoing_goods OUT transactions, always fetch current stock info
      if (qtyDifference < 0) {
        stockCheckResult = await checkStockAvailability(
          companyCode,
          existingItem.item_code,
          existingItem.item_type,
          Math.abs(qtyDifference),
          transaction.outgoing_date
        );
      } else {
        stockCheckResult = await checkStockAvailability(
          companyCode,
          existingItem.item_code,
          existingItem.item_type,
          0,
          transaction.outgoing_date
        );
      }
    }

    // Update transaction wrapped in a transaction with snapshot recalculation
    // Collect item info BEFORE transaction for snapshot calculation (needed for both scrap and outgoing)
    const itemsToSnapshot = [];
    if (sourceTable === 'scrap_transactions') {
      itemsToSnapshot.push({
        itemType: existingItem.item_type,
        itemCode: existingItem.item_code,
        itemName: existingItem.item_name,
        uom: existingItem.uom,
        date: transaction.transaction_date,
      });
    } else {
      // For outgoing_goods, collect the item being edited (existingItem already set above)
      itemsToSnapshot.push({
        itemType: existingItem.item_type,
        itemCode: existingItem.item_code,
        itemName: existingItem.item_name,
        uom: existingItem.uom,
        date: transaction.outgoing_date,
      });
    }
    
    await prisma.$transaction(
      async (tx) => {
        if (sourceTable === 'scrap_transactions') {
          // Update the scrap transaction
          // Note: transaction_date is part of compound key and cannot be updated
          try {
            await tx.scrap_transactions.update({
              where: { id: actualId },
              data: {
                ppkek_number: ppkekNumber || '',
                customs_registration_date: registrationDate ? new Date(registrationDate) : undefined,
                customs_document_type: customsDocumentType || '',
                recipient_name: recipientName || '',
                remarks: remarks || '',
                ...(transactionNumber && { document_number: transactionNumber }),
              },
            });
            // console.log('✅ Parent transaction updated successfully');
          } catch (error) {
            // console.error('❌ Error updating parent transaction:', error);
            throw error;
          }
        } else {
          // Update outgoing_goods transaction
          try {
            await tx.outgoing_goods.update({
              where: { id: actualId },
              data: {
                ppkek_number: ppkekNumber || '',
                customs_registration_date: registrationDate ? new Date(registrationDate) : undefined,
                customs_document_type: customsDocumentType || null,
                recipient_name: recipientName || '',
                ...(transactionNumber && { outgoing_evidence_number: transactionNumber }),
              },
            });
          } catch (error) {
            throw error;
          }
        }

        // Update the transaction items
        try {
          if (sourceTable === 'scrap_transactions') {
            await tx.scrap_transaction_items.update({
              where: {
                id: existingItem.id,
              },
              data: {
                qty: new Prisma.Decimal(qty),
                currency: currency,
                amount: new Prisma.Decimal(amount),
              },
            });
          } else {
            // For outgoing_goods, update outgoing_good_items
            await tx.outgoing_good_items.update({
              where: {
                id: existingItem.id,
              },
              data: {
                qty: new Prisma.Decimal(qty),
                currency: currency,
                amount: new Prisma.Decimal(amount),
                incoming_ppkek_numbers: incomingPpkekNumbers || [],
              },
            });
          }
          console.log('✅ Items updated successfully');
        } catch (error) {
          console.error('❌ Error updating items:', error);
          throw error;
        }
      },
      {
        isolationLevel: 'Serializable',
      }
    );

    // Execute direct snapshot calculation asynchronously (fire-and-forget)
    if (itemsToSnapshot.length > 0) {
      console.log('[EDIT] Starting snapshot recalculation for items:', itemsToSnapshot);
      (async () => {
        for (const item of itemsToSnapshot) {
          try {
            console.log('[EDIT] Processing item:', item);
            // Step 1: Upsert snapshot for the edited transaction date
            await prisma.$executeRawUnsafe(
              'SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)',
              companyCode,
              item.itemType,
              item.itemCode,
              item.itemName,
              item.uom,
              item.date
            );
            console.log('[API Info] Direct snapshot calculation executed', {
              companyCode,
              itemType: item.itemType,
              itemCode: item.itemCode,
              date: item.date.toISOString().split('T')[0],
            });

            // Step 2: Cascade recalculate snapshots for all future dates
            // This ensures all forward-looking balance updates when qty is changed
            console.log('[EDIT] Calling recalculate_item_snapshots_from_date for:', {
              companyCode,
              itemType: item.itemType,
              itemCode: item.itemCode,
              fromDate: item.date.toISOString().split('T')[0],
            });
            await prisma.$executeRawUnsafe(
              'SELECT recalculate_item_snapshots_from_date($1::int, $2::varchar, $3::varchar, $4::date)',
              companyCode,
              item.itemType,
              item.itemCode,
              item.date
            );
            console.log('[API Info] Cascaded snapshot recalculation executed', {
              companyCode,
              itemType: item.itemType,
              itemCode: item.itemCode,
              fromDate: item.date.toISOString().split('T')[0],
            });
          } catch (snapshotError) {
            console.error('[API Error] Snapshot calculation failed', {
              companyCode,
              itemType: item.itemType,
              itemCode: item.itemCode,
              date: item.date.toISOString().split('T')[0],
              errorMessage: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
            });
          }
        }
      })().catch(err => console.error('[API Error] Background snapshot task failed:', err));
    } else {
      console.log('[EDIT] No items to snapshot, itemsToSnapshot.length =', itemsToSnapshot.length);
    }

    // Log activity
    await logActivity({
      action: 'EDIT_SCRAP_TRANSACTION',
      description: `Updated scrap transaction: ${transaction.document_number}. Qty changed from ${existingItem.qty} to ${qty}`,
      status: 'success',
      metadata: {
        transactionId,
        documentNumber: transaction.document_number,
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
        documentNumber: sourceTable === 'scrap_transactions' ? transaction.document_number : transaction.outgoing_evidence_number,
        itemCode: existingItem.item_code,
        itemName: existingItem.item_name,
        itemType: existingItem.item_type,
        oldQty: Number(existingItem.qty),
        newQty: qty,
        qtyDifference: qtyDifference,
        currency: currency,
        amount: amount,
        ...(sourceTable === 'outgoing_goods' && {
          stockInfo: {
            availableStock: stockCheckResult?.currentStock || 0,
            qtyAfterUpdate: qtyDifference < 0 
              ? `${stockCheckResult?.currentStock || 0} + ${Math.abs(qtyDifference)}` 
              : `${stockCheckResult?.currentStock || 0} - ${qtyDifference}`,
          },
        }),
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to update scrap transaction:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    return NextResponse.json(
      { message: 'Error updating transaction', error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customs/scrap-transactions/[id]
 * Soft delete a scrap transaction
 *
 * ID format:
 * - SCRAP_{id}-{item_code}-{index} for scrap_transactions
 * - OUTGOING_{id}-{item_code}-{index} for outgoing_goods
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

    // Parse the ID to determine the source and extract the actual DB ID
    let sourceTable: 'scrap_transactions' | 'outgoing_goods';
    let actualId: number;

    if (transactionId.startsWith('SCRAP_')) {
      sourceTable = 'scrap_transactions';
      // Extract ID from format: SCRAP_{id}-{item_code}-{index}
      const parts = transactionId.replace('SCRAP_', '').split('-');
      actualId = parseInt(parts[0], 10);
    } else if (transactionId.startsWith('OUTGOING_')) {
      sourceTable = 'outgoing_goods';
      // Extract ID from format: OUTGOING_{id}-{item_code}-{index}
      const parts = transactionId.replace('OUTGOING_', '').split('-');
      actualId = parseInt(parts[0], 10);
    } else {
      return NextResponse.json(
        { message: 'Invalid transaction ID format' },
        { status: 400 }
      );
    }

    if (isNaN(actualId)) {
      return NextResponse.json(
        { message: 'Invalid transaction ID' },
        { status: 400 }
      );
    }

    console.log(`[DELETE] transactionId=${transactionId}, sourceTable=${sourceTable}, actualId=${actualId}`);

    // Soft delete the record with snapshot recalculation
    if (sourceTable === 'scrap_transactions') {
      console.log(`[DELETE] Using scrap_transactions path`);
      const transactionData = await prisma.scrap_transactions.findFirst({
        where: {
          id: actualId,
          company_code: companyCode,
          deleted_at: null,
        },
        include: {
          items: {
            where: {
              deleted_at: null,
            },
          },
        },
      });

      if (!transactionData) {
        return NextResponse.json(
          { message: 'Transaction not found or already deleted' },
          { status: 404 }
        );
      }

      if (!transactionData.items || transactionData.items.length === 0) {
        return NextResponse.json(
          { message: 'Transaction item not found' },
          { status: 404 }
        );
      }

      const item = transactionData.items[0];
      const itemQty = Number(item.qty);

      // Validation: Check stock balance won't go negative when deleting SCRAP IN
      // When we delete a SCRAP IN transaction, balance will reduce by the qty
      const stockCheckResult = await checkScrapInBalance(
        companyCode,
        item.item_code,
        item.item_type,
        itemQty,
        0, // deleting means qty becomes 0
        transactionData.transaction_date,
        actualId
      );

      console.log(`[DELETE SCRAP IN] Validation result: available=${stockCheckResult.available}, currentStock=${stockCheckResult.currentStock}, shortfall=${stockCheckResult.shortfall}`);

      if (!stockCheckResult.available) {
        console.log(`[DELETE SCRAP IN] REJECTING - would make balance negative`);
        return NextResponse.json(
          {
            success: false,
            message: `Stock akan menjadi minus. Saat ini balance ${stockCheckResult.currentStock} unit. Anda mencoba menghapus ${itemQty} unit.`,
            errors: [
              {
                field: 'delete',
                message: `Menghapus qty sebesar ${itemQty} akan membuat balance minus ${stockCheckResult.shortfall} unit. Current balance: ${stockCheckResult.currentStock}`,
              },
            ],
            data: {
              itemCode: item.item_code,
              itemType: item.item_type,
              itemName: item.item_name,
              deletingQty: itemQty,
              currentBalance: stockCheckResult.currentStock,
              shortfall: stockCheckResult.shortfall,
            },
          },
          { status: 400 }
        );
      }

      console.log(`[DELETE SCRAP IN] Validation passed - proceeding with delete`);

      // Delete in transaction with snapshot recalculation
      const snapshotItems: Array<{ itemType: string; itemCode: string; itemName: string; uom: string; date: Date }> = [];
      await prisma.$transaction(
        async (tx) => {
          await tx.scrap_transactions.update({
            where: { id: actualId },
            data: { deleted_at: new Date() },
          });

          // Also soft-delete all scrap_transaction_items for this scrap_transaction
          // For consistency with SCRAP OUT delete logic
          await tx.scrap_transaction_items.updateMany({
            where: { scrap_transaction_id: actualId },
            data: { deleted_at: new Date() },
          });

          // Collect item for direct snapshot calculation
          snapshotItems.push({
            itemType: item.item_type,
            itemCode: item.item_code,
            itemName: item.item_name,
            uom: item.uom,
            date: transactionData.transaction_date,
          });
        },
        {
          isolationLevel: 'Serializable',
        }
      );

      // Execute direct snapshot calculation asynchronously (fire-and-forget)
      if (snapshotItems.length > 0) {
        (async () => {
          for (const snapItem of snapshotItems) {
            try {
              await prisma.$executeRawUnsafe(
                'SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)',
                companyCode,
                snapItem.itemType,
                snapItem.itemCode,
                snapItem.itemName,
                snapItem.uom,
                snapItem.date
              );
              console.log('[API Info] Direct snapshot calculation executed', {
                companyCode,
                itemType: snapItem.itemType,
                itemCode: snapItem.itemCode,
                date: snapItem.date.toISOString().split('T')[0],
              });

              // Cascade recalculate snapshots for all future dates
              // This ensures balance updates propagate forward when a past IN transaction is deleted
              await prisma.$executeRawUnsafe(
                'SELECT recalculate_item_snapshots_from_date($1::int, $2::varchar, $3::varchar, $4::date)',
                companyCode,
                snapItem.itemType,
                snapItem.itemCode,
                snapItem.date
              );
              console.log('[API Info] Cascaded snapshot recalculation executed for SCRAP IN delete', {
                companyCode,
                itemType: snapItem.itemType,
                itemCode: snapItem.itemCode,
                fromDate: snapItem.date.toISOString().split('T')[0],
              });
            } catch (snapshotError) {
              console.error('[API Error] Snapshot calculation failed', {
                companyCode,
                itemType: snapItem.itemType,
                itemCode: snapItem.itemCode,
                date: snapItem.date.toISOString().split('T')[0],
                errorMessage: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
              });
            }
          }
        })().catch(err => console.error('[API Error] Background snapshot task failed:', err));
      }
    } else {
      console.log(`[DELETE] Using outgoing_goods path`);
      const transactionData = await prisma.outgoing_goods.findFirst({
        where: {
          id: actualId,
          company_code: companyCode,
          deleted_at: null,
        },
        include: {
          items: {
            where: {
              deleted_at: null,
            },
          },
        },
      });

      if (!transactionData) {
        return NextResponse.json(
          { message: 'Transaction not found or already deleted' },
          { status: 404 }
        );
      }

      if (!transactionData.items || transactionData.items.length === 0) {
        return NextResponse.json(
          { message: 'Transaction item not found' },
          { status: 404 }
        );
      }

      // Collect items for direct snapshot calculation BEFORE deletion
      const snapshotItems: Array<{ itemType: string; itemCode: string; itemName: string; uom: string; date: Date }> = [];
      for (const item of transactionData.items) {
        snapshotItems.push({
          itemType: item.item_type,
          itemCode: item.item_code,
          itemName: item.item_name,
          uom: item.uom,
          date: transactionData.outgoing_date,
        });
      }

      // Find and soft-delete corresponding scrap_transactions record (for dual-table consistency)
      // SCRAP OUT is stored in BOTH outgoing_goods and scrap_transactions
      const scrapTransaction = await prisma.scrap_transactions.findFirst({
        where: {
          company_code: companyCode,
          transaction_type: 'OUT',
          transaction_date: transactionData.outgoing_date,
          deleted_at: null,
        },
        include: {
          items: {
            where: {
              deleted_at: null,
              item_type: 'SCRAP',
            },
          },
        },
      });

      // Delete in transaction
      await prisma.$transaction(
        async (tx) => {
          // Delete outgoing_goods and its items
          await tx.outgoing_goods.update({
            where: { id: actualId },
            data: { deleted_at: new Date() },
          });

          // Also soft-delete all outgoing_good_items for this outgoing_good
          await tx.outgoing_good_items.updateMany({
            where: { outgoing_good_id: actualId },
            data: { deleted_at: new Date() },
          });

          // Delete corresponding scrap_transactions record if found
          if (scrapTransaction) {
            await tx.scrap_transactions.update({
              where: { id: scrapTransaction.id },
              data: { deleted_at: new Date() },
            });

            // Also soft-delete all scrap_transaction_items for this scrap_transaction
            await tx.scrap_transaction_items.updateMany({
              where: { scrap_transaction_id: scrapTransaction.id },
              data: { deleted_at: new Date() },
            });

            console.log('[DELETE] Soft-deleted corresponding scrap_transactions record and items:', {
              scrapTransactionId: scrapTransaction.id,
              outgoingGoodId: actualId,
            });
          }
        },
        {
          isolationLevel: 'Serializable',
        }
      );

      // Execute direct snapshot calculation and cascading recalculation asynchronously (fire-and-forget)
      // This ensures balance updates propagate forward when a past OUT transaction is deleted
      if (snapshotItems.length > 0) {
        (async () => {
          for (const snapItem of snapshotItems) {
            try {
              // Step 1: Upsert snapshot for the deleted transaction date
              await prisma.$executeRawUnsafe(
                'SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)',
                companyCode,
                snapItem.itemType,
                snapItem.itemCode,
                snapItem.itemName,
                snapItem.uom,
                snapItem.date
              );
              console.log('[API Info] Direct snapshot calculation executed for OUTGOING delete', {
                companyCode,
                itemType: snapItem.itemType,
                itemCode: snapItem.itemCode,
                date: snapItem.date.toISOString().split('T')[0],
              });

              // Step 2: Cascade recalculate snapshots for all future dates
              // This ensures balance updates propagate forward when a past OUT transaction is deleted
              await prisma.$executeRawUnsafe(
                'SELECT recalculate_item_snapshots_from_date($1::int, $2::varchar, $3::varchar, $4::date)',
                companyCode,
                snapItem.itemType,
                snapItem.itemCode,
                snapItem.date
              );
              console.log('[API Info] Cascaded snapshot recalculation executed for SCRAP OUT delete', {
                companyCode,
                itemType: snapItem.itemType,
                itemCode: snapItem.itemCode,
                fromDate: snapItem.date.toISOString().split('T')[0],
              });
            } catch (snapshotError) {
              console.error('[API Error] Snapshot calculation failed for OUTGOING delete', {
                companyCode,
                itemType: snapItem.itemType,
                itemCode: snapItem.itemCode,
                date: snapItem.date.toISOString().split('T')[0],
                errorMessage: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
              });
            }
          }
        })().catch(err => console.error('[API Error] Background snapshot task failed:', err));
      }
    }

    // Log activity
    await logActivity({
      action: 'DELETE_SCRAP_TRANSACTION',
      description: `Deleted scrap transaction ID: ${transactionId} from ${sourceTable}`,
      status: 'success',
      metadata: {
        transactionId,
        sourceTable,
        companyCode,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Transaction deleted successfully',
      data: {
        transactionId,
        sourceTable,
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to delete scrap transaction:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    return NextResponse.json(
      { 
        message: 'Error deleting transaction',
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
