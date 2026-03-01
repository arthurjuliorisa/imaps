import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedUserAccessMenus() {
  console.log('🔐 Seeding User Access Menus...');

  // Admin has access to all menus
  const adminUser = await prisma.users.findUnique({
    where: { email: 'admin@imaps.local' },
  });

  if (adminUser) {
    const allMenus = await prisma.menus.findMany();
    let grantedCount = 0;

    for (const menu of allMenus) {
      await prisma.user_access_menus.upsert({
        where: {
          user_id_menu_id: {
            user_id: adminUser.id,
            menu_id: menu.id,
          },
        },
        update: {
          can_view: true,
          can_create: true,
          can_edit: true,
          can_delete: true,
        },
        create: {
          user_id: adminUser.id,
          menu_id: menu.id,
          can_view: true,
          can_create: true,
          can_edit: true,
          can_delete: true,
        },
      });
      grantedCount++;
    }
    console.log(`  ✓ Granted full access to admin user (${grantedCount} menus)`);
  }

  // All other users (USER, CUSTOMS, etc.) must have menu access manually configured by ADMIN through the UI
  // No automatic seeding for non-admin roles
  console.log('  ℹ️  Non-admin users (USER, CUSTOMS, etc.) must receive menu access via ADMIN UI configuration');

  console.log('✓ Completed: User access menus seeded\n');
}
