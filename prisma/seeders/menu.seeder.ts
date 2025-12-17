import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MenuInput {
  name: string;
  route: string | null;
  icon: string | null;
  order: number;
  children?: Omit<MenuInput, 'children'>[];
}

/**
 * Menu structure matching the Sidebar.tsx component exactly
 * This structure represents the actual menu hierarchy displayed in the application
 */
const menuStructure: MenuInput[] = [
  {
    name: 'Dashboard',
    route: '/dashboard',
    icon: 'Dashboard',
    order: 1,
  },
  {
    name: 'Master',
    route: null,
    icon: 'Storage',
    order: 2,
    children: [
      { name: 'Company', route: '/master/companies', icon: 'Category', order: 1 },
      { name: 'Item Type', route: '/master/item-types', icon: 'Category', order: 2 },
    ],
  },
  {
    name: 'Lap. per Dokumen',
    route: null,
    icon: 'Description',
    order: 3,
    children: [
      { name: 'Pemasukan Barang', route: '/customs/incoming', icon: 'Description', order: 1 },
      { name: 'Pengeluaran Barang', route: '/customs/outgoing', icon: 'Description', order: 2 },
    ],
  },
  {
    name: 'LPJ Mutasi',
    route: null,
    icon: 'Assessment',
    order: 4,
    children: [
      { name: 'Work in Progress', route: '/customs/wip', icon: 'Description', order: 1 },
      { name: 'Bahan Baku/Penolong', route: '/customs/raw-material', icon: 'Description', order: 2 },
      { name: 'Hasil Produksi', route: '/customs/production', icon: 'Description', order: 3 },
      { name: 'Barang Scrap/Reject', route: '/customs/scrap', icon: 'Description', order: 4 },
      { name: 'Barang Modal', route: '/customs/capital-goods', icon: 'Description', order: 5 },
    ],
  },
  {
    name: 'Beginning Data',
    route: null,
    icon: 'PlaylistAdd',
    order: 5,
    children: [
      { name: 'Beginning Raw Material', route: '/customs/beginning-raw-material', icon: 'Description', order: 1 },
      { name: 'Beginning Finish Good', route: '/customs/beginning-finish-good', icon: 'Description', order: 2 },
      { name: 'Beginning Capital Goods', route: '/customs/beginning-capital-goods', icon: 'Description', order: 3 },
    ],
  },
  {
    name: 'Settings',
    route: null,
    icon: 'Settings',
    order: 6,
    children: [
      { name: 'User Management', route: '/settings/users', icon: 'People', order: 1 },
      { name: 'Access Menu', route: '/settings/access-menu', icon: 'Settings', order: 2 },
      { name: 'Log Activity', route: '/settings/log-activity', icon: 'History', order: 3 },
    ],
  },
];

export async function seedMenus() {
  console.log('🗂️  Seeding Menus...');

  // Delete all existing menus (cascade will delete user_access_menus)
  console.log('  Deleting existing menus...');
  const deletedCount = await prisma.menus.deleteMany({});
  console.log(`  ✓ Deleted ${deletedCount.count} existing menus`);

  let totalCreated = 0;
  const menuIdMap = new Map<string, string>();

  for (const parentMenu of menuStructure) {
    const parentId = `MENU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const parent = await prisma.menus.create({
      data: {
        id: parentId,
        name: parentMenu.name,
        route: parentMenu.route,
        icon: parentMenu.icon,
        order: parentMenu.order,
        parent_id: null,
      },
    });

    menuIdMap.set(parentMenu.name, parent.id);
    totalCreated++;
    console.log(`  ✓ Created parent menu: ${parent.name}`);

    if (parentMenu.children && parentMenu.children.length > 0) {
      for (const childMenu of parentMenu.children) {
        const childId = `MENU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const child = await prisma.menus.create({
          data: {
            id: childId,
            name: childMenu.name,
            route: childMenu.route,
            icon: childMenu.icon,
            order: childMenu.order,
            parent_id: parent.id,
          },
        });

        menuIdMap.set(childMenu.name, child.id);
        totalCreated++;
        console.log(`    └─ Created child menu: ${child.name} (${child.route})`);

        // Small delay to ensure unique IDs
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  console.log(`Completed: ${totalCreated} menus seeded\n`);
  return menuIdMap;
}
