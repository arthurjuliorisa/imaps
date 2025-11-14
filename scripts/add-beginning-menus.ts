import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Adding Beginning Data menu section...\n');

  try {
    // Check if "Beginning Data" parent menu already exists
    const existingBeginningData = await prisma.menu.findFirst({
      where: {
        name: 'Beginning Data',
      },
    });

    if (existingBeginningData) {
      console.log('⚠️  "Beginning Data" parent menu already exists. Skipping...\n');

      // Show existing structure
      const children = await prisma.menu.findMany({
        where: {
          parentId: existingBeginningData.id,
        },
        orderBy: {
          order: 'asc',
        },
      });

      console.log('📋 Existing Beginning Data menus:');
      console.log(`   - ${existingBeginningData.name} [parent]`);
      children.forEach(child => {
        console.log(`     └─ ${child.name} (${child.route})`);
      });

      return;
    }

    // Get the highest order value for parent menus
    const lastParentMenu = await prisma.menu.findFirst({
      where: {
        parentId: null,
      },
      orderBy: {
        order: 'desc',
      },
    });

    const parentOrder = (lastParentMenu?.order || 0) + 1;
    console.log(`📊 Creating "Beginning Data" parent menu with order: ${parentOrder}\n`);

    // Create the "Beginning Data" parent menu
    const beginningDataParent = await prisma.menu.create({
      data: {
        name: 'Beginning Data',
        route: null,
        icon: 'PlaylistAdd',
        order: parentOrder,
      },
    });

    console.log(`✅ Created parent menu: "${beginningDataParent.name}"\n`);

    // Create the three child menu items
    const menuItems = [
      {
        name: 'Beginning Raw Material',
        route: '/customs/beginning-raw-material',
        icon: 'Description',
        parentId: beginningDataParent.id,
        order: 1,
      },
      {
        name: 'Beginning Finish Good',
        route: '/customs/beginning-finish-good',
        icon: 'Description',
        parentId: beginningDataParent.id,
        order: 2,
      },
      {
        name: 'Beginning Capital Goods',
        route: '/customs/beginning-capital-goods',
        icon: 'Description',
        parentId: beginningDataParent.id,
        order: 3,
      },
    ];

    console.log('Adding child menu items...\n');

    for (const item of menuItems) {
      const created = await prisma.menu.create({
        data: item,
      });

      console.log(`✅ Created child menu: "${created.name}"`);
      console.log(`   Route: ${created.route}`);
      console.log(`   Order: ${created.order}\n`);
    }

    console.log('\n✨ Beginning Data menu section has been added successfully!\n');

    // Show final structure
    const allBeginningMenus = await prisma.menu.findMany({
      where: {
        OR: [
          { id: beginningDataParent.id },
          { parentId: beginningDataParent.id },
        ],
      },
      orderBy: [
        { parentId: 'asc' },
        { order: 'asc' },
      ],
    });

    console.log('📋 Final menu structure:');
    console.log(`   ${beginningDataParent.name} [parent]`);
    allBeginningMenus
      .filter(m => m.parentId === beginningDataParent.id)
      .forEach(child => {
        console.log(`     └─ ${child.name}`);
      });

    console.log('\n📝 Next steps:');
    console.log('   1. Go to Settings > Access Menu to configure permissions');
    console.log('   2. Assign these menus to users who need access');
    console.log('   3. Refresh the page to see the new menu section\n');

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
