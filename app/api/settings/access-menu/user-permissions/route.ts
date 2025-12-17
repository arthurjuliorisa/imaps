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
    const user = await prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 }
      );
    }

    // Get all menus with user's permissions
    const menus = await prisma.menus.findMany({
      orderBy: { menu_order: 'asc' },
      include: {
        user_access_menus: {
          where: { user_id: userId },
        },
      },
    });

    // Transform to include permission info
    const permissions = menus.map((menu) => ({
      menuId: menu.id,
      menuName: menu.menu_name,
      route: menu.menu_path,
      icon: menu.menu_icon,
      parentId: menu.parent_id,
      order: menu.menu_order,
      canView: menu.user_access_menus[0]?.can_view ?? false,
      canCreate: menu.user_access_menus[0]?.can_create ?? false,
      canEdit: menu.user_access_menus[0]?.can_edit ?? false,
      canDelete: menu.user_access_menus[0]?.can_delete ?? false,
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
    const user = await prisma.users.findUnique({
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
    const existingMenus = await prisma.menus.findMany({
      where: { id: { in: menuIds } },
      select: { id: true },
    });

    if (existingMenus.length !== menuIds.length) {
      throw new ValidationError('One or more menu IDs are invalid');
    }

    // Use transaction to delete existing and insert new permissions
    const result = await prisma.$transaction(async (tx) => {
      // Delete existing permissions for this user
      await tx.user_access_menus.deleteMany({
        where: { user_id: userId },
      });

      // Insert new permissions
      const createdPermissions = await tx.user_access_menus.createMany({
        data: permissions.map((p: UserPermission, index: number) => ({
          id: `UAM-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
          user_id: userId,
          menu_id: p.menuId,
          can_view: p.canView ?? false,
          can_create: p.canCreate ?? false,
          can_edit: p.canEdit ?? false,
          can_delete: p.canDelete ?? false,
          updated_at: new Date(),
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
