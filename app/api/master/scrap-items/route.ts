import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { logActivity } from '@/lib/log-activity';
import { z } from 'zod';

// Validation schema for scrap item creation/update
const ScrapItemComponentSchema = z.object({
  componentCode: z.string().min(1, 'Component code is required'),
  componentName: z.string().min(1, 'Component name is required'),
  componentType: z.string().min(1, 'Component type is required'),
  uom: z.string().min(1, 'UOM is required'),
  quantity: z.number().positive('Quantity must be positive'),
  percentage: z.number().min(0).max(100).optional(),
  remarks: z.string().optional(),
});

const ScrapItemSchema = z.object({
  scrapCode: z.string().min(1, 'Scrap code is required').max(50),
  scrapName: z.string().min(1, 'Scrap name is required').max(200),
  scrapDescription: z.string().max(500).optional(),
  uom: z.string().min(1, 'UOM is required').max(20),
  components: z.array(ScrapItemComponentSchema).min(1, 'At least one component is required'),
});

/**
 * GET /api/master/scrap-items
 * Get all scrap items for the user's company
 */
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';

    // Build where clause
    const where: any = {
      company_code: companyCode,
      deleted_at: null,
    };

    if (!includeInactive) {
      where.is_active = true;
    }

    // Fetch scrap items with their components
    const scrapItems = await prisma.scrap_items.findMany({
      where,
      include: {
        scrap_item_details: {
          orderBy: {
            component_code: 'asc',
          },
        },
      },
      orderBy: {
        scrap_code: 'asc',
      },
    });

    // Transform to frontend format
    const transformedData = scrapItems.map((item) => ({
      id: item.id,
      scrapCode: item.scrap_code,
      scrapName: item.scrap_name,
      scrapDescription: item.scrap_description,
      uom: item.uom,
      isActive: item.is_active,
      components: item.scrap_item_details.map((detail) => ({
        id: detail.id,
        componentCode: detail.component_code,
        componentName: detail.component_name,
        componentType: detail.component_type,
        uom: detail.uom,
        quantity: Number(detail.quantity),
        percentage: detail.percentage ? Number(detail.percentage) : undefined,
        remarks: detail.remarks,
      })),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));

    return NextResponse.json(transformedData);
  } catch (error) {
    console.error('[API Error] Failed to fetch scrap items:', error);
    return NextResponse.json(
      { message: 'Error fetching scrap items' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/master/scrap-items
 * Create a new scrap item
 */
export async function POST(request: Request) {
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

    const body = await request.json();

    // Validate request body
    const validationResult = ScrapItemSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          message: 'Validation failed',
          errors: validationResult.error.issues,
        },
        { status: 400 }
      );
    }

    const { scrapCode, scrapName, scrapDescription, uom, components } = validationResult.data;

    // Check if scrap code already exists for this company
    const existing = await prisma.scrap_items.findUnique({
      where: {
        company_code_scrap_code: {
          company_code: companyCode,
          scrap_code: scrapCode,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { message: 'Scrap code already exists' },
        { status: 400 }
      );
    }

    // Create scrap item with components in a transaction
    const scrapItem = await prisma.$transaction(async (tx) => {
      const item = await tx.scrap_items.create({
        data: {
          company_code: companyCode,
          scrap_code: scrapCode,
          scrap_name: scrapName,
          scrap_description: scrapDescription,
          uom,
          is_active: true,
          scrap_item_details: {
            create: components.map((comp) => ({
              component_code: comp.componentCode,
              component_name: comp.componentName,
              component_type: comp.componentType,
              uom: comp.uom,
              quantity: comp.quantity,
              percentage: comp.percentage,
              remarks: comp.remarks,
            })),
          },
        },
        include: {
          scrap_item_details: true,
        },
      });

      return item;
    });

    // Log activity
    await logActivity({
      action: 'ADD_SCRAP_MASTER',
      description: `Created scrap item: ${scrapItem.scrap_name} (${scrapItem.scrap_code})`,
      status: 'success',
      metadata: {
        scrapId: scrapItem.id,
        scrapCode: scrapItem.scrap_code,
        scrapName: scrapItem.scrap_name,
        companyCode,
      },
    });

    return NextResponse.json(
      {
        message: 'Scrap item created successfully',
        data: {
          id: scrapItem.id,
          scrapCode: scrapItem.scrap_code,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API Error] Failed to create scrap item:', error);
    return NextResponse.json(
      { message: 'Error creating scrap item' },
      { status: 500 }
    );
  }
}
