import { assertBeginningBalanceCompanyScope, BeginningBalanceStateError, guardBeginningBalanceWrite, readBeginningBalanceState } from '@/lib/beginning-balance-state';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { logActivity } from '@/lib/log-activity';
import {
  parseAndNormalizeDate,
  validateDateNotFuture,
  sanitizeRemarks,
  validatePositiveNumber,
  ValidationError,
} from '@/lib/api-utils';
import { validateBeginningBalanceItem } from '@/lib/beginning-data-validation';
import {
  BeginningBalanceSnapshotError,
  createRequiredBeginningBalanceSnapshots,
} from '@/lib/services/beginning-balance-snapshot.service';

/**
 * GET /api/customs/beginning-data
 * Get beginning balance records with optional filtering by item type
 *
 * Query Parameters:
 * - itemType: Filter by item type (e.g., ROH, FERT, HIBE-M)
 * - itemCode: Filter by item code (partial match, case-insensitive)
 * - itemName: Filter by item name (partial match, case-insensitive)
 * - startDate: Filter by balance date >= startDate
 * - endDate: Filter by balance date <= endDate
 * - page: Page number (default: 1, min: 1)
 * - limit: Items per page (default: 50, min: 10, max: 500)
 */
export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const { searchParams } = new URL(request.url);
    const itemType = searchParams.get('itemType');
    const itemCode = searchParams.get('itemCode');
    const itemName = searchParams.get('itemName');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Extract and validate pagination parameters
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    
    // Validate pagination values (min 10, max 500 per page)
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 10), 500);
    const skip = (page - 1) * limit;

    // Validate company code with detailed error messages
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;
    assertBeginningBalanceCompanyScope(request, companyCode);

    const where: any = {
      company_code: companyCode,
      deleted_at: null,
    };

    // Filter by item type
    if (itemType) {
      where.item_type = itemType;
    }

    // Filter by item code OR item name (search functionality)
    if (itemCode && itemName) {
      // If both are provided, use OR logic for search
      where.OR = [
        {
          item_code: {
            contains: itemCode,
            mode: 'insensitive',
          },
        },
        {
          item_name: {
            contains: itemName,
            mode: 'insensitive',
          },
        },
      ];
    } else if (itemCode) {
      // Only item code filter
      where.item_code = {
        contains: itemCode,
        mode: 'insensitive',
      };
    } else if (itemName) {
      // Only item name filter
      where.item_name = {
        contains: itemName,
        mode: 'insensitive',
      };
    }

    // Filter by date range
    if (startDate || endDate) {
      where.balance_date = {};
      if (startDate) {
        where.balance_date.gte = new Date(startDate);
      }
      if (endDate) {
        where.balance_date.lte = new Date(endDate);
      }
    }

    // Get total count first
    const totalCount = await prisma.beginning_balances.count({ where });

    const beginningBalances = await prisma.beginning_balances.findMany({
      where,
      include: {
        ppkeks: {
          select: {
            ppkek_number: true
          }
        }
      },
      orderBy: [
        { balance_date: 'desc' },
        { item_code: 'asc' },
      ],
      skip,
      take: limit,
    });

    // Resolve current global mappings once per page, including historical/locked balances.
    // Keep JS uppercase semantics (without trimming) consistent with INSW integration.
    const activeMappings = beginningBalances.length > 0
      ? await prisma.insw_uom_mapping.findMany({
          where: { is_active: true },
          select: { wms_uom: true, insw_uom: true },
        })
      : [];
    const uomMappings = new Map<string, { count: number; target: string | null }>();
    for (const mapping of activeMappings) {
      const key = mapping.wms_uom.toUpperCase();
      const existing = uomMappings.get(key);
      uomMappings.set(key, {
        count: (existing?.count ?? 0) + 1,
        target: existing ? null : (mapping.insw_uom.trim() ? mapping.insw_uom : null),
      });
    }
    const encounteredAmbiguousKeys = new Set(
      beginningBalances.map(balance => balance.uom.toUpperCase())
        .filter(key => (uomMappings.get(key)?.count ?? 0) > 1)
    );
    if (encounteredAmbiguousKeys.size > 0) {
      console.warn('[Beginning Balance UoM]', {
        event: 'ambiguous_active_uom_mapping',
        ambiguousKeyCount: encounteredAmbiguousKeys.size,
      });
    }

    const companyState = await readBeginningBalanceState(prisma, companyCode);

    // Transform data to match frontend expectations
    const transformedData = await Promise.all(beginningBalances.map(async (balance) => {
      // Check if this beginning balance has any incoming or outgoing transactions
      const [incomingCount, outgoingCount] = await Promise.all([
        prisma.incoming_good_items.count({
          where: {
            item_code: balance.item_code,
            incoming_good_company: balance.company_code,
            deleted_at: null,
          },
        }),
        prisma.outgoing_good_items.count({
          where: {
            item_code: balance.item_code,
            outgoing_good_company: balance.company_code,
            deleted_at: null,
          },
        }),
      ]);

      const hasTransactions = incomingCount > 0 || outgoingCount > 0;

      return {
        id: balance.id.toString(),
        item: {
          code: balance.item_code,
          name: balance.item_name,
        },
        uom: {
          code: balance.uom,
        },
        beginningBalance: Number(balance.qty),
        beginningDate: balance.balance_date,
        remarks: balance.remarks || null,
        ppkek_numbers: balance.ppkeks?.map(p => p.ppkek_number) || [],
        itemId: balance.item_code,
        uomId: balance.uom,
        ceisaInswUom: balance.ceisa_insw_uom ?? null,
        inswUom: uomMappings.get(balance.uom.toUpperCase())?.target ?? null,
        itemType: balance.item_type,
        status: balance.status,
        hasTransactions,
      };
    }));

    return NextResponse.json({ 
      data: transformedData, 
      overallStatus: companyState.overallStatus,
      mixedStatus: companyState.mixedStatus,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    if (error instanceof BeginningBalanceStateError) return NextResponse.json({ message: error.message }, { status: error.status });
    console.error('[API Error] Failed to fetch beginning data:', error);
    console.error('[API Error] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    return NextResponse.json(
      { message: 'Error fetching beginning data' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customs/beginning-data
 * Create a new beginning balance record
 *
 * Request Body:
 * - itemType: string (required) - Item type code (e.g., ROH, FERT, HIBE-M)
 * - itemCode: string (required) - Item code
 * - itemName: string (required) - Item name
 * - uom: string (required) - Unit of measure
 * - qty: number (required, must be > 0) - Beginning balance quantity
 * - balanceDate: string (required, ISO date format) - Balance date
 * - remarks: string (optional, max 1000 chars) - Additional remarks
 * - ppkekNumbers: string[] (optional) - Array of PPKEK numbers
 */

export async function POST(request: Request) {
  let companyCodeForError: number | undefined;
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const body = await request.json();
    const { itemType, itemCode, itemName, uom, qty, balanceDate, remarks, ppkekNumbers } = body;

    // Validate required fields
    if (!itemType || !itemCode || !itemName || !uom || qty === undefined || qty === null || !balanceDate) {
      return NextResponse.json(
        {
          message: 'Missing required fields: itemType, itemCode, itemName, uom, qty, and balanceDate are required'
        },
        { status: 400 }
      );
    }

    // Validate item type exists and is active in database
    const itemTypeExists = await prisma.item_types.findUnique({
      where: { item_type_code: itemType },
    });

    if (!itemTypeExists || !itemTypeExists.is_active) {
      return NextResponse.json(
        { message: `Invalid item type: ${itemType}. Item type does not exist or is not active in the system.` },
        { status: 400 }
      );
    }

    // Validate and normalize date
    let normalizedDate: Date;
    try {
      normalizedDate = parseAndNormalizeDate(balanceDate);
      validateDateNotFuture(normalizedDate);
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message || 'Invalid date' },
        { status: 400 }
      );
    }

    // Validate quantity
    let qtyValue: number;
    try {
      qtyValue = validatePositiveNumber(qty, 'Quantity');
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Sanitize remarks
    let sanitizedRemarks: string | null = null;
    try {
      sanitizedRemarks = sanitizeRemarks(remarks);
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Parse companyCode as integer
    const companyCode = parseInt(session.user?.companyCode);
    if (!companyCode || isNaN(companyCode)) {
      return NextResponse.json(
        { message: 'Invalid company code' },
        { status: 400 }
      );
    }
    companyCodeForError = companyCode;
    assertBeginningBalanceCompanyScope(request, companyCode, body);

    // Validate item: check for duplicates and existing transactions
    const validation = await validateBeginningBalanceItem(
      companyCode,
      itemCode,
      itemName,
      itemType,
      uom
    );

    if (!validation.valid) {
      // Return the first validation error with detailed message
      const firstError = validation.errors[0];
      return NextResponse.json(
        { message: firstError.reason },
        { status: 400 }
      );
    }

    // The beginning balance and its required baseline snapshot commit together.
    const newRecord = await prisma.$transaction(async (tx) => {
      await guardBeginningBalanceWrite(tx, companyCode);
      const created = await tx.beginning_balances.create({
        data: {
          company_code: companyCode,
          item_type: itemType,
          item_code: String(itemCode).trim(),
          item_name: String(itemName).trim(),
          uom: String(uom).trim(),
          qty: qtyValue,
          balance_date: normalizedDate,
          remarks: sanitizedRemarks,
        },
      });

      if (ppkekNumbers && Array.isArray(ppkekNumbers) && ppkekNumbers.length > 0) {
        const ppkekRecords = ppkekNumbers
          .filter((num: string) => num && String(num).trim() !== '')
          .map((ppkekNumber: string) => ({
            beginning_balance_id: created.id,
            ppkek_number: String(ppkekNumber).trim(),
          }));

        if (ppkekRecords.length > 0) {
          await tx.beginning_balance_ppkeks.createMany({ data: ppkekRecords, skipDuplicates: true });
        }
      }

      await createRequiredBeginningBalanceSnapshots(tx, companyCode, [{
        item_type: created.item_type,
        item_code: created.item_code,
        item_name: created.item_name,
        uom: created.uom,
        snapshot_date: normalizedDate,
      }]);

      return created;
    }, { isolationLevel: 'ReadCommitted' });

    // Fetch the created record with ppkeks to return complete data
    const recordWithPpkeks = await prisma.beginning_balances.findUnique({
      where: { id: newRecord.id },
      include: {
        ppkeks: {
          select: {
            ppkek_number: true,
          },
        },
      },
    });

    // Transform response
    const transformedRecord = {
      id: newRecord.id.toString(),
      item: {
        code: newRecord.item_code,
        name: newRecord.item_name,
      },
      uom: {
        code: newRecord.uom,
      },
      beginningBalance: Number(newRecord.qty),
      beginningDate: newRecord.balance_date,
      remarks: newRecord.remarks || null,
      ppkek_numbers: recordWithPpkeks?.ppkeks?.map(p => p.ppkek_number) || [],
      itemId: newRecord.item_code,
      uomId: newRecord.uom,
      itemType: newRecord.item_type,
      hasTransactions: false, // New records have no transactions yet
    };

    // Log activity
    await logActivity({
      action: 'ADD_BEGINNING_DATA',
      description: `Created beginning balance: ${newRecord.item_name} (${newRecord.item_code}) - ${newRecord.qty} ${newRecord.uom}`,
      status: 'success',
      metadata: {
        recordId: newRecord.id.toString(),
        itemCode: newRecord.item_code,
        itemName: newRecord.item_name,
        itemType: newRecord.item_type,
        qty: newRecord.qty,
        balanceDate: newRecord.balance_date,
        companyCode,
      },
    });

    return NextResponse.json(transformedRecord, { status: 201 });
  } catch (error: any) {
    if (error instanceof BeginningBalanceStateError) return NextResponse.json({ message: error.message }, { status: error.status });
    console.error('[API Error] Failed to create beginning balance record:', error);

    if (error instanceof BeginningBalanceSnapshotError) {
      console.error('[API Error] Required beginning balance snapshot failed:', {
        companyCode: companyCodeForError,
        failedIdentities: error.failedIdentities,
      });
      return NextResponse.json(
        { message: 'Beginning balance was not created because its required baseline snapshot could not be created' },
        { status: 500 }
      );
    }

    // Handle validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Handle Prisma errors
    if (error.code === 'P2002') {
      return NextResponse.json(
        { message: 'A beginning balance record with this combination already exists' },
        { status: 409 }
      );
    }

    if (error.code === 'P2003') {
      return NextResponse.json(
        { message: 'Invalid foreign key constraint' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Error creating beginning balance record' },
      { status: 500 }
    );
  }
}
