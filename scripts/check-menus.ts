import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📋 Checking menu structure...\n');

  const allMenus = await prisma.menus.findMany({
    orderBy: [
      { order: 'asc' },
    ],
  });

  console.log(`Total menus: ${allMenus.length}\n`);

  const parents = allMenus.filter(m => !m.parent_id);
  console.log('=== PARENT MENUS ===');
  parents.forEach(p => {
    console.log(`${p.order}. ${p.name} (${p.id})`);
    const children = allMenus.filter(m => m.parent_id === p.id);
    children.forEach(c => {
      console.log(`   └─ ${c.order}. ${c.name} (${c.route || 'no route'})`);
    });
    console.log('');
  });

  // Check for orphaned children (children without parent)
  const orphans = allMenus.filter(m => {
    if (!m.parent_id) return false;
    return !parents.find(p => p.id === m.parent_id);
  });

  if (orphans.length > 0) {
    console.log('⚠️  ORPHANED MENUS (children without parent):');
    orphans.forEach(o => {
      console.log(`   - ${o.name} (parent_id: ${o.parent_id})`);
    });
  }

  await prisma.$disconnect();
}

main();
