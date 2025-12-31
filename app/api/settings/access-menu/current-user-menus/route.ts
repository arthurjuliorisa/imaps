import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

/**
 * Menu structure for sidebar
 */
interface MenuResponse {
  id: string;
  menuName: string;
  menuPath: string | null;
  menuIcon: string | null;
  parentId: string | null;
  menuOrder: number | null;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * GET /api/settings/access-menu/current-user-menus
 * Returns menus accessible by the currently logged-in user
 *
 * Admin users get full access to all menus without permission checks
 *
 * @returns Array of menus the user can view
 */
export async function GET() {
  try {
    // Get current user session
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const userRole = session.user.role;

    // Check if user is ADMIN - admins get full access to all menus
    if (userRole === 'ADMIN') {
      const allMenus = await prisma.menus.findMany({
        where: {
          is_active: true,
        },
        orderBy: { menu_order: 'asc' },
      });

      const adminMenus: MenuResponse[] = allMenus.map((menu) => ({
        id: menu.id,
        menuName: menu.menu_name,
        menuPath: menu.menu_path,
        menuIcon: menu.menu_icon,
        parentId: menu.parent_id,
        menuOrder: menu.menu_order,
        canView: true,
        canCreate: true,
        canEdit: true,
        canDelete: true,
      }));

      return NextResponse.json(adminMenus);
    }

    // For non-admin users, check permissions
    const menus = await prisma.menus.findMany({
      where: {
        is_active: true,
      },
      orderBy: { menu_order: 'asc' },
      include: {
        user_access_menus: {
          where: {
            user_id: userId,
            can_view: true, // Only include menus user can view
          },
        },
      },
    });

    // Filter only menus that user has access to (where can_view = true)
    const accessibleMenus = menus
      .filter((menu) => menu.user_access_menus.length > 0)
      .map((menu): MenuResponse => {
        const access = menu.user_access_menus[0];
        return {
          id: menu.id,
          menuName: menu.menu_name,
          menuPath: menu.menu_path,
          menuIcon: menu.menu_icon,
          parentId: menu.parent_id,
          menuOrder: menu.menu_order,
          canView: access.can_view,
          canCreate: access.can_create,
          canEdit: access.can_edit,
          canDelete: access.can_delete,
        };
      });

    return NextResponse.json(accessibleMenus);
  } catch (error: any) {
    console.error('[API Error] Failed to fetch user menus:', error);
    return NextResponse.json(
      { message: 'Failed to fetch menus', error: error.message },
      { status: 500 }
    );
  }
}
