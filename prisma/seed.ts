import { PrismaClient, Prisma } from '@prisma/client';

// NOTE: If you see TypeScript errors below, run `npx prisma generate` first
// This regenerates Prisma Client with updated schema types

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function main() {
  console.log('🌱 Starting database seeding...\n');
  console.log('ℹ️  Note: Seeding all 3 companies, but transactions only for company 1310 (development)\n');

  // ============================================================================
  // 1. SEED ALL 3 COMPANIES
  // ============================================================================
  console.log('📦 Seeding companies...');
  
  const companies = await Promise.all([
    prisma.company.upsert({
      where: { code: 1370 },
      update: {},
      create: {
        code: 1370,
        name: 'PT. Polygroup Manufaktur Indonesia',
        status: 'ACTIVE',
      },
    }),
    prisma.company.upsert({
      where: { code: 1310 },
      update: {},
      create: {
        code: 1310,
        name: 'PT. Harmoni Cahaya Indonesia',
        status: 'ACTIVE',
      },
    }),
    prisma.company.upsert({
      where: { code: 1380 },
      update: {},
      create: {
        code: 1380,
        name: 'PT. Sino Berkat Indonesia',
        status: 'ACTIVE',
      },
    }),
  ]);

  console.log(`✅ Created ${companies.length} companies\n`);

  // ============================================================================
  // 2. SEED ITEM TYPES (Master Data)
  // ============================================================================
  console.log('🏷️  Seeding item types...');
  
  const itemTypes = await Promise.all([
    prisma.itemType.upsert({
      where: { item_type_code: 'ROH' },
      update: {},
      create: {
        item_type_code: 'ROH',
        name_en: 'Raw Materials',
        name_de: 'Rohstoffe',
        name_id: 'Bahan Baku',
        category: 'MATERIAL',
        description: 'Raw materials directly consumed in production',
        sort_order: 1,
      },
    }),
    prisma.itemType.upsert({
      where: { item_type_code: 'HALB' },
      update: {},
      create: {
        item_type_code: 'HALB',
        name_en: 'Semifinished Goods',
        name_de: 'Halbfabrikat',
        name_id: 'Barang Setengah Jadi',
        category: 'MATERIAL',
        description: 'Work-in-progress and semifinished goods',
        sort_order: 2,
      },
    }),
    prisma.itemType.upsert({
      where: { item_type_code: 'FERT' },
      update: {},
      create: {
        item_type_code: 'FERT',
        name_en: 'Finished Goods',
        name_de: 'Fertigerzeugnisse',
        name_id: 'Barang Jadi',
        category: 'MATERIAL',
        description: 'Completed products ready for sale',
        sort_order: 3,
      },
    }),
    prisma.itemType.upsert({
      where: { item_type_code: 'HIBE' },
      update: {},
      create: {
        item_type_code: 'HIBE',
        name_en: 'Operating Supplies',
        name_de: 'Hilfsbetriebsstoffe',
        name_id: 'Bahan Penolong',
        category: 'MATERIAL',
        description: 'General operating supplies for production support',
        sort_order: 4,
      },
    }),
    prisma.itemType.upsert({
      where: { item_type_code: 'HIBE_M' },
      update: {},
      create: {
        item_type_code: 'HIBE_M',
        name_en: 'Capital Goods - Machine',
        name_de: 'Hilfsbetriebsstoffe - Mesin',
        name_id: 'Barang Modal - Mesin',
        category: 'CAPITAL_GOODS',
        description: 'Machinery and production equipment',
        sort_order: 5,
      },
    }),
    prisma.itemType.upsert({
      where: { item_type_code: 'HIBE_E' },
      update: {},
      create: {
        item_type_code: 'HIBE_E',
        name_en: 'Capital Goods - Engineering',
        name_de: 'Hilfsbetriebsstoffe - Teknik',
        name_id: 'Barang Modal - Teknik',
        category: 'CAPITAL_GOODS',
        description: 'Engineering equipment and tools',
        sort_order: 6,
      },
    }),
    prisma.itemType.upsert({
      where: { item_type_code: 'HIBE_T' },
      update: {},
      create: {
        item_type_code: 'HIBE_T',
        name_en: 'Capital Goods - Tools',
        name_de: 'Hilfsbetriebsstoffe - Alat',
        name_id: 'Barang Modal - Alat',
        category: 'CAPITAL_GOODS',
        description: 'Tools and instruments',
        sort_order: 7,
      },
    }),
    prisma.itemType.upsert({
      where: { item_type_code: 'DIEN' },
      update: {},
      create: {
        item_type_code: 'DIEN',
        name_en: 'Services',
        name_de: 'Dienstleistungen',
        name_id: 'Jasa',
        category: 'SERVICES',
        description: 'Service items',
        sort_order: 8,
      },
    }),
    prisma.itemType.upsert({
      where: { item_type_code: 'SCRAP' },
      update: {},
      create: {
        item_type_code: 'SCRAP',
        name_en: 'Scrap and Waste',
        name_de: 'Schrott',
        name_id: 'Limbah',
        category: 'WASTE',
        description: 'Production waste and rejected materials',
        sort_order: 9,
      },
    }),
  ]);

  console.log(`✅ Created ${itemTypes.length} item types\n`);

  // ============================================================================
  // 3. SEED USERS
  // ============================================================================
  console.log('👤 Seeding users...');
  
  const users = await Promise.all([
    prisma.user.upsert({
      where: { username: 'admin' },
      update: {},
      create: {
        username: 'admin',
        email: 'admin@harmoni.co.id',
        password: '$2b$10$rQ8YvXZfXjKxKx7vXjKxKeLqT8YvXZfXjKxKx7vXjKxKe', // bcrypt hash of 'admin123' (example only)
        full_name: 'System Administrator',
        role: 'ADMIN',
        company_code: null, // Super admin - all companies
        is_active: true,
      },
    }),
    prisma.user.upsert({
      where: { username: 'wms_integration' },
      update: {},
      create: {
        username: 'wms_integration',
        email: 'wms@harmoni.co.id',
        password: '$2b$10$wQ8YvXZfXjKxKx7vXjKxKeLqT8YvXZfXjKxKx7vXjKxKe', // bcrypt hash of 'wms123' (example only)
        full_name: 'WMS Integration User',
        role: 'API',
        company_code: null, // API user - all companies
        is_active: true,
      },
    }),
    prisma.user.upsert({
      where: { username: 'user_1310' },
      update: {},
      create: {
        username: 'user_1310',
        email: 'user@harmoni.co.id',
        password: '$2b$10$uQ8YvXZfXjKxKx7vXjKxKeLqT8YvXZfXjKxKx7vXjKxKe', // bcrypt hash of 'user123' (example only)
        full_name: 'Company 1310 User',
        role: 'USER',
        company_code: 1310,
        is_active: true,
      },
    }),
  ]);

  console.log(`✅ Created ${users.length} users\n`);

  // ============================================================================
  // 4. SEED ITEMS
  // ============================================================================
  console.log('📋 Seeding items...');
  
  const items = await Promise.all([
    prisma.item.upsert({
      where: { company_code_item_code: { company_code: 1310, item_code: 'RM-1310-001' } },
      update: {},
      create: {
        company_code: 1310,
        item_code: 'RM-1310-001',
        item_name: 'Polyester Yarn 150D White',
        item_type: 'ROH',
        hs_code: '5402.46.00',
        uom: 'KG',
        is_active: true,
      },
    }),
    prisma.item.upsert({
      where: { company_code_item_code: { company_code: 1310, item_code: 'FG-1310-001' } },
      update: {},
      create: {
        company_code: 1310,
        item_code: 'FG-1310-001',
        item_name: 'Finished Fabric Roll Grade A',
        item_type: 'FERT',
        hs_code: '5407.42.00',
        uom: 'ROLL',
        is_active: true,
      },
    }),
  ]);

  console.log(`✅ Created ${items.length} items\n`);

  // ============================================================================
  // 5. SEED TRANSACTIONS (Fixed for partitioned tables - no nested creates)
  // ============================================================================
  console.log('📦 Seeding transactions...');

  // 1. INCOMING GOODS
  const incomingGood = await prisma.incomingGood.create({
    data: {
      wms_id: 'INC-1310-20251214-001',
      company_code: 1310,
      owner: 1310,
      customs_document_type: 'BC23',
      ppkek_number: 'PPKEK-1310-2025-0001',
      customs_registration_date: new Date('2026-12-10'),
      incoming_evidence_number: 'SJ-1310-IN-001',
      incoming_date: new Date('2026-12-14'),
      invoice_number: 'INV-001',
      invoice_date: new Date('2026-12-08'),
      shipper_name: 'PT Supplier Materials',
      timestamp: new Date(),
    },
  });

  await prisma.incomingGoodItem.create({
    data: {
      incoming_good_id: incomingGood.id,
      incoming_good_company: incomingGood.company_code,
      incoming_good_date: incomingGood.incoming_date,
      item_type: 'ROH',
      item_code: 'RM-1310-001',
      item_name: 'Polyester Yarn 150D White',
      hs_code: '5402.46.00',
      uom: 'KG',
      qty: 1000,
      currency: 'USD',
      amount: 5000,
    },
  });

  console.log(`✅ Created incoming goods: ${incomingGood.wms_id}`);

  // 2. MATERIAL USAGE
  const materialUsage = await prisma.materialUsage.create({
    data: {
      wms_id: 'MAT-1310-20251214-001',
      company_code: 1310,
      work_order_number: 'WO-1310-001',
      internal_evidence_number: 'INT-MAT-001',
      transaction_date: new Date('2026-12-14'),
      timestamp: new Date(),
    },
  });

  await prisma.materialUsageItem.create({
    data: {
      material_usage_id: materialUsage.id,
      material_usage_company: materialUsage.company_code,
      material_usage_date: materialUsage.transaction_date,
      item_type: 'ROH',
      item_code: 'RM-1310-001',
      item_name: 'Polyester Yarn 150D White',
      uom: 'KG',
      qty: 300,
      ppkek_number: 'PPKEK-1310-2025-0001',
    },
  });

  console.log(`✅ Created material usage: ${materialUsage.wms_id}`);

  // 3. PRODUCTION OUTPUT
  const productionOutput = await prisma.productionOutput.create({
    data: {
      wms_id: 'PROD-1310-20251214-001',
      company_code: 1310,
      internal_evidence_number: 'INT-PROD-001',
      transaction_date: new Date('2026-12-14'),
      timestamp: new Date(),
    },
  });

  await prisma.productionOutputItem.create({
    data: {
      production_output_id: productionOutput.id,
      production_output_company: productionOutput.company_code,
      production_output_date: productionOutput.transaction_date,
      item_type: 'FERT',
      item_code: 'FG-1310-001',
      item_name: 'Finished Fabric Roll Grade A',
      uom: 'ROLL',
      qty: 50,
      work_order_numbers: ['WO-1310-001'],
    },
  });

  console.log(`✅ Created production output: ${productionOutput.wms_id}`);

  // 4. OUTGOING GOODS
  const outgoingGood = await prisma.outgoingGood.create({
    data: {
      wms_id: 'OUT-1310-20251214-001',
      company_code: 1310,
      owner: 1310,
      customs_document_type: 'BC30',
      ppkek_number: 'PPKEK-1310-2025-0002',
      customs_registration_date: new Date('2026-12-12'),
      outgoing_evidence_number: 'SJ-OUT-001',
      outgoing_date: new Date('2026-12-14'),
      invoice_number: 'INV-EXP-001',
      invoice_date: new Date('2026-12-11'),
      recipient_name: 'Global Textile Buyers',
      timestamp: new Date(),
    },
  });

  await prisma.outgoingGoodItem.create({
    data: {
      outgoing_good_id: outgoingGood.id,
      outgoing_good_company: outgoingGood.company_code,
      outgoing_good_date: outgoingGood.outgoing_date,
      item_type: 'FERT',
      item_code: 'FG-1310-001',
      item_name: 'Finished Fabric Roll Grade A',
      production_output_wms_ids: ['PROD-1310-20251214-001'],
      hs_code: '5407.42.00',
      uom: 'ROLL',
      qty: 30,
      currency: 'USD',
      amount: 4500,
    },
  });

  console.log(`✅ Created outgoing goods: ${outgoingGood.wms_id}\n`);

  console.log('🎉 Database seeding completed!');
  console.log('📊 Summary:');
  console.log(`   - ${companies.length} companies (1370, 1310, 1380)`);
  console.log(`   - ${users.length} users`);
  console.log(`   - ${items.length} items (company 1310 only)`);
  console.log(`   - 4 transactions (company 1310 only)`);
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });