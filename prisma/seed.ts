import { PrismaClient, Prisma } from '@prisma/client';

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
  // 2. SEED USERS
  // ============================================================================
  console.log('👤 Seeding users...');
  
  const users = await Promise.all([
    prisma.user.upsert({
      where: { username: 'admin' },
      update: {},
      create: {
        username: 'admin',
        email: 'admin@harmoni.co.id',
        full_name: 'System Administrator',
        is_active: true,
      },
    }),
    prisma.user.upsert({
      where: { username: 'wms_integration' },
      update: {},
      create: {
        username: 'wms_integration',
        email: 'wms@harmoni.co.id',
        full_name: 'WMS Integration User',
        is_active: true,
      },
    }),
  ]);

  console.log(`✅ Created ${users.length} users\n`);

  // ============================================================================
  // 3. SEED ITEMS
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
  // 4. SEED TRANSACTIONS (Now works with auto-increment!)
  // ============================================================================
  console.log('📦 Seeding transactions...');

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
      items: {
        create: [
          {
            incoming_good_company: 1310,
            incoming_good_date: new Date('2026-12-14'),
            item_type: 'ROH',
            item_code: 'RM-1310-001',
            item_name: 'Polyester Yarn 150D White',
            hs_code: '5402.46.00',
            uom: 'KG',
            qty: 1000,
            currency: 'USD',
            amount: 5000,
          },
        ],
      },
    },
  });

  console.log(`✅ Created incoming goods: ${incomingGood.wms_id}`);

  const materialUsage = await prisma.materialUsage.create({
    data: {
      wms_id: 'MAT-1310-20251214-001',
      company_code: 1310,
      work_order_number: 'WO-1310-001',
      internal_evidence_number: 'INT-MAT-001',
      transaction_date: new Date('2026-12-14'),
      timestamp: new Date(),
      items: {
        create: [
          {
            material_usage_company: 1310,
            material_usage_date: new Date('2026-12-14'),
            item_type: 'ROH',
            item_code: 'RM-1310-001',
            item_name: 'Polyester Yarn 150D White',
            uom: 'KG',
            qty: 300,
            ppkek_number: 'PPKEK-1310-2025-0001',
          },
        ],
      },
    },
  });

  console.log(`✅ Created material usage: ${materialUsage.wms_id}`);

  const productionOutput = await prisma.productionOutput.create({
    data: {
      wms_id: 'PROD-1310-20251214-001',
      company_code: 1310,
      internal_evidence_number: 'INT-PROD-001',
      transaction_date: new Date('2026-12-14'),
      timestamp: new Date(),
      items: {
        create: [
          {
            production_output_company: 1310,
            production_output_date: new Date('2026-12-14'),
            item_type: 'FERT',
            item_code: 'FG-1310-001',
            item_name: 'Finished Fabric Roll Grade A',
            uom: 'ROLL',
            qty: 50,
            work_order_numbers: ['WO-1310-001'],
          },
        ],
      },
    },
  });

  console.log(`✅ Created production output: ${productionOutput.wms_id}`);

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
      items: {
        create: [
          {
            outgoing_good_company: 1310,
            outgoing_good_date: new Date('2026-12-14'),
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
        ],
      },
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
