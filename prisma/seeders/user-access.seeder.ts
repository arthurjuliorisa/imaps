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

  // Viewer has read-only access to Dashboard and Reports
  const viewerUser = await prisma.users.findUnique({
    where: { email: 'viewer@imaps.local' },
  });

  if (viewerUser) {
    const viewerMenuNames = [
      'Dashboard',
      'Lap. per Dokumen',
      'Pemasukan Barang',
      'Pengeluaran Barang',
      'LPJ Mutasi',
      'Work in Progress',
      'Bahan Baku/Penolong',
      'Hasil Produksi',
      'Barang Scrap/Reject',
      'Barang Modal',
    ];

    let grantedCount = 0;
    for (const menuName of viewerMenuNames) {
      const menu = await prisma.menus.findUnique({
        where: { name: menuName },
      });

      if (menu) {
        await prisma.user_access_menus.upsert({
          where: {
            user_id_menu_id: {
              user_id: viewerUser.id,
              menu_id: menu.id,
            },
          },
          update: {
            can_view: true,
            can_create: false,
            can_edit: false,
            can_delete: false,
          },
          create: {
            user_id: viewerUser.id,
            menu_id: menu.id,
            can_view: true,
            can_create: false,
            can_edit: false,
            can_delete: false,
          },
        });
        grantedCount++;
      }
    }
    console.log(`  ✓ Granted read-only access to viewer user (${grantedCount} menus)`);
  }

  // Operator has CRUD access to Customs and LPJ modules
  const operatorUser = await prisma.users.findUnique({
    where: { email: 'operator@imaps.local' },
  });

  if (operatorUser) {
    const operatorMenuNames = [
      'Dashboard',
      'Lap. per Dokumen',
      'Pemasukan Barang',
      'Pengeluaran Barang',
      'LPJ Mutasi',
      'Work in Progress',
      'Bahan Baku/Penolong',
      'Hasil Produksi',
      'Barang Scrap/Reject',
      'Barang Modal',
    ];

    let grantedCount = 0;
    for (const menuName of operatorMenuNames) {
      const menu = await prisma.menus.findUnique({
        where: { name: menuName },
      });

      if (menu) {
        await prisma.user_access_menus.upsert({
          where: {
            user_id_menu_id: {
              user_id: operatorUser.id,
              menu_id: menu.id,
            },
          },
          update: {
            can_view: true,
            can_create: true,
            can_edit: true,
            can_delete: false,
          },
          create: {
            user_id: operatorUser.id,
            menu_id: menu.id,
            can_view: true,
            can_create: true,
            can_edit: true,
            can_delete: false,
          },
        });
        grantedCount++;
      }
    }
    console.log(`  ✓ Granted CRUD access to operator user (${grantedCount} menus)`);
  }

  console.log('Completed: User access menus seeded\n');
}
