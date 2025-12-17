import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError } from '@/lib/api-utils';
import { serializeBigInt } from '@/lib/bigint-serializer';

/**
 * Menu item with hierarchical children
 */
interface MenuWithChildren {
  id: string;
  name: string;
  route: string | null;
  icon: string | null;
  parent_id: string | null;
  order: number;
  created_at: Date;
  updated_at: Date;
  children: MenuWithChildren[];
}

/**
 * Builds hierarchical menu structure from flat menu array
 */
function buildMenuHierarchy(menus: any[]): MenuWithChildren[] {
  const menuMap = new Map<string, MenuWithChildren>();
  const rootMenus: MenuWithChildren[] = [];

  // Initialize all menus with empty children array
  menus.forEach((menu) => {
    menuMap.set(menu.id, { ...menu, children: [] });
  });

  // Build hierarchy
  menus.forEach((menu) => {
    const menuItem = menuMap.get(menu.id)!;

    if (menu.parent_id) {
      const parent = menuMap.get(menu.parent_id);
      if (parent) {
        parent.children.push(menuItem);
      } else {
        // Parent not found, treat as root
        rootMenus.push(menuItem);
      }
    } else {
      // No parent, this is a root menu
      rootMenus.push(menuItem);
    }
  });

  // Sort children by order at each level
  const sortChildren = (items: MenuWithChildren[]) => {
    items.sort((a, b) => a.order - b.order);
    items.forEach((item) => {
      if (item.children.length > 0) {
        sortChildren(item.children);
      }
    });
  };

  sortChildren(rootMenus);

  return rootMenus;
}

/**
 * GET /api/settings/access-menu
 * Retrieves all menus in hierarchical structure
 * Ordered by the 'order' field at each level
 */
export async function GET() {
  try {
    // Get all menus
    const menus = await prisma.menus.findMany({
      orderBy: { order: 'asc' },
    });

    // Build hierarchical structure
    const hierarchy = buildMenuHierarchy(menus);

    return NextResponse.json(serializeBigInt(hierarchy));
  } catch (error) {
    return handleApiError(error);
  }
}
