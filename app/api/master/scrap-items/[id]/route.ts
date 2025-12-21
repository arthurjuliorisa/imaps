import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { z } from 'zod';

// Validation schema
const ScrapItemComponentSchema = z.object({
  id: z.number().optional(),
  componentCode: z.string().min(1, 'Component code is required'),
  componentName: z.string().min(1, 'Component name is required'),
  componentType: z.string().min(1, 'Component type is required'),
  uom: z.string().min(1, 'UOM is required'),
  quantity: z.number().positive('Quantity must be positive'),
  percentage: z.number().min(0).max(100).optional(),
  remarks: z.string().optional(),
});

const ScrapItemUpdateSchema = z.object({
  scrapName: z.string().min(1, 'Scrap name is required').max(200).optional(),
  scrapDescription: z.string().max(500).optional(),
  uom: z.string().min(1, 'UOM is required').max(20).optional(),
  isActive: z.boolean().optional(),
  components: z.array(ScrapItemComponentSchema).optional(),
});

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

    // Check if scrap item exists
    const existing = await prisma.scrap_items.findFirst({
      where: {
        id,
        company_code: companyCode,
        deleted_at: null,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'Scrap item not found' },
        { status: 404 }
      );
    }

    const { scrapName, scrapDescription, uom, isActive, components } = validationResult.data;

    // Update scrap item with components in a transaction
    const updatedItem = await prisma.$transaction(async (tx) => {
      // Update main scrap item
      const item = await tx.scrap_items.update({
        where: { id },
        data: {
          scrap_name: scrapName,
          scrap_description: scrapDescription,
          uom,
          is_active: isActive,
        },
      });

      // If components are provided, update them
      if (components) {
        // Delete all existing components
        await tx.scrap_item_details.deleteMany({
          where: { scrap_item_id: id },
        });

        // Create new components
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
      }

      return item;
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

    // Check if scrap item exists
    const existing = await prisma.scrap_items.findFirst({
      where: {
        id,
        company_code: companyCode,
        deleted_at: null,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'Scrap item not found' },
        { status: 404 }
      );
    }

    // Soft delete
    await prisma.scrap_items.update({
      where: { id },
      data: {
        deleted_at: new Date(),
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
