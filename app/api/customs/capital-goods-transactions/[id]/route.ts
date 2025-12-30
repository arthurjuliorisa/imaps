import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { logActivity } from '@/lib/log-activity';

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

    // Verify the transaction exists and belongs to the company
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

    // Update the outgoing good
    // Note: outgoing_date is part of compound key and should not be updated
    await prisma.outgoing_goods.update({
      where: { id: actualId },
      data: {
        ppkek_number: ppkekNumber || '',
        customs_registration_date: registrationDate ? new Date(registrationDate) : undefined,
        customs_document_type: documentType || '',
        recipient_name: recipientName || '',
      },
    });
    console.log('✅ Parent record updated successfully');

    // Update the outgoing good items
    const updateResult = await prisma.$executeRaw`
      UPDATE outgoing_good_items
      SET
        qty = ${qty},
        currency = CAST(${currency} AS "Currency"),
        amount = ${amount}
      WHERE outgoing_good_id = ${actualId}
        AND outgoing_good_company = ${companyCode}
        AND outgoing_good_date = ${transaction.outgoing_date}
        AND deleted_at IS NULL
        AND item_type IN ('HIBE_M', 'HIBE_E', 'HIBE_T')
    `;
    console.log(`✅ Items updated. Rows affected: ${updateResult}`);

    // Log activity
    await logActivity({
      action: 'EDIT_CAPITAL_GOODS_TRANSACTION',
      description: `Updated capital goods transaction: ${transaction.wms_id} - ${transaction.recipient_name}`,
      status: 'success',
      metadata: {
        transactionId,
        wmsId: transaction.wms_id,
        recipientName: transaction.recipient_name,
        companyCode,
      },
    });

    return NextResponse.json({
      message: 'Transaction updated successfully',
    });
  } catch (error) {
    console.error('[API Error] Failed to update capital goods transaction:', error);
    return NextResponse.json(
      { message: 'Error updating transaction' },
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

    // Soft delete the record
    await prisma.outgoing_goods.update({
      where: { id: actualId },
      data: { deleted_at: new Date() },
    });

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
