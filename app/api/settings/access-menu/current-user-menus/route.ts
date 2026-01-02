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
    const allMenus = await prisma.menus.findMany({
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

    // Filter only menus that user has explicit access to
    const menusWithExplicitAccess = allMenus
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

    // Create a Set of explicitly accessible menu IDs
    const explicitAccessIds = new Set(menusWithExplicitAccess.map(m => m.id));

    // Auto-include child menus when user has access to parent menu
    // This ensures that granting access to "Lap. per Dokumen" automatically grants access to all its children
    const parentMenuIds = menusWithExplicitAccess
      .filter(menu => !menu.parentId) // Get only parent menus
      .map(menu => menu.id);

    const childMenusToAutoInclude = allMenus
      .filter(menu =>
        menu.parent_id && // Has a parent
        parentMenuIds.includes(menu.parent_id) && // Parent is accessible
        !explicitAccessIds.has(menu.id) // Not already explicitly granted
      )
      .map((menu): MenuResponse => {
        // Inherit permissions from parent menu
        const parentMenu = menusWithExplicitAccess.find(m => m.id === menu.parent_id);
        return {
          id: menu.id,
          menuName: menu.menu_name,
          menuPath: menu.menu_path,
          menuIcon: menu.menu_icon,
          parentId: menu.parent_id,
          menuOrder: menu.menu_order,
          canView: parentMenu?.canView ?? true,
          canCreate: parentMenu?.canCreate ?? false,
          canEdit: parentMenu?.canEdit ?? false,
          canDelete: parentMenu?.canDelete ?? false,
        };
      });

    // Combine explicit access and auto-included child menus
    const allAccessibleMenus = [...menusWithExplicitAccess, ...childMenusToAutoInclude];

    // Create a Set of all accessible menu IDs for filtering
    const accessibleMenuIds = new Set(allAccessibleMenus.map(m => m.id));

    // Filter out child menus whose parent is not accessible
    // If a menu has a parent, that parent must also be in the accessible list
    const accessibleMenus = allAccessibleMenus.filter((menu) => {
      // If menu has no parent, it's a top-level menu - include it
      if (!menu.parentId) {
        return true;
      }
      // If menu has a parent, check if parent is accessible
      return accessibleMenuIds.has(menu.parentId);
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
