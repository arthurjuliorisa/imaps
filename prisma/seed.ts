import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// Import data from seeders
import { uomData } from './seeders/uom.data';
import { currencyData } from './seeders/currency.data';
import { supplierData } from './seeders/supplier.data';
import { customerData } from './seeders/customer.data';
import { userData } from './seeders/user.data';
import {
  rawMaterialData,
  finishedGoodsData,
  semiFinishedData,
  capitalGoodsData,
  scrapItemsData,
} from './seeders/item.data';
import { scrapMasterData } from './seeders/scrap.data';
import { getIncomingDocData, getOutgoingDocData } from './seeders/document.data';
import {
  getRawMaterialMutationData,
  getProductionMutationData,
  getWIPData,
  getScrapMutationData,
  getCapitalGoodsMutationData,
} from './seeders/mutation.data';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...\n');

  try {
    // Store references for relational data
    const uoms: Record<string, any> = {};
    const currencies: Record<string, any> = {};
    const suppliers: Record<string, any> = {};
    const customers: Record<string, any> = {};
    const users: Record<string, any> = {};
    const items: Record<string, any> = {};
    const scrapMasters: Record<string, any> = {};

    // ==================== SEED UOM ====================
    console.log('📦 Seeding UOM (Unit of Measure)...');
    for (const uom of uomData) {
      const existing = await prisma.uOM.findUnique({ where: { code: uom.code } });
      if (!existing) {
        const created = await prisma.uOM.create({ data: uom });
        uoms[uom.code] = created;
        console.log(`  ✓ Created UOM: ${uom.code} - ${uom.name}`);
      } else {
        uoms[uom.code] = existing;
        console.log(`  → UOM already exists: ${uom.code}`);
      }
    }
    console.log('');

    // ==================== SEED CURRENCY ====================
    console.log('💱 Seeding Currency...');
    for (const currency of currencyData) {
      const existing = await prisma.currency.findUnique({ where: { code: currency.code } });
      if (!existing) {
        const created = await prisma.currency.create({ data: currency });
        currencies[currency.code] = created;
        console.log(`  ✓ Created Currency: ${currency.code} - ${currency.name}`);
      } else {
        currencies[currency.code] = existing;
        console.log(`  → Currency already exists: ${currency.code}`);
      }
    }
    console.log('');

    // ==================== SEED SUPPLIERS ====================
    console.log('🚚 Seeding Suppliers...');
    for (const supplier of supplierData) {
      const existing = await prisma.supplier.findUnique({ where: { code: supplier.code } });
      if (!existing) {
        const created = await prisma.supplier.create({ data: supplier });
        suppliers[supplier.code] = created;
        console.log(`  ✓ Created Supplier: ${supplier.code} - ${supplier.name}`);
      } else {
        suppliers[supplier.code] = existing;
        console.log(`  → Supplier already exists: ${supplier.code}`);
      }
    }
    console.log('');

    // ==================== SEED CUSTOMERS ====================
    console.log('👥 Seeding Customers...');
    for (const customer of customerData) {
      const existing = await prisma.customer.findUnique({ where: { code: customer.code } });
      if (!existing) {
        const created = await prisma.customer.create({ data: customer });
        customers[customer.code] = created;
        console.log(`  ✓ Created Customer: ${customer.code} - ${customer.name}`);
      } else {
        customers[customer.code] = existing;
        console.log(`  → Customer already exists: ${customer.code}`);
      }
    }
    console.log('');

    // ==================== SEED USERS ====================
    console.log('👤 Seeding Users...');
    for (const user of userData) {
      const existing = await prisma.user.findUnique({ where: { username: user.username } });
      if (!existing) {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        const created = await prisma.user.create({
          data: {
            username: user.username,
            email: user.email,
            password: hashedPassword,
          },
        });
        users[user.username] = created;
        console.log(`  ✓ Created User: ${user.username} (${user.email})`);
        console.log(`    Password: ${user.password}`);
      } else {
        users[user.username] = existing;
        console.log(`  → User already exists: ${user.username}`);
      }
    }
    console.log('');

    // ==================== SEED ITEMS ====================
    console.log('📦 Seeding Items - Raw Materials...');
    for (const item of rawMaterialData) {
      const existing = await prisma.item.findUnique({ where: { code: item.code } });
      if (!existing) {
        const created = await prisma.item.create({
          data: {
            code: item.code,
            name: item.name,
            type: item.type,
            uomId: uoms[item.uomCode].id,
          },
        });
        items[item.code] = created;
        console.log(`  ✓ Created Item: ${item.code} - ${item.name}`);
      } else {
        items[item.code] = existing;
        console.log(`  → Item already exists: ${item.code}`);
      }
    }
    console.log('');

    console.log('📦 Seeding Items - Finished Goods...');
    for (const item of finishedGoodsData) {
      const existing = await prisma.item.findUnique({ where: { code: item.code } });
      if (!existing) {
        const created = await prisma.item.create({
          data: {
            code: item.code,
            name: item.name,
            type: item.type,
            uomId: uoms[item.uomCode].id,
          },
        });
        items[item.code] = created;
        console.log(`  ✓ Created Item: ${item.code} - ${item.name}`);
      } else {
        items[item.code] = existing;
        console.log(`  → Item already exists: ${item.code}`);
      }
    }
    console.log('');

    console.log('📦 Seeding Items - Semi-Finished Goods...');
    for (const item of semiFinishedData) {
      const existing = await prisma.item.findUnique({ where: { code: item.code } });
      if (!existing) {
        const created = await prisma.item.create({
          data: {
            code: item.code,
            name: item.name,
            type: item.type,
            uomId: uoms[item.uomCode].id,
          },
        });
        items[item.code] = created;
        console.log(`  ✓ Created Item: ${item.code} - ${item.name}`);
      } else {
        items[item.code] = existing;
        console.log(`  → Item already exists: ${item.code}`);
      }
    }
    console.log('');

    console.log('📦 Seeding Items - Capital Goods...');
    for (const item of capitalGoodsData) {
      const existing = await prisma.item.findUnique({ where: { code: item.code } });
      if (!existing) {
        const created = await prisma.item.create({
          data: {
            code: item.code,
            name: item.name,
            type: item.type,
            uomId: uoms[item.uomCode].id,
          },
        });
        items[item.code] = created;
        console.log(`  ✓ Created Item: ${item.code} - ${item.name}`);
      } else {
        items[item.code] = existing;
        console.log(`  → Item already exists: ${item.code}`);
      }
    }
    console.log('');

    console.log('📦 Seeding Items - Scrap...');
    for (const item of scrapItemsData) {
      const existing = await prisma.item.findUnique({ where: { code: item.code } });
      if (!existing) {
        const created = await prisma.item.create({
          data: {
            code: item.code,
            name: item.name,
            type: item.type,
            uomId: uoms[item.uomCode].id,
          },
        });
        items[item.code] = created;
        console.log(`  ✓ Created Item: ${item.code} - ${item.name}`);
      } else {
        items[item.code] = existing;
        console.log(`  → Item already exists: ${item.code}`);
      }
    }
    console.log('');

    // ==================== SEED SCRAP MASTER ====================
    console.log('🗑️  Seeding Scrap Master Collections...');
    for (const scrap of scrapMasterData) {
      const existing = await prisma.scrapMaster.findUnique({ where: { code: scrap.code } });
      if (!existing) {
        const created = await prisma.scrapMaster.create({
          data: {
            code: scrap.code,
            name: scrap.name,
            description: scrap.description,
          },
        });
        scrapMasters[scrap.code] = created;
        console.log(`  ✓ Created ScrapMaster: ${scrap.code} - ${scrap.name}`);

        // Create scrap items
        for (const scrapItem of scrap.items) {
          await prisma.scrapItem.create({
            data: {
              scrapId: created.id,
              itemId: items[scrapItem.itemCode].id,
              quantity: scrapItem.quantity,
              remarks: scrapItem.remarks,
            },
          });
          console.log(`    └─ Added item: ${scrapItem.itemCode} (qty: ${scrapItem.quantity})`);
        }
      } else {
        scrapMasters[scrap.code] = existing;
        console.log(`  → ScrapMaster already exists: ${scrap.code}`);
      }
    }
    console.log('');

    // ==================== SEED INCOMING DOCUMENTS ====================
    console.log('📥 Seeding Incoming Documents...');
    const incomingDocData = getIncomingDocData();
    for (const doc of incomingDocData) {
      const existing = await prisma.incomingDocument.findFirst({
        where: { registerNumber: doc.registerNumber },
      });
      if (!existing) {
        await prisma.incomingDocument.create({
          data: {
            docCode: doc.docCode,
            registerNumber: doc.registerNumber,
            registerDate: doc.registerDate,
            docNumber: doc.docNumber,
            docDate: doc.docDate,
            shipperId: suppliers[doc.supplierCode].id,
            itemId: items[doc.itemCode].id,
            uomId: uoms[doc.uomCode].id,
            quantity: doc.quantity,
            currencyId: currencies[doc.currencyCode].id,
            amount: doc.amount,
          },
        });
        console.log(`  ✓ Created Incoming Doc: ${doc.registerNumber} - ${doc.docNumber}`);
      } else {
        console.log(`  → Incoming Doc already exists: ${doc.registerNumber}`);
      }
    }
    console.log('');

    // ==================== SEED OUTGOING DOCUMENTS ====================
    console.log('📤 Seeding Outgoing Documents...');
    const outgoingDocData = getOutgoingDocData();
    for (const doc of outgoingDocData) {
      const existing = await prisma.outgoingDocument.findFirst({
        where: { registerNumber: doc.registerNumber },
      });
      if (!existing) {
        await prisma.outgoingDocument.create({
          data: {
            docCode: doc.docCode,
            registerNumber: doc.registerNumber,
            registerDate: doc.registerDate,
            docNumber: doc.docNumber,
            docDate: doc.docDate,
            recipientId: customers[doc.customerCode].id,
            itemId: items[doc.itemCode].id,
            uomId: uoms[doc.uomCode].id,
            quantity: doc.quantity,
            currencyId: currencies[doc.currencyCode].id,
            amount: doc.amount,
          },
        });
        console.log(`  ✓ Created Outgoing Doc: ${doc.registerNumber} - ${doc.docNumber}`);
      } else {
        console.log(`  → Outgoing Doc already exists: ${doc.registerNumber}`);
      }
    }
    console.log('');

    // ==================== SEED RAW MATERIAL MUTATIONS ====================
    console.log('🔄 Seeding Raw Material Mutations...');
    const rmMutationData = getRawMaterialMutationData();
    for (const mutation of rmMutationData) {
      const existing = await prisma.rawMaterialMutation.findFirst({
        where: {
          date: mutation.date,
          itemId: items[mutation.itemCode].id,
        },
      });
      if (!existing) {
        await prisma.rawMaterialMutation.create({
          data: {
            date: mutation.date,
            itemId: items[mutation.itemCode].id,
            uomId: uoms[mutation.uomCode].id,
            beginning: mutation.beginning,
            incoming: mutation.incoming,
            outgoing: mutation.outgoing,
            adjustment: mutation.adjustment,
            ending: mutation.ending,
            stockOpname: mutation.stockOpname,
            variant: mutation.variant,
            remarks: mutation.remarks,
          },
        });
        console.log(`  ✓ Created RM Mutation for date: ${mutation.date.toISOString().split('T')[0]}`);
      } else {
        console.log(`  → RM Mutation already exists for this date and item`);
      }
    }
    console.log('');

    // ==================== SEED PRODUCTION MUTATIONS ====================
    console.log('🔄 Seeding Production Mutations...');
    const prodMutationData = getProductionMutationData();
    for (const mutation of prodMutationData) {
      const existing = await prisma.productionMutation.findFirst({
        where: {
          date: mutation.date,
          itemId: items[mutation.itemCode].id,
        },
      });
      if (!existing) {
        await prisma.productionMutation.create({
          data: {
            date: mutation.date,
            itemId: items[mutation.itemCode].id,
            uomId: uoms[mutation.uomCode].id,
            beginning: mutation.beginning,
            incoming: mutation.incoming,
            outgoing: mutation.outgoing,
            adjustment: mutation.adjustment,
            ending: mutation.ending,
            stockOpname: mutation.stockOpname,
            variant: mutation.variant,
            remarks: mutation.remarks,
          },
        });
        console.log(`  ✓ Created Production Mutation for date: ${mutation.date.toISOString().split('T')[0]}`);
      } else {
        console.log(`  → Production Mutation already exists for this date and item`);
      }
    }
    console.log('');

    // ==================== SEED WIP RECORDS ====================
    console.log('⏳ Seeding WIP Records...');
    const wipData = getWIPData();
    for (const wip of wipData) {
      const existing = await prisma.wIPRecord.findUnique({
        where: { date: wip.date },
      });
      if (!existing) {
        await prisma.wIPRecord.create({
          data: {
            date: wip.date,
            itemId: items[wip.itemCode].id,
            uomId: uoms[wip.uomCode].id,
            quantity: wip.quantity,
            remarks: wip.remarks,
          },
        });
        console.log(`  ✓ Created WIP Record for date: ${wip.date.toISOString().split('T')[0]}`);
      } else {
        console.log(`  → WIP Record already exists for date: ${wip.date.toISOString().split('T')[0]}`);
      }
    }
    console.log('');

    // ==================== SEED SCRAP MUTATIONS ====================
    console.log('🔄 Seeding Scrap Mutations...');
    const scrapMutationData = getScrapMutationData();
    for (const mutation of scrapMutationData) {
      const existing = await prisma.scrapMutation.findFirst({
        where: {
          date: mutation.date,
          scrapId: scrapMasters[mutation.scrapCode].id,
        },
      });
      if (!existing) {
        await prisma.scrapMutation.create({
          data: {
            date: mutation.date,
            scrapId: scrapMasters[mutation.scrapCode].id,
            uomId: uoms[mutation.uomCode].id,
            beginning: mutation.beginning,
            incoming: mutation.incoming,
            outgoing: mutation.outgoing,
            adjustment: mutation.adjustment,
            ending: mutation.ending,
            stockOpname: mutation.stockOpname,
            variant: mutation.variant,
            remarks: mutation.remarks,
          },
        });
        console.log(`  ✓ Created Scrap Mutation for date: ${mutation.date.toISOString().split('T')[0]}`);
      } else {
        console.log(`  → Scrap Mutation already exists for this date and scrap`);
      }
    }
    console.log('');

    // ==================== SEED CAPITAL GOODS MUTATIONS ====================
    console.log('🔄 Seeding Capital Goods Mutations...');
    const capitalMutationData = getCapitalGoodsMutationData();
    for (const mutation of capitalMutationData) {
      const existing = await prisma.capitalGoodsMutation.findFirst({
        where: {
          date: mutation.date,
          itemId: items[mutation.itemCode].id,
        },
      });
      if (!existing) {
        await prisma.capitalGoodsMutation.create({
          data: {
            date: mutation.date,
            itemId: items[mutation.itemCode].id,
            uomId: uoms[mutation.uomCode].id,
            beginning: mutation.beginning,
            incoming: mutation.incoming,
            outgoing: mutation.outgoing,
            adjustment: mutation.adjustment,
            ending: mutation.ending,
            stockOpname: mutation.stockOpname,
            variant: mutation.variant,
            remarks: mutation.remarks,
          },
        });
        console.log(`  ✓ Created Capital Goods Mutation for date: ${mutation.date.toISOString().split('T')[0]}`);
      } else {
        console.log(`  → Capital Goods Mutation already exists for this date and item`);
      }
    }
    console.log('');

    // ==================== SUMMARY ====================
    console.log('\n═══════════════════════════════════════════════');
    console.log('✅ DATABASE SEEDING COMPLETED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════\n');

    const counts = await Promise.all([
      prisma.uOM.count(),
      prisma.currency.count(),
      prisma.supplier.count(),
      prisma.customer.count(),
      prisma.user.count(),
      prisma.item.count(),
      prisma.scrapMaster.count(),
      prisma.scrapItem.count(),
      prisma.incomingDocument.count(),
      prisma.outgoingDocument.count(),
      prisma.rawMaterialMutation.count(),
      prisma.productionMutation.count(),
      prisma.wIPRecord.count(),
      prisma.scrapMutation.count(),
      prisma.capitalGoodsMutation.count(),
    ]);

    console.log('📊 Database Statistics:');
    console.log('─────────────────────────────────────────────');
    console.log(`  UOM                      : ${counts[0]} records`);
    console.log(`  Currency                 : ${counts[1]} records`);
    console.log(`  Supplier                 : ${counts[2]} records`);
    console.log(`  Customer                 : ${counts[3]} records`);
    console.log(`  User                     : ${counts[4]} records`);
    console.log(`  Item (All Types)         : ${counts[5]} records`);
    console.log(`  Scrap Master             : ${counts[6]} records`);
    console.log(`  Scrap Item               : ${counts[7]} records`);
    console.log(`  Incoming Document        : ${counts[8]} records`);
    console.log(`  Outgoing Document        : ${counts[9]} records`);
    console.log(`  Raw Material Mutation    : ${counts[10]} records`);
    console.log(`  Production Mutation      : ${counts[11]} records`);
    console.log(`  WIP Record               : ${counts[12]} records`);
    console.log(`  Scrap Mutation           : ${counts[13]} records`);
    console.log(`  Capital Goods Mutation   : ${counts[14]} records`);
    console.log('─────────────────────────────────────────────\n');

    console.log('👤 Test User Credentials:');
    console.log('─────────────────────────────────────────────');
    console.log('  Username: admin      | Password: admin123');
    console.log('  Username: operator   | Password: operator123');
    console.log('  Username: supervisor | Password: supervisor123');
    console.log('─────────────────────────────────────────────\n');

    console.log('📝 Notes:');
    console.log('  - Menu data should be seeded separately using: npm run seed:menu');
    console.log('  - All dates are relative to today for realistic data');
    console.log('  - Passwords are hashed with bcrypt (cost factor: 10)');
    console.log('  - The seeder is idempotent - safe to run multiple times');
    console.log('  - Existing data will not be duplicated\n');

  } catch (error) {
    console.error('\n❌ ERROR during seeding:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    console.log('🔌 Disconnecting from database...\n');
    await prisma.$disconnect();
  });
