import { prisma } from '../lib/prisma';

interface MenuInput {
  name: string;
  route: string | null;
  icon: string | null;
  order: number;
  children?: Omit<MenuInput, 'children'>[];
}

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
      { name: 'Item', route: '/master/item', icon: 'Inventory', order: 1 },
      { name: 'Scrap', route: '/master/scrap', icon: 'DeleteSweep', order: 2 },
      { name: 'UOM', route: '/master/uom', icon: 'Straighten', order: 3 },
      { name: 'Currency', route: '/master/currency', icon: 'AttachMoney', order: 4 },
      { name: 'Customers', route: '/master/customers', icon: 'People', order: 5 },
      { name: 'Supplier', route: '/master/supplier', icon: 'LocalShipping', order: 6 },
    ],
  },
  {
    name: 'Lap. per Dokumen',
    route: null,
    icon: 'Description',
    order: 3,
    children: [
      { name: 'Pemasukan Barang', route: '/customs/incoming', icon: 'ArrowDownward', order: 1 },
      { name: 'Pengeluaran Barang', route: '/customs/outgoing', icon: 'ArrowUpward', order: 2 },
    ],
  },
  {
    name: 'LPJ Mutasi',
    route: null,
    icon: 'Assessment',
    order: 4,
    children: [
      { name: 'Work in Progress', route: '/customs/wip', icon: 'Loop', order: 1 },
      { name: 'Bahan Baku/Penolong', route: '/customs/raw-material', icon: 'Category', order: 2 },
      { name: 'Hasil Produksi', route: '/customs/production', icon: 'Build', order: 3 },
      { name: 'Barang Scrap/Reject', route: '/customs/scrap', icon: 'Delete', order: 4 },
      { name: 'Barang Modal', route: '/customs/capital-goods', icon: 'AccountBalance', order: 5 },
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
      { name: 'User Management', route: '/settings/users', icon: 'ManageAccounts', order: 1 },
      { name: 'Access Menu', route: '/settings/access-menu', icon: 'Security', order: 2 },
    ],
  },
];

async function seedMenus() {
  try {
    console.log('Starting menu seeding...\n');

    // Delete all existing menus (this will cascade delete user access menus)
    await prisma.menu.deleteMany({});
    console.log('Deleted all existing menus\n');

    // Create menus with parent-child relationships
    for (const parentMenu of menuStructure) {
      console.log(`Creating parent menu: ${parentMenu.name}`);

      const parent = await prisma.menu.create({
        data: {
          name: parentMenu.name,
          route: parentMenu.route,
          icon: parentMenu.icon,
          order: parentMenu.order,
        },
      });

      console.log(`  ✓ Created parent: ${parent.name} (${parent.id})`);

      if (parentMenu.children && parentMenu.children.length > 0) {
        console.log(`  Creating ${parentMenu.children.length} children...`);

        for (const childMenu of parentMenu.children) {
          const child = await prisma.menu.create({
            data: {
              name: childMenu.name,
              route: childMenu.route,
              icon: childMenu.icon,
              order: childMenu.order,
              parentId: parent.id,
            },
          });

          console.log(`    └─ Created child: ${child.name} (${child.id})`);
        }
      }

      console.log('');
    }

    // Verify the results
    const allMenus = await prisma.menu.findMany({
      orderBy: { order: 'asc' },
    });

    console.log('\n=== SEEDING COMPLETE ===');
    console.log(`Total menus created: ${allMenus.length}`);
    console.log(`Parent menus: ${allMenus.filter(m => !m.parentId).length}`);
    console.log(`Child menus: ${allMenus.filter(m => m.parentId).length}`);

    console.log('\n=== MENU HIERARCHY ===\n');
    const rootMenus = allMenus.filter(m => !m.parentId);

    rootMenus.forEach((parent) => {
      console.log(`${parent.name}`);
      const children = allMenus.filter(m => m.parentId === parent.id);
      children.forEach((child) => {
        console.log(`  └─ ${child.name}`);
      });
    });

  } catch (error) {
    console.error('Error seeding menus:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedMenus();
