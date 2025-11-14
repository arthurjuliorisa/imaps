import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Fixing Beginning Data menu structure...\n');

  try {
    // Find the Beginning Data parent menu
    const beginningDataParent = await prisma.menu.findFirst({
      where: {
        name: 'Beginning Data',
      },
    });

    if (!beginningDataParent) {
      console.log('❌ Beginning Data parent menu not found!');
      process.exit(1);
    }

    console.log(`✅ Found Beginning Data parent: ${beginningDataParent.id}\n`);

    // Find the orphaned children menus
    const childrenNames = [
      'Beginning Raw Material',
      'Beginning Finish Good',
      'Beginning Capital Goods',
    ];

    console.log('Updating orphaned children to correct parent...\n');

    for (const childName of childrenNames) {
      const child = await prisma.menu.findFirst({
        where: {
          name: childName,
        },
      });

      if (!child) {
        console.log(`⚠️  Menu "${childName}" not found. Skipping...`);
        continue;
      }

      // Update the parentId
      await prisma.menu.update({
        where: {
          id: child.id,
        },
        data: {
          parentId: beginningDataParent.id,
        },
      });

      console.log(`✅ Updated "${childName}"`);
      console.log(`   Old parentId: ${child.parentId}`);
      console.log(`   New parentId: ${beginningDataParent.id}\n`);
    }

    console.log('✨ Menu structure has been fixed!\n');

    // Verify the results
    const fixedChildren = await prisma.menu.findMany({
      where: {
        parentId: beginningDataParent.id,
      },
      orderBy: {
        order: 'asc',
      },
    });

    console.log('📋 Final Beginning Data menu structure:');
    console.log(`   ${beginningDataParent.name} [parent]`);
    fixedChildren.forEach(child => {
      console.log(`     └─ ${child.order}. ${child.name} (${child.route})`);
    });

    console.log('\n📝 Next steps:');
    console.log('   1. Refresh your browser to see the changes in Access Menu');
    console.log('   2. Assign permissions to users who need access\n');

  } catch (error) {
    console.error('❌ Error fixing menu structure:', error);
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
