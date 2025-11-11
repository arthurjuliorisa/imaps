import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  handleApiError,
  validateRequiredFields,
  ValidationError,
} from '@/lib/api-utils';

/**
 * User permission for a specific menu
 */
interface UserPermission {
  menuId: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * GET /api/settings/access-menu/user-permissions?userId={id}
 * Retrieves user's permissions for all menus
 *
 * Query parameters:
 * - userId: string (required)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 }
      );
    }

    // Get all menus with user's permissions
    const menus = await prisma.menu.findMany({
      orderBy: { order: 'asc' },
      include: {
        userAccess: {
          where: { userId },
        },
      },
    });

    // Transform to include permission info
    const permissions = menus.map((menu) => ({
      menuId: menu.id,
      menuName: menu.name,
      route: menu.route,
      icon: menu.icon,
      parentId: menu.parentId,
      order: menu.order,
      canView: menu.userAccess[0]?.canView ?? false,
      canCreate: menu.userAccess[0]?.canCreate ?? false,
      canEdit: menu.userAccess[0]?.canEdit ?? false,
      canDelete: menu.userAccess[0]?.canDelete ?? false,
    }));

    return NextResponse.json(permissions);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/settings/access-menu/user-permissions
 * Saves user permissions (bulk upsert)
 * Deletes existing permissions and inserts new ones in a transaction
 *
 * Request body:
 * - userId: string (required)
 * - permissions: UserPermission[] (required)
 *   Each permission: { menuId, canView, canCreate, canEdit, canDelete }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    validateRequiredFields(body, ['userId', 'permissions']);

    const { userId, permissions } = body;

    // Validate permissions is an array
    if (!Array.isArray(permissions)) {
      throw new ValidationError('permissions must be an array');
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 }
      );
    }

    // Validate all menu IDs exist
    const menuIds = permissions.map((p: UserPermission) => p.menuId);
    const existingMenus = await prisma.menu.findMany({
      where: { id: { in: menuIds } },
      select: { id: true },
    });

    if (existingMenus.length !== menuIds.length) {
      throw new ValidationError('One or more menu IDs are invalid');
    }

    // Use transaction to delete existing and insert new permissions
    const result = await prisma.$transaction(async (tx) => {
      // Delete existing permissions for this user
      await tx.userAccessMenu.deleteMany({
        where: { userId },
      });

      // Insert new permissions
      const createdPermissions = await tx.userAccessMenu.createMany({
        data: permissions.map((p: UserPermission) => ({
          userId,
          menuId: p.menuId,
          canView: p.canView ?? false,
          canCreate: p.canCreate ?? false,
          canEdit: p.canEdit ?? false,
          canDelete: p.canDelete ?? false,
        })),
      });

      return createdPermissions;
    });

    return NextResponse.json(
      {
        message: 'User permissions saved successfully',
        count: result.count,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
