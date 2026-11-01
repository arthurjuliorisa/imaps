import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveMenuGrants } from '@/lib/menu-auth';

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
export async function GET(request: Request) {
  try {
    // Get current user session
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (new URL(request.url).searchParams.get('grantsFor') === '/insw/logs') {
      return NextResponse.json(await resolveMenuGrants(session, '/insw/logs'));
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

      // Additive navigation for existing installations; no destructive reseed or
      // operational database write is needed to discover the administrator page.
      if (!adminMenus.some(menu => menu.menuPath === '/insw/queue-settings')) {
        const parent = allMenus.find(menu => menu.menu_name === 'Host to Host INSW' && !menu.parent_id);
        adminMenus.push({ id: 'admin-queue-settings', menuName: 'INSW Queue Settings',
          menuPath: '/insw/queue-settings', menuIcon: 'Settings', parentId: parent?.id ?? null,
          menuOrder: 5, canView: true, canCreate: false, canEdit: true, canDelete: false });
      }

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
    const menusWithAccess = menus
      .filter((menu) => menu.menu_path !== '/insw/queue-settings' && menu.user_access_menus.length > 0)
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

    // Create a Set of accessible menu IDs for quick lookup
    const accessibleMenuIds = new Set(menusWithAccess.map(m => m.id));

    // Filter out child menus whose parent is not accessible
    // If a menu has a parent, that parent must also be in the accessible list
    const accessibleMenus = menusWithAccess.filter((menu) => {
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
