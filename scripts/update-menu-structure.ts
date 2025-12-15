import { prisma } from '../lib/prisma';

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

async function updateMenuStructure() {
  try {
    console.log('=== UPDATING MENU STRUCTURE ===\n');
    console.log('This will update the menus table to match the Sidebar.tsx structure\n');

    // Delete all existing menus (this will cascade delete user access menus)
    console.log('Step 1: Deleting all existing menus...');
    const deletedCount = await prisma.menus.deleteMany({});
    console.log(`  ✓ Deleted ${deletedCount.count} existing menus\n`);

    // Create menus with parent-child relationships
    console.log('Step 2: Creating new menu structure...\n');

    let totalCreated = 0;

    for (const parentMenu of menuStructure) {
      console.log(`Creating parent menu: ${parentMenu.name}`);

      const parent = await prisma.menus.create({
        data: {
          id: `MENU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: parentMenu.name,
          route: parentMenu.route,
          icon: parentMenu.icon,
          order: parentMenu.order,
          updated_at: new Date(),
        },
      });

      totalCreated++;
      console.log(`  ✓ Created parent: ${parent.name} (ID: ${parent.id})`);

      if (parentMenu.children && parentMenu.children.length > 0) {
        console.log(`  Creating ${parentMenu.children.length} children...`);

        for (const childMenu of parentMenu.children) {
          const child = await prisma.menus.create({
            data: {
              id: `MENU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: childMenu.name,
              route: childMenu.route,
              icon: childMenu.icon,
              order: childMenu.order,
              parent_id: parent.id,
              updated_at: new Date(),
            },
          });

          totalCreated++;
          console.log(`    └─ Created child: ${child.name} (ID: ${child.id})`);

          // Small delay to ensure unique IDs
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      console.log('');
    }

    // Verify the results
    console.log('\nStep 3: Verifying results...\n');

    const allMenus = await prisma.menus.findMany({
      orderBy: [
        { order: 'asc' },
        { parent_id: 'asc' }
      ],
    });

    const parentMenus = allMenus.filter(m => !m.parent_id);
    const childMenus = allMenus.filter(m => m.parent_id);

    console.log('=== RESULTS ===');
    console.log(`Total menus created: ${totalCreated}`);
    console.log(`Parent menus: ${parentMenus.length}`);
    console.log(`Child menus: ${childMenus.length}`);

    console.log('\n=== MENU HIERARCHY ===\n');

    parentMenus.forEach((parent) => {
      const route = parent.route ? ` (${parent.route})` : '';
      console.log(`${parent.order}. ${parent.name}${route}`);

      const children = allMenus.filter(m => m.parent_id === parent.id);
      children.forEach((child) => {
        console.log(`   - ${child.name} (${child.route})`);
      });

      if (children.length === 0 && !parent.route) {
        console.log('   (No children - this should not happen!)');
      }
    });

    console.log('\n=== UPDATE COMPLETE ===');
    console.log('The menu structure now matches the Sidebar.tsx component.');
    console.log('\nNext steps:');
    console.log('1. Check the Access Menu Management page to verify the structure');
    console.log('2. Update user permissions if needed');

  } catch (error) {
    console.error('\n=== ERROR ===');
    console.error('Failed to update menu structure:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Execute the script
updateMenuStructure()
  .then(() => {
    console.log('\nScript completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nScript failed with error:', error);
    process.exit(1);
  });
