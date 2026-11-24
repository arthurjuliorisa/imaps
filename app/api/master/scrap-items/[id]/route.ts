import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { logActivity } from '@/lib/log-activity';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

// Validation schema
const ScrapItemComponentSchema = z.object({
  id: z.number().optional(),
  componentCode: z.string().trim().min(1, 'Component code is required').max(50),
  componentName: z.string().trim().min(1, 'Component name is required').max(200),
  componentType: z.string().trim().min(1, 'Component type is required').max(10),
  uom: z.string().trim().min(1, 'UOM is required').max(20),
  quantity: z.number().finite('Quantity must be a finite number').positive('Quantity must be positive'),
  percentage: z.number().min(0).max(100).optional(),
  remarks: z.string().max(500).optional(),
});

const ScrapItemUpdateSchema = z.object({
  scrapName: z.string().trim().min(1, 'Scrap name is required').max(200),
  scrapDescription: z.string().trim().max(500).optional(),
  uom: z.string().trim().min(1, 'UOM is required').max(20),
  isActive: z.boolean(),
  components: z.array(ScrapItemComponentSchema),
});

// Persisted evidence only: no UOM, quantity, status or deletion filters on usage.
// Child company columns are part of their composite source identity; orphaned
// retained lines also count conservatively without requiring a surviving header.
async function hasPersistedScrapUsage(tx: Prisma.TransactionClient, companyCode: number, code: string) {
  const identity = { item_type: 'SCRAP', item_code: code };
  const select = { id: true } as const;
  if (await tx.scrap_transaction_items.findFirst({ where: { ...identity, scrap_transaction_company: companyCode }, select })) return true;
  if (await tx.incoming_good_items.findFirst({ where: { ...identity, incoming_good_company: companyCode }, select })) return true;
  if (await tx.outgoing_good_items.findFirst({ where: { ...identity, outgoing_good_company: companyCode }, select })) return true;
  if (await tx.adjustment_items.findFirst({ where: { ...identity, adjustment_company: companyCode }, select })) return true;
  if (await tx.material_usage_items.findFirst({ where: { ...identity, material_usage_company: companyCode }, select })) return true;
  if (await tx.production_output_items.findFirst({ where: { ...identity, production_output_company: companyCode }, select })) return true;
  const where = { ...identity, company_code: companyCode };
  if (await tx.beginning_balances.findFirst({ where, select })) return true;
  if (await tx.stock_daily_snapshot.findFirst({ where, select })) return true;
  if (await tx.wip_balances.findFirst({ where, select })) return true;
  if (await tx.wms_stock_opname_items.findFirst({ where, select })) return true;
  return Boolean(await tx.stock_opname_items.findFirst({ where, select }));
}

async function needsScrapNameForAdmission(tx: Prisma.TransactionClient, companyCode: number, code: string) {
  const company = await tx.companies.findUnique({ where: { code: companyCode }, select: { company_type: true } });
  if (company?.company_type && company.company_type !== 'SEZ') return false;
  // Unknown company type still needs a relevant unresolved document to block.

  // Batched existence form of getEffectiveScrapInswStatus's absorbing SUCCESS
  // rule (lib/scrap-insw-finalization.ts). Every other effective status is
  // NOT_SENT, FAILED or PENDING and may still require current-master admission.
  // Do not inspect frozen WMS delivery queues: those use stored identities.
  const [result] = await tx.$queryRaw<Array<{ needs_admission: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM scrap_transactions h
      WHERE h.company_code = ${companyCode} AND h.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM scrap_transaction_items i
          WHERE i.scrap_transaction_company = h.company_code
            AND i.scrap_transaction_id = h.id
            AND i.scrap_transaction_date = h.transaction_date
            AND i.item_type = 'SCRAP' AND i.item_code = ${code}
            AND i.deleted_at IS NULL
        )
        AND (h.transaction_type NOT IN ('IN', 'OUT') OR NOT EXISTS (
          SELECT 1 FROM insw_tracking_log l
          WHERE l.company_code = h.company_code AND l.transaction_id = h.id
            AND l.transaction_type = CASE h.transaction_type WHEN 'IN' THEN 'scrap_in' ELSE 'scrap_out' END
            AND l.insw_status = 'SUCCESS'
        ))
    ) AS needs_admission
  `;
  if (typeof result?.needs_admission !== 'boolean') throw new Error('Scrap admission lookup failed');
  return result.needs_admission;
}

/**
 * GET /api/master/scrap-items/[id]
 * Get single scrap item by ID
 */
export async function GET(
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

    const resolvedParams = await params;
    const id = parseInt(resolvedParams.id);
    if (isNaN(id)) {
      return NextResponse.json(
        { message: 'Invalid ID' },
        { status: 400 }
      );
    }

    const scrapItem = await prisma.scrap_items.findFirst({
      where: {
        id,
        company_code: companyCode,
        deleted_at: null,
      },
      include: {
        scrap_item_details: {
          orderBy: {
            component_code: 'asc',
          },
        },
      },
    });

    if (!scrapItem) {
      return NextResponse.json(
        { message: 'Scrap item not found' },
        { status: 404 }
      );
    }

    // Transform to frontend format
    const transformedData = {
      id: scrapItem.id,
      scrapCode: scrapItem.scrap_code,
      scrapName: scrapItem.scrap_name,
      scrapDescription: scrapItem.scrap_description,
      uom: scrapItem.uom,
      isActive: scrapItem.is_active,
      components: scrapItem.scrap_item_details.map((detail) => ({
        id: detail.id,
        componentCode: detail.component_code,
        componentName: detail.component_name,
        componentType: detail.component_type,
        uom: detail.uom,
        quantity: Number(detail.quantity),
        percentage: detail.percentage ? Number(detail.percentage) : undefined,
        remarks: detail.remarks,
      })),
      createdAt: scrapItem.created_at,
      updatedAt: scrapItem.updated_at,
    };

    return NextResponse.json(transformedData);
  } catch (error) {
    console.error('[API Error] Failed to fetch scrap item:', error);
    return NextResponse.json(
      { message: 'Error fetching scrap item' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/master/scrap-items/[id]
 * Update scrap item
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

    const resolvedParams = await params;
    const id = parseInt(resolvedParams.id);
    if (isNaN(id)) {
      return NextResponse.json(
        { message: 'Invalid ID' },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Validate request body
    const validationResult = ScrapItemUpdateSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          message: 'Validation failed',
          errors: validationResult.error.issues,
        },
        { status: 400 }
      );
    }

    const { scrapName, scrapDescription, uom, isActive, components } = validationResult.data;

    const updatedItem = await prisma.$transaction(async (tx) => {
      // Same parameterized advisory-lock pattern as Scrap finalization. This
      // serializes master mutations only; transaction writers do not participate.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'scrap-master:' + companyCode + ':' + id}, 0))`;
      const existing = await tx.scrap_items.findFirst({
        where: { id, company_code: companyCode, deleted_at: null },
      });
      if (!existing) return NextResponse.json({ message: 'Scrap item not found' }, { status: 404 });

      const uomChanged = uom !== existing.uom.trim();
      const deactivating = existing.is_active && !isActive;
      if ((uomChanged || deactivating) && await hasPersistedScrapUsage(tx, companyCode, existing.scrap_code)) {
        return NextResponse.json({ message: uomChanged
          ? 'This scrap item UOM cannot be changed because it has already been used in transactions or related records.'
          : 'This scrap item cannot be deactivated because it has already been used in transactions or related records.' }, { status: 409 });
      }
      if (scrapName !== existing.scrap_name.trim() && await needsScrapNameForAdmission(tx, companyCode, existing.scrap_code)) {
        return NextResponse.json({ message: 'This scrap item cannot be renamed because related documents have pending or unclear INSW admission. Review their transmission status first.' }, { status: 409 });
      }

      // Update main scrap item
      const item = await tx.scrap_items.update({
        where: { id },
        data: {
          scrap_name: scrapName,
          scrap_description: scrapDescription,
          uom: uomChanged ? uom : existing.uom,
          is_active: isActive,
        },
      });

      // Explicit components array replaces the composition, including clearing with [].
      await tx.scrap_item_details.deleteMany({ where: { scrap_item_id: id } });
      if (components.length > 0) {
        await tx.scrap_item_details.createMany({
          data: components.map((comp) => ({
            scrap_item_id: id,
            component_code: comp.componentCode,
            component_name: comp.componentName,
            component_type: comp.componentType,
            uom: comp.uom,
            quantity: comp.quantity,
            percentage: comp.percentage,
            remarks: comp.remarks,
          })),
        });
      }

      return item;
    });

    if (updatedItem instanceof NextResponse) return updatedItem;

    // Log activity
    await logActivity({
      action: 'EDIT_SCRAP_MASTER',
      description: `Updated scrap item: ${updatedItem.scrap_name} (${updatedItem.scrap_code})`,
      status: 'success',
      metadata: {
        scrapId: updatedItem.id.toString(),
        scrapCode: updatedItem.scrap_code,
        scrapName: updatedItem.scrap_name,
        companyCode,
      },
    });

    return NextResponse.json({
      message: 'Scrap item updated successfully',
      data: {
        id: updatedItem.id,
        scrapCode: updatedItem.scrap_code,
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to update scrap item:', error);
    return NextResponse.json(
      { message: 'Error updating scrap item' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/master/scrap-items/[id]
 * Soft delete scrap item
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

    const resolvedParams = await params;
    const id = parseInt(resolvedParams.id);
    if (isNaN(id)) {
      return NextResponse.json(
        { message: 'Invalid ID' },
        { status: 400 }
      );
    }

    const existing = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'scrap-master:' + companyCode + ':' + id}, 0))`;
      const item = await tx.scrap_items.findFirst({
        where: { id, company_code: companyCode, deleted_at: null },
      });
      if (!item) return NextResponse.json({ message: 'Scrap item not found' }, { status: 404 });
      if (await hasPersistedScrapUsage(tx, companyCode, item.scrap_code)) {
        return NextResponse.json({ message: 'This scrap item cannot be deleted because it has already been used in transactions or related records.' }, { status: 409 });
      }
      await tx.scrap_items.update({ where: { id }, data: { deleted_at: new Date() } });
      return item;
    });
    if (existing instanceof NextResponse) return existing;

    // Log activity
    await logActivity({
      action: 'DELETE_SCRAP_MASTER',
      description: `Deleted scrap item: ${existing.scrap_name} (${existing.scrap_code})`,
      status: 'success',
      metadata: {
        scrapId: existing.id.toString(),
        scrapCode: existing.scrap_code,
        scrapName: existing.scrap_name,
        companyCode,
      },
    });

    return NextResponse.json({
      message: 'Scrap item deleted successfully',
    });
  } catch (error) {
    console.error('[API Error] Failed to delete scrap item:', error);
    return NextResponse.json(
      { message: 'Error deleting scrap item' },
      { status: 500 }
    );
  }
}
