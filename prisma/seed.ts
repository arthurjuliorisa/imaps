import { PrismaClient, ItemTypeCode, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding for v2.4.2...\n');

  try {
    // ==================== SEED COMPANIES ====================
    console.log('🏢 Seeding Companies...');
    const companies = [
      { company_code: 'ACME', company_name: 'PT ACME Manufacturing Indonesia', is_active: true },
      { company_code: 'XYZ', company_name: 'PT XYZ Industries', is_active: true },
    ];

    for (const company of companies) {
      await prisma.companies.upsert({
        where: { company_code: company.company_code },
        update: {},
        create: company,
      });
      console.log(`  ✓ Created/Updated Company: ${company.company_code} - ${company.company_name}`);
    }
    console.log('');

    // ==================== SEED ITEM TYPES ====================
    console.log('📦 Seeding Item Types...');
    const itemTypes = [
      { item_type_code: ItemTypeCode.ROH, item_type_name: 'Bahan Baku / Raw Material', is_capital_goods: false },
      { item_type_code: ItemTypeCode.HALB, item_type_name: 'Barang Setengah Jadi / WIP', is_capital_goods: false },
      { item_type_code: ItemTypeCode.FERT, item_type_name: 'Barang Jadi / Finished Goods', is_capital_goods: false },
      { item_type_code: ItemTypeCode.HIBE, item_type_name: 'Barang Modal / Capital Goods (General)', is_capital_goods: true },
      { item_type_code: ItemTypeCode.HIBE_M, item_type_name: 'Mesin / Machinery', is_capital_goods: true },
      { item_type_code: ItemTypeCode.HIBE_E, item_type_name: 'Peralatan / Equipment', is_capital_goods: true },
      { item_type_code: ItemTypeCode.HIBE_T, item_type_name: 'Alat Produksi / Production Tools', is_capital_goods: true },
      { item_type_code: ItemTypeCode.DIEN, item_type_name: 'Jasa / Services', is_capital_goods: false },
      { item_type_code: ItemTypeCode.SCRAP, item_type_name: 'Sisa/Skrap / Scrap', is_capital_goods: false },
    ];

    for (const itemType of itemTypes) {
      await prisma.item_types.upsert({
        where: { item_type_code: itemType.item_type_code },
        update: { item_type_name: itemType.item_type_name, is_capital_goods: itemType.is_capital_goods },
        create: itemType,
      });
      console.log(`  ✓ Created/Updated Item Type: ${itemType.item_type_code} - ${itemType.item_type_name}`);
    }
    console.log('');

    // ==================== SEED MENUS ====================
    console.log('🗂️ Seeding Menus...');
    const menus = [
      { name: 'Dashboard', route: '/dashboard', icon: 'HomeIcon', order: 1, parentId: null },

      // Master Data
      { name: 'Master Data', route: '#', icon: 'DatabaseIcon', order: 10, parentId: null },
      { name: 'Companies', route: '/master/companies', icon: 'BuildingIcon', order: 11, parentId: null },
      { name: 'Item Types', route: '/master/item-types', icon: 'TagIcon', order: 12, parentId: null },
      { name: 'Beginning Balances', route: '/master/beginning-balances', icon: 'ScaleIcon', order: 13, parentId: null },

      // Customs Transactions
      { name: 'Customs', route: '#', icon: 'TruckIcon', order: 20, parentId: null },
      { name: 'Incoming Goods', route: '/customs/incoming', icon: 'ArrowDownIcon', order: 21, parentId: null },
      { name: 'Outgoing Goods', route: '/customs/outgoing', icon: 'ArrowUpIcon', order: 22, parentId: null },
      { name: 'Material Usage', route: '/customs/material-usage', icon: 'CogIcon', order: 23, parentId: null },
      { name: 'Production Output', route: '/customs/production', icon: 'PackageIcon', order: 24, parentId: null },
      { name: 'WIP Balance', route: '/customs/wip-balance', icon: 'LayersIcon', order: 25, parentId: null },
      { name: 'Adjustments', route: '/customs/adjustments', icon: 'EditIcon', order: 26, parentId: null },

      // Reports
      { name: 'Reports', route: '#', icon: 'FileTextIcon', order: 30, parentId: null },
      { name: 'Stock Daily Snapshot', route: '/reports/stock-snapshot', icon: 'CameraIcon', order: 31, parentId: null },
      { name: 'PPKEK Traceability', route: '/reports/traceability', icon: 'GitBranchIcon', order: 32, parentId: null },
      { name: 'Work Order Summary', route: '/reports/work-orders', icon: 'ClipboardIcon', order: 33, parentId: null },

      // Settings
      { name: 'Settings', route: '#', icon: 'SettingsIcon', order: 40, parentId: null },
      { name: 'Users', route: '/settings/users', icon: 'UsersIcon', order: 41, parentId: null },
      { name: 'Access Control', route: '/settings/access-menu', icon: 'ShieldIcon', order: 42, parentId: null },
      { name: 'Activity Logs', route: '/settings/activity-logs', icon: 'ListIcon', order: 43, parentId: null },
      { name: 'Batch Processing Logs', route: '/settings/batch-logs', icon: 'ServerIcon', order: 44, parentId: null },
    ];

    const createdMenus = [];
    for (const menu of menus) {
      const menuData = { ...menu, parent_id: menu.parentId };
      delete (menuData as any).parentId;
      const created = await prisma.menus.upsert({
        where: { name: menu.name },
        update: { route: menu.route, icon: menu.icon, order: menu.order, parent_id: menu.parentId },
        create: menuData,
      });
      createdMenus.push(created);
      console.log(`  ✓ Created/Updated Menu: ${menu.name}`);
    }
    console.log('');

    // ==================== SEED USERS ====================
    console.log('👥 Seeding Users...');
    const users = [
      {
        username: 'admin',
        email: 'admin@imaps.local',
        password: await bcrypt.hash('admin123', 10),
        role: UserRole.ADMIN,
        company_code: 'ACME',
      },
      {
        username: 'viewer',
        email: 'viewer@imaps.local',
        password: await bcrypt.hash('viewer123', 10),
        role: UserRole.VIEWER,
        company_code: 'ACME',
      },
      {
        username: 'operator',
        email: 'operator@imaps.local',
        password: await bcrypt.hash('operator123', 10),
        role: UserRole.USER,
        company_code: 'ACME',
      },
    ];

    for (const user of users) {
      await prisma.users.upsert({
        where: { email: user.email },
        update: {
          username: user.username,
          password: user.password,
          role: user.role,
          company_code: user.company_code,
        },
        create: user,
      });
      console.log(`  ✓ Created/Updated User: ${user.email} (${user.role})`);
    }
    console.log('');

    // ==================== SEED USER ACCESS MENU ====================
    console.log('🔐 Seeding User Access Menu...');

    // Admin has access to all menus
    const adminUser = await prisma.users.findUnique({ where: { email: 'admin@imaps.local' } });
    if (adminUser) {
      const allMenus = await prisma.menus.findMany();
      for (const menu of allMenus) {
        await prisma.user_access_menus.upsert({
          where: {
            user_id_menu_id: {
              user_id: adminUser.id,
              menu_id: menu.id,
            },
          },
          update: { can_view: true, can_create: true, can_edit: true, can_delete: true },
          create: {
            user_id: adminUser.id,
            menu_id: menu.id,
            can_view: true,
            can_create: true,
            can_edit: true,
            can_delete: true,
          },
        });
      }
      console.log(`  ✓ Granted full access to admin user (${allMenus.length} menus)`);
    }

    // Viewer has read-only access to Dashboard and Reports
    const viewerUser = await prisma.users.findUnique({ where: { email: 'viewer@imaps.local' } });
    if (viewerUser) {
      const viewerMenuNames = ['Dashboard', 'Reports', 'Stock Daily Snapshot', 'PPKEK Traceability', 'Work Order Summary'];
      for (const menuName of viewerMenuNames) {
        const menu = await prisma.menus.findUnique({ where: { name: menuName } });
        if (menu) {
          await prisma.user_access_menus.upsert({
            where: {
              user_id_menu_id: {
                user_id: viewerUser.id,
                menu_id: menu.id,
              },
            },
            update: { can_view: true, can_create: false, can_edit: false, can_delete: false },
            create: {
              user_id: viewerUser.id,
              menu_id: menu.id,
              can_view: true,
              can_create: false,
              can_edit: false,
              can_delete: false,
            },
          });
        }
      }
      console.log(`  ✓ Granted read-only access to viewer user (${viewerMenuNames.length} menus)`);
    }

    // Operator has CRUD access to Customs module
    const operatorUser = await prisma.users.findUnique({ where: { email: 'operator@imaps.local' } });
    if (operatorUser) {
      const operatorMenuNames = ['Dashboard', 'Customs', 'Incoming Goods', 'Outgoing Goods', 'Material Usage', 'Production Output', 'WIP Balance', 'Adjustments'];
      for (const menuName of operatorMenuNames) {
        const menu = await prisma.menus.findUnique({ where: { name: menuName } });
        if (menu) {
          await prisma.user_access_menus.upsert({
            where: {
              user_id_menu_id: {
                user_id: operatorUser.id,
                menu_id: menu.id,
              },
            },
            update: { can_view: true, can_create: true, can_edit: true, can_delete: false },
            create: {
              user_id: operatorUser.id,
              menu_id: menu.id,
              can_view: true,
              can_create: true,
              can_edit: true,
              can_delete: false,
            },
          });
        }
      }
      console.log(`  ✓ Granted CRUD access to operator user (${operatorMenuNames.length} menus)`);
    }
    console.log('');

    // ==================== SEED SAMPLE BEGINNING BALANCES ====================
    console.log('📊 Seeding Sample Beginning Balances...');
    const beginningBalances = [
      {
        company_code: 'ACME',
        item_code: 'RM-STEEL-A36',
        item_name: 'Steel Plate A36 - 10mm',
        item_type_code: ItemTypeCode.ROH,
        uom: 'KG',
        balance_qty: 5000.000,
        balance_date: new Date('2026-01-01'),
      },
      {
        company_code: 'ACME',
        item_code: 'WIP-FRAME-001',
        item_name: 'Machine Frame Assembly',
        item_type_code: ItemTypeCode.HALB,
        uom: 'PCS',
        balance_qty: 50.000,
        balance_date: new Date('2026-01-01'),
      },
      {
        company_code: 'ACME',
        item_code: 'FG-MACHINE-X100',
        item_name: 'Industrial Machine X100',
        item_type_code: ItemTypeCode.FERT,
        uom: 'UNIT',
        balance_qty: 10.000,
        balance_date: new Date('2026-01-01'),
      },
    ];

    for (const balance of beginningBalances) {
      await prisma.beginning_balances.upsert({
        where: {
          company_code_item_code_balance_date: {
            company_code: balance.company_code,
            item_code: balance.item_code,
            balance_date: balance.balance_date,
          },
        },
        update: {
          item_name: balance.item_name,
          item_type_code: balance.item_type_code,
          uom: balance.uom,
          balance_qty: balance.balance_qty,
        },
        create: balance,
      });
      console.log(`  ✓ Created/Updated Beginning Balance: ${balance.item_code} - ${balance.balance_qty} ${balance.uom}`);
    }
    console.log('');

    console.log('✅ Database seeding completed successfully!\n');
    console.log('📝 Default Credentials:');
    console.log('   Admin    : admin@imaps.local / admin123');
    console.log('   Viewer   : viewer@imaps.local / viewer123');
    console.log('   Operator : operator@imaps.local / operator123');
    console.log('');

  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
