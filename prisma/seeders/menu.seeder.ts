import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MenuInput {
  menu_name: string;
  menu_path: string | null;
  menu_icon: string | null;
  menu_order: number;
  children?: Omit<MenuInput, 'children'>[];
}

/**
 * Menu structure matching the Sidebar.tsx component exactly
 * This structure represents the actual menu hierarchy displayed in the application
 */
const menuStructure: MenuInput[] = [
  {
    menu_name: 'Dashboard',
    menu_path: '/dashboard',
    menu_icon: 'Dashboard',
    menu_order: 1,
  },
  {
    menu_name: 'Master',
    menu_path: null,
    menu_icon: 'Storage',
    menu_order: 2,
    children: [
      { menu_name: 'Company', menu_path: '/master/companies', menu_icon: 'Category', menu_order: 1 },
      { menu_name: 'Item Type', menu_path: '/master/item-types', menu_icon: 'Category', menu_order: 2 },
      { menu_name: 'Scrap Master', menu_path: '/master/scrap-items', menu_icon: 'Recycling', menu_order: 3 },
    ],
  },
  {
    menu_name: 'Lap. per Dokumen',
    menu_path: null,
    menu_icon: 'Description',
    menu_order: 3,
    children: [
      { menu_name: 'Pemasukan Barang', menu_path: '/customs/incoming', menu_icon: 'Description', menu_order: 1 },
      { menu_name: 'Pengeluaran Barang', menu_path: '/customs/outgoing', menu_icon: 'Description', menu_order: 2 },
    ],
  },
  {
    menu_name: 'LPJ Mutasi',
    menu_path: null,
    menu_icon: 'Assessment',
    menu_order: 4,
    children: [
      { menu_name: 'Work in Progress', menu_path: '/customs/wip', menu_icon: 'Description', menu_order: 1 },
      { menu_name: 'Bahan Baku/Penolong', menu_path: '/customs/raw-material', menu_icon: 'Description', menu_order: 2 },
      { menu_name: 'Hasil Produksi', menu_path: '/customs/production', menu_icon: 'Description', menu_order: 3 },
      { menu_name: 'Barang Scrap/Reject', menu_path: '/customs/scrap', menu_icon: 'Description', menu_order: 4 },
      { menu_name: 'Barang Modal', menu_path: '/customs/capital-goods', menu_icon: 'Description', menu_order: 5 },
    ],
  },
  {
    menu_name: 'Transaksi',
    menu_path: null,
    menu_icon: 'SwapHoriz',
    menu_order: 5,
    children: [
      { menu_name: 'Transaksi Scrap', menu_path: '/customs/scrap-transactions', menu_icon: 'Recycling', menu_order: 1 },
      { menu_name: 'Transaksi Barang Modal', menu_path: '/customs/capital-goods-transactions', menu_icon: 'Inventory', menu_order: 2 },
      { menu_name: 'Stock Opname', menu_path: '/customs/stock-opname', menu_icon: 'Inventory', menu_order: 3 },
    ],
  },
  {
    menu_name: 'Beginning Data',
    menu_path: '/customs/beginning-data',
    menu_icon: 'PlaylistAdd',
    menu_order: 6,
  },
  {
    menu_name: 'Settings',
    menu_path: null,
    menu_icon: 'Settings',
    menu_order: 7,
    children: [
      { menu_name: 'User Management', menu_path: '/settings/users', menu_icon: 'People', menu_order: 1 },
      { menu_name: 'Access Menu', menu_path: '/settings/access-menu', menu_icon: 'Settings', menu_order: 2 },
      { menu_name: 'Log Activity', menu_path: '/settings/log-activity', menu_icon: 'History', menu_order: 3 },
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
        menu_name: parentMenu.menu_name,
        menu_path: parentMenu.menu_path,
        menu_icon: parentMenu.menu_icon,
        menu_order: parentMenu.menu_order,
        parent_id: null,
      },
    });

    menuIdMap.set(parentMenu.menu_name, parent.id);
    totalCreated++;
    console.log(`  ✓ Created parent menu: ${parent.menu_name}`);

    if (parentMenu.children && parentMenu.children.length > 0) {
      for (const childMenu of parentMenu.children) {
        const childId = `MENU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const child = await prisma.menus.create({
          data: {
            id: childId,
            menu_name: childMenu.menu_name,
            menu_path: childMenu.menu_path,
            menu_icon: childMenu.menu_icon,
            menu_order: childMenu.menu_order,
            parent_id: parent.id,
          },
        });

        menuIdMap.set(childMenu.menu_name, child.id);
        totalCreated++;
        console.log(`    └─ Created child menu: ${child.menu_name} (${child.menu_path})`);

        // Small delay to ensure unique IDs
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  console.log(`Completed: ${totalCreated} menus seeded\n`);
  return menuIdMap;
}
