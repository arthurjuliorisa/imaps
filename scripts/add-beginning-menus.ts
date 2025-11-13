import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Adding Beginning Data menu items...\n');

  try {
    // List all existing menus first
    const allMenus = await prisma.menu.findMany({
      select: {
        id: true,
        name: true,
        route: true,
        parentId: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    console.log('📋 Existing menus:');
    allMenus.forEach(menu => {
      console.log(`   - ${menu.name} (${menu.route || 'no route'}) ${menu.parentId ? '[child]' : '[parent]'}`);
    });
    console.log('');

    // Find the Customs parent menu (try multiple possible names)
    let customsMenu = await prisma.menu.findFirst({
      where: {
        OR: [
          { name: 'Customs' },
          { name: 'CUSTOMS' },
          { route: { contains: '/customs' } },
        ],
      },
    });

    // If not found, create the Customs parent menu
    if (!customsMenu) {
      console.log('⚠️  Customs parent menu not found. Creating it...');
      customsMenu = await prisma.menu.create({
        data: {
          name: 'Customs',
          icon: 'LocalShippingIcon',
          order: 1,
        },
      });
      console.log('✅ Created Customs parent menu');
    } else {
      console.log('✅ Found Customs menu:', customsMenu.name);
    }

    // Get the highest order value for customs children
    const lastCustomsChild = await prisma.menu.findFirst({
      where: {
        parentId: customsMenu.id,
      },
      orderBy: {
        order: 'desc',
      },
    });

    const startingOrder = (lastCustomsChild?.order || 0) + 1;
    console.log(`📊 Starting order number: ${startingOrder}\n`);

    // Create the three new menu items
    const menuItems = [
      {
        name: 'Beginning Raw Material',
        route: '/customs/beginning-raw-material',
        icon: 'PlaylistAddCheckIcon',
        parentId: customsMenu.id,
        order: startingOrder,
      },
      {
        name: 'Beginning Finish Good',
        route: '/customs/beginning-finish-good',
        icon: 'PlaylistAddCheckIcon',
        parentId: customsMenu.id,
        order: startingOrder + 1,
      },
      {
        name: 'Beginning Capital Goods',
        route: '/customs/beginning-capital-goods',
        icon: 'PlaylistAddCheckIcon',
        parentId: customsMenu.id,
        order: startingOrder + 2,
      },
    ];

    // Check if menus already exist
    for (const item of menuItems) {
      const existing = await prisma.menu.findFirst({
        where: {
          name: item.name,
        },
      });

      if (existing) {
        console.log(`⚠️  Menu "${item.name}" already exists. Skipping...`);
        continue;
      }

      // Create the menu item
      const created = await prisma.menu.create({
        data: item,
      });

      console.log(`✅ Created menu: "${created.name}" with route: ${created.route}`);
    }

    console.log('\n✨ All Beginning Data menus have been added successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Go to Settings > Access Menu to configure permissions');
    console.log('   2. Assign these menus to users who need access');
    console.log('   3. Test the new pages in the application\n');

  } catch (error) {
    console.error('❌ Error adding menu items:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
