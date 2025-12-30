import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { logActivity } from '@/lib/log-activity';

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

    // Only allow editing scrap_transactions records
    if (!transactionId.startsWith('SCRAP_')) {
      return NextResponse.json(
        { message: 'Only scrap transactions can be edited here. Please edit outgoing goods from the Outgoing page.' },
        { status: 400 }
      );
    }

    // Extract the actual database ID
    const parts = transactionId.replace('SCRAP_', '').split('-');
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

    // Verify the transaction exists and belongs to the company
    const transaction = await prisma.scrap_transactions.findFirst({
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

    // Update the scrap transaction
    // Note: transaction_date is part of compound key and cannot be updated
    try {
      await prisma.scrap_transactions.update({
        where: { id: actualId },
        data: {
          ppkek_number: ppkekNumber || '',
          customs_registration_date: registrationDate ? new Date(registrationDate) : undefined,
          customs_document_type: documentType || '',
          recipient_name: recipientName || '',
          remarks: remarks || '',
        },
      });
      console.log('✅ Parent transaction updated successfully');
    } catch (error) {
      console.error('❌ Error updating parent transaction:', error);
      throw error;
    }

    // Update the scrap transaction items
    try {
      const result = await prisma.scrap_transaction_items.updateMany({
        where: {
          scrap_transaction_id: actualId,
          scrap_transaction_company: companyCode,
          scrap_transaction_date: transaction.transaction_date,
          deleted_at: null,
        },
        data: {
          qty: qty,
          currency: currency as any,
          amount: amount,
        },
      });
      console.log('✅ Items updated successfully. Count:', result.count);
    } catch (error) {
      console.error('❌ Error updating items:', error);
      throw error;
    }

    // Log activity
    await logActivity({
      action: 'EDIT_SCRAP_TRANSACTION',
      description: `Updated scrap transaction: ${transaction.document_number}`,
      status: 'success',
      metadata: {
        transactionId,
        documentNumber: transaction.document_number,
        companyCode,
      },
    });

    return NextResponse.json({
      message: 'Transaction updated successfully',
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

    // Soft delete the record
    if (sourceTable === 'scrap_transactions') {
      const transaction = await prisma.scrap_transactions.findFirst({
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

      await prisma.scrap_transactions.update({
        where: { id: actualId },
        data: { deleted_at: new Date() },
      });
    } else {
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

      await prisma.outgoing_goods.update({
        where: { id: actualId },
        data: { deleted_at: new Date() },
      });
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
      message: 'Transaction deleted successfully',
    });
  } catch (error) {
    console.error('[API Error] Failed to delete scrap transaction:', error);
    return NextResponse.json(
      { message: 'Error deleting transaction' },
      { status: 500 }
    );
  }
}
