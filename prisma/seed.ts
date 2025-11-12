import { PrismaClient, ItemType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Helper function to generate dates in the past
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

// Helper function to generate random dates within a range
function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

async function main() {
  console.log('🌱 Starting database seeding...\n');

  try {
    // ==================== SEED UOM ====================
    console.log('📦 Seeding UOM (Unit of Measure)...');
    const uomData = [
      { code: 'PCS', name: 'Pieces' },
      { code: 'KG', name: 'Kilogram' },
      { code: 'M', name: 'Meter' },
      { code: 'L', name: 'Liter' },
      { code: 'BOX', name: 'Box' },
      { code: 'CARTON', name: 'Carton' },
      { code: 'SET', name: 'Set' },
      { code: 'UNIT', name: 'Unit' },
      { code: 'ROLL', name: 'Roll' },
      { code: 'SHEET', name: 'Sheet' },
      { code: 'PACK', name: 'Pack' },
      { code: 'TON', name: 'Ton' },
    ];

    const uoms: Record<string, any> = {};
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
    const currencyData = [
      { code: 'IDR', name: 'Indonesian Rupiah' },
      { code: 'USD', name: 'United States Dollar' },
      { code: 'EUR', name: 'Euro' },
      { code: 'JPY', name: 'Japanese Yen' },
      { code: 'SGD', name: 'Singapore Dollar' },
      { code: 'CNY', name: 'Chinese Yuan' },
      { code: 'MYR', name: 'Malaysian Ringgit' },
    ];

    const currencies: Record<string, any> = {};
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
    const supplierData = [
      {
        code: 'SUP-001',
        name: 'PT. Mitra Elektronik Indonesia',
        address: 'Jl. Industri Raya No. 45, Kawasan Industri MM2100, Bekasi, Jawa Barat',
      },
      {
        code: 'SUP-002',
        name: 'PT. Global Components Asia',
        address: 'Jl. Ganesha No. 88, Bandung, Jawa Barat 40132',
      },
      {
        code: 'SUP-003',
        name: 'CV. Cahaya Plastic Industry',
        address: 'Jl. Raya Narogong KM 18, Cileungsi, Bogor, Jawa Barat',
      },
      {
        code: 'SUP-004',
        name: 'PT. Steel Master Indonesia',
        address: 'Kawasan Industri JIIPE, Manyar, Gresik, Jawa Timur 61151',
      },
      {
        code: 'SUP-005',
        name: 'PT. Asia Pacific Electronics',
        address: 'Jl. Gatot Subroto Kav 32-34, Jakarta Selatan 12950',
      },
      {
        code: 'SUP-006',
        name: 'PT. Samsung Components Indonesia',
        address: 'Jl. Jababeka Raya Blok F 29-33, Cikarang, Bekasi, Jawa Barat',
      },
      {
        code: 'SUP-007',
        name: 'CV. Indo Chemical Supplier',
        address: 'Jl. Ahmad Yani No. 123, Surabaya, Jawa Timur 60234',
      },
      {
        code: 'SUP-008',
        name: 'PT. Precision Metal Works',
        address: 'Kawasan Industri Deltamas, Cikarang Pusat, Bekasi, Jawa Barat',
      },
    ];

    const suppliers: Record<string, any> = {};
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
    const customerData = [
      {
        code: 'CUST-001',
        name: 'PT. Telkom Indonesia',
        address: 'Jl. Japati No. 1, Bandung, Jawa Barat 40133',
      },
      {
        code: 'CUST-002',
        name: 'PT. Astra International',
        address: 'Jl. Gaya Motor Raya No. 8, Sunter II, Jakarta Utara 14330',
      },
      {
        code: 'CUST-003',
        name: 'PT. Unilever Indonesia',
        address: 'Jl. BSD Boulevard Barat, BSD City, Tangerang Selatan',
      },
      {
        code: 'CUST-004',
        name: 'PT. Samsung Electronics Indonesia',
        address: 'Cikarang Industrial Estate, Jl. Jababeka Raya Blok F 29-33, Bekasi',
      },
      {
        code: 'CUST-005',
        name: 'PT. Pertamina (Persero)',
        address: 'Jl. Medan Merdeka Timur No. 1A, Jakarta Pusat 10110',
      },
      {
        code: 'CUST-006',
        name: 'PT. LG Electronics Indonesia',
        address: 'Jl. Lkr. Luar Barat Kav. 35-36, Jakarta Barat 11720',
      },
      {
        code: 'CUST-007',
        name: 'PT. Panasonic Gobel Indonesia',
        address: 'Jl. Dewi Sartika 14, Cawang, Jakarta Timur 13630',
      },
      {
        code: 'CUST-008',
        name: 'PT. Sharp Electronics Indonesia',
        address: 'Jl. Siliwangi Kav 1, Karawang, Jawa Barat 41361',
      },
      {
        code: 'CUST-009',
        name: 'PT. Toyota Astra Motor',
        address: 'Jl. Gaya Motor I No. 1, Sunter II, Jakarta Utara 14330',
      },
      {
        code: 'CUST-010',
        name: 'PT. Indofood Sukses Makmur',
        address: 'Jl. Jenderal Sudirman Kav 76-78, Jakarta Selatan 12910',
      },
    ];

    const customers: Record<string, any> = {};
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
    const userData = [
      {
        username: 'admin',
        email: 'admin@imaps.com',
        password: await bcrypt.hash('admin123', 10),
      },
      {
        username: 'operator',
        email: 'operator@imaps.com',
        password: await bcrypt.hash('operator123', 10),
      },
      {
        username: 'supervisor',
        email: 'supervisor@imaps.com',
        password: await bcrypt.hash('supervisor123', 10),
      },
    ];

    const users: Record<string, any> = {};
    for (const user of userData) {
      const existing = await prisma.user.findUnique({ where: { username: user.username } });
      if (!existing) {
        const created = await prisma.user.create({ data: user });
        users[user.username] = created;
        console.log(`  ✓ Created User: ${user.username} (${user.email})`);
        console.log(`    Password: ${user.username}123`);
      } else {
        users[user.username] = existing;
        console.log(`  → User already exists: ${user.username}`);
      }
    }
    console.log('');

    // ==================== SEED ITEMS - RAW MATERIALS ====================
    console.log('📦 Seeding Items - Raw Materials...');
    const rawMaterialData = [
      { code: 'RM-001', name: 'Steel Sheet Cold Rolled 0.8mm', type: ItemType.RM, uomId: uoms['SHEET'].id },
      { code: 'RM-002', name: 'Aluminum Plate 5mm', type: ItemType.RM, uomId: uoms['SHEET'].id },
      { code: 'RM-003', name: 'ABS Plastic Pellets Natural', type: ItemType.RM, uomId: uoms['KG'].id },
      { code: 'RM-004', name: 'Polycarbonate Granules Transparent', type: ItemType.RM, uomId: uoms['KG'].id },
      { code: 'RM-005', name: 'Copper Wire 1.5mm Diameter', type: ItemType.RM, uomId: uoms['M'].id },
      { code: 'RM-006', name: 'PCB Board FR-4 Double Layer', type: ItemType.RM, uomId: uoms['PCS'].id },
      { code: 'RM-007', name: 'LCD Display 7 inch TFT', type: ItemType.RM, uomId: uoms['PCS'].id },
      { code: 'RM-008', name: 'Lithium Battery Cell 18650', type: ItemType.RM, uomId: uoms['PCS'].id },
      { code: 'RM-009', name: 'Resistor Set 100pcs Various', type: ItemType.RM, uomId: uoms['SET'].id },
      { code: 'RM-010', name: 'Capacitor Electrolytic 1000uF', type: ItemType.RM, uomId: uoms['PCS'].id },
      { code: 'RM-011', name: 'Microcontroller ARM STM32', type: ItemType.RM, uomId: uoms['PCS'].id },
      { code: 'RM-012', name: 'Stainless Steel Screw M4', type: ItemType.RM, uomId: uoms['PCS'].id },
      { code: 'RM-013', name: 'Silicone Adhesive Tube 300ml', type: ItemType.RM, uomId: uoms['UNIT'].id },
      { code: 'RM-014', name: 'Packaging Foam Roll 2mm', type: ItemType.RM, uomId: uoms['ROLL'].id },
      { code: 'RM-015', name: 'Cardboard Box Medium Size', type: ItemType.RM, uomId: uoms['PCS'].id },
    ];

    const items: Record<string, any> = {};
    for (const item of rawMaterialData) {
      const existing = await prisma.item.findUnique({ where: { code: item.code } });
      if (!existing) {
        const created = await prisma.item.create({ data: item });
        items[item.code] = created;
        console.log(`  ✓ Created Item: ${item.code} - ${item.name}`);
      } else {
        items[item.code] = existing;
        console.log(`  → Item already exists: ${item.code}`);
      }
    }
    console.log('');

    // ==================== SEED ITEMS - FINISHED GOODS ====================
    console.log('📦 Seeding Items - Finished Goods...');
    const finishedGoodsData = [
      { code: 'FG-001', name: 'Smartphone Model X1 Pro 128GB', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-002', name: 'Laptop 14inch Core i5 8GB RAM', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-003', name: 'Smart TV LED 43 inch 4K', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-004', name: 'Wireless Router Dual Band AC1200', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-005', name: 'Bluetooth Speaker Portable 20W', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-006', name: 'Power Bank 20000mAh Fast Charge', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-007', name: 'Smartwatch GPS Fitness Tracker', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-008', name: 'Wireless Earbuds True Wireless', type: ItemType.FG, uomId: uoms['SET'].id },
      { code: 'FG-009', name: 'LED Monitor 24inch Full HD', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-010', name: 'Mechanical Keyboard RGB Gaming', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-011', name: 'Wireless Mouse Ergonomic Design', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-012', name: 'USB Hub 7 Port Powered', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-013', name: 'External SSD 1TB USB 3.2', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-014', name: 'Webcam Full HD 1080p 60fps', type: ItemType.FG, uomId: uoms['UNIT'].id },
      { code: 'FG-015', name: 'Gaming Headset Surround Sound', type: ItemType.FG, uomId: uoms['UNIT'].id },
    ];

    for (const item of finishedGoodsData) {
      const existing = await prisma.item.findUnique({ where: { code: item.code } });
      if (!existing) {
        const created = await prisma.item.create({ data: item });
        items[item.code] = created;
        console.log(`  ✓ Created Item: ${item.code} - ${item.name}`);
      } else {
        items[item.code] = existing;
        console.log(`  → Item already exists: ${item.code}`);
      }
    }
    console.log('');

    // ==================== SEED ITEMS - SEMI-FINISHED GOODS ====================
    console.log('📦 Seeding Items - Semi-Finished Goods...');
    const semiFinishedData = [
      { code: 'SFG-001', name: 'Assembled PCB Main Board (unprogrammed)', type: ItemType.SFG, uomId: uoms['PCS'].id },
      { code: 'SFG-002', name: 'Metal Chassis Stamped (unpainted)', type: ItemType.SFG, uomId: uoms['PCS'].id },
      { code: 'SFG-003', name: 'Plastic Housing Molded (unfinished)', type: ItemType.SFG, uomId: uoms['PCS'].id },
      { code: 'SFG-004', name: 'LCD Assembly with Touch Panel', type: ItemType.SFG, uomId: uoms['PCS'].id },
      { code: 'SFG-005', name: 'Battery Pack Assembled (untested)', type: ItemType.SFG, uomId: uoms['PCS'].id },
      { code: 'SFG-006', name: 'Speaker Module Assembled', type: ItemType.SFG, uomId: uoms['PCS'].id },
      { code: 'SFG-007', name: 'Camera Module with Lens', type: ItemType.SFG, uomId: uoms['PCS'].id },
      { code: 'SFG-008', name: 'Charging Port Assembly', type: ItemType.SFG, uomId: uoms['PCS'].id },
      { code: 'SFG-009', name: 'Antenna Component Assembled', type: ItemType.SFG, uomId: uoms['PCS'].id },
      { code: 'SFG-010', name: 'Button Panel Pre-assembled', type: ItemType.SFG, uomId: uoms['SET'].id },
    ];

    for (const item of semiFinishedData) {
      const existing = await prisma.item.findUnique({ where: { code: item.code } });
      if (!existing) {
        const created = await prisma.item.create({ data: item });
        items[item.code] = created;
        console.log(`  ✓ Created Item: ${item.code} - ${item.name}`);
      } else {
        items[item.code] = existing;
        console.log(`  → Item already exists: ${item.code}`);
      }
    }
    console.log('');

    // ==================== SEED ITEMS - CAPITAL GOODS ====================
    console.log('📦 Seeding Items - Capital Goods...');
    const capitalGoodsData = [
      { code: 'CAP-001', name: 'SMT Pick and Place Machine', type: ItemType.CAPITAL, uomId: uoms['UNIT'].id },
      { code: 'CAP-002', name: 'Reflow Oven 8 Zone', type: ItemType.CAPITAL, uomId: uoms['UNIT'].id },
      { code: 'CAP-003', name: 'Injection Molding Machine 150T', type: ItemType.CAPITAL, uomId: uoms['UNIT'].id },
      { code: 'CAP-004', name: 'CNC Machining Center 3-Axis', type: ItemType.CAPITAL, uomId: uoms['UNIT'].id },
      { code: 'CAP-005', name: 'Industrial Conveyor Belt System', type: ItemType.CAPITAL, uomId: uoms['SET'].id },
      { code: 'CAP-006', name: 'Automated Testing Equipment', type: ItemType.CAPITAL, uomId: uoms['UNIT'].id },
      { code: 'CAP-007', name: 'Laser Marking Machine', type: ItemType.CAPITAL, uomId: uoms['UNIT'].id },
    ];

    for (const item of capitalGoodsData) {
      const existing = await prisma.item.findUnique({ where: { code: item.code } });
      if (!existing) {
        const created = await prisma.item.create({ data: item });
        items[item.code] = created;
        console.log(`  ✓ Created Item: ${item.code} - ${item.name}`);
      } else {
        items[item.code] = existing;
        console.log(`  → Item already exists: ${item.code}`);
      }
    }
    console.log('');

    // ==================== SEED ITEMS - SCRAP ====================
    console.log('📦 Seeding Items - Scrap...');
    const scrapItemsData = [
      { code: 'SCR-001', name: 'Defective PCB Board', type: ItemType.SCRAP, uomId: uoms['PCS'].id },
      { code: 'SCR-002', name: 'Damaged LCD Screen', type: ItemType.SCRAP, uomId: uoms['PCS'].id },
      { code: 'SCR-003', name: 'Rejected Plastic Housing', type: ItemType.SCRAP, uomId: uoms['PCS'].id },
      { code: 'SCR-004', name: 'Metal Scraps Mixed', type: ItemType.SCRAP, uomId: uoms['KG'].id },
      { code: 'SCR-005', name: 'Electronic Component Waste', type: ItemType.SCRAP, uomId: uoms['KG'].id },
      { code: 'SCR-006', name: 'Packaging Material Waste', type: ItemType.SCRAP, uomId: uoms['KG'].id },
      { code: 'SCR-007', name: 'Failed Battery Pack', type: ItemType.SCRAP, uomId: uoms['PCS'].id },
      { code: 'SCR-008', name: 'Copper Wire Scraps', type: ItemType.SCRAP, uomId: uoms['KG'].id },
      { code: 'SCR-009', name: 'Defective Camera Module', type: ItemType.SCRAP, uomId: uoms['PCS'].id },
      { code: 'SCR-010', name: 'Broken Glass Panel', type: ItemType.SCRAP, uomId: uoms['KG'].id },
    ];

    for (const item of scrapItemsData) {
      const existing = await prisma.item.findUnique({ where: { code: item.code } });
      if (!existing) {
        const created = await prisma.item.create({ data: item });
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
    const scrapMasterData = [
      {
        code: 'SCRAP-2024-001',
        name: 'Electronic Waste Collection Q1 2024',
        description: 'Collection of defective electronic components from Q1 2024 production',
        items: [
          { itemCode: 'SCR-001', quantity: 150, remarks: 'Manufacturing defects' },
          { itemCode: 'SCR-002', quantity: 45, remarks: 'Screen burn-in issues' },
          { itemCode: 'SCR-005', quantity: 25.5, remarks: 'Failed quality testing' },
        ],
      },
      {
        code: 'SCRAP-2024-002',
        name: 'Plastic & Housing Waste Q1 2024',
        description: 'Rejected plastic housings and molding defects',
        items: [
          { itemCode: 'SCR-003', quantity: 280, remarks: 'Molding defects and surface issues' },
          { itemCode: 'SCR-006', quantity: 150.75, remarks: 'Packaging material scraps' },
        ],
      },
      {
        code: 'SCRAP-2024-003',
        name: 'Metal Waste Collection Q1 2024',
        description: 'Metal scraps and rejected metal components',
        items: [
          { itemCode: 'SCR-004', quantity: 345.8, remarks: 'Stamping and cutting waste' },
          { itemCode: 'SCR-008', quantity: 125.3, remarks: 'Copper wire trimming waste' },
          { itemCode: 'SCR-010', quantity: 85.6, remarks: 'Broken glass panels' },
        ],
      },
      {
        code: 'SCRAP-2024-004',
        name: 'Battery & Power Components Waste',
        description: 'Failed battery packs and power-related components',
        items: [
          { itemCode: 'SCR-007', quantity: 65, remarks: 'Failed capacity testing' },
          { itemCode: 'SCR-005', quantity: 18.2, remarks: 'Charging circuit failures' },
        ],
      },
      {
        code: 'SCRAP-2024-005',
        name: 'Optical Components Waste',
        description: 'Defective camera modules and optical components',
        items: [
          { itemCode: 'SCR-009', quantity: 95, remarks: 'Focus mechanism failures' },
          { itemCode: 'SCR-002', quantity: 38, remarks: 'Display backlight issues' },
        ],
      },
    ];

    const scrapMasters: Record<string, any> = {};
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
    const incomingDocData = [
      {
        docCode: 'BC-23',
        registerNumber: 'REG-IN-2024-001',
        registerDate: daysAgo(60),
        docNumber: 'BC23-001/2024',
        docDate: daysAgo(62),
        shipperId: suppliers['SUP-001'].id,
        itemId: items['RM-006'].id,
        uomId: uoms['PCS'].id,
        quantity: 5000,
        currencyId: currencies['USD'].id,
        amount: 125000,
      },
      {
        docCode: 'BC-23',
        registerNumber: 'REG-IN-2024-002',
        registerDate: daysAgo(55),
        docNumber: 'BC23-002/2024',
        docDate: daysAgo(57),
        shipperId: suppliers['SUP-003'].id,
        itemId: items['RM-003'].id,
        uomId: uoms['KG'].id,
        quantity: 15000,
        currencyId: currencies['USD'].id,
        amount: 45000,
      },
      {
        docCode: 'BC-23',
        registerNumber: 'REG-IN-2024-003',
        registerDate: daysAgo(50),
        docNumber: 'BC23-003/2024',
        docDate: daysAgo(52),
        shipperId: suppliers['SUP-002'].id,
        itemId: items['RM-007'].id,
        uomId: uoms['PCS'].id,
        quantity: 2000,
        currencyId: currencies['USD'].id,
        amount: 180000,
      },
      {
        docCode: 'BC-23',
        registerNumber: 'REG-IN-2024-004',
        registerDate: daysAgo(45),
        docNumber: 'BC23-004/2024',
        docDate: daysAgo(47),
        shipperId: suppliers['SUP-004'].id,
        itemId: items['RM-001'].id,
        uomId: uoms['SHEET'].id,
        quantity: 8000,
        currencyId: currencies['USD'].id,
        amount: 96000,
      },
      {
        docCode: 'BC-23',
        registerNumber: 'REG-IN-2024-005',
        registerDate: daysAgo(40),
        docNumber: 'BC23-005/2024',
        docDate: daysAgo(42),
        shipperId: suppliers['SUP-005'].id,
        itemId: items['RM-008'].id,
        uomId: uoms['PCS'].id,
        quantity: 10000,
        currencyId: currencies['USD'].id,
        amount: 75000,
      },
      {
        docCode: 'BC-23',
        registerNumber: 'REG-IN-2024-006',
        registerDate: daysAgo(35),
        docNumber: 'BC23-006/2024',
        docDate: daysAgo(37),
        shipperId: suppliers['SUP-006'].id,
        itemId: items['RM-011'].id,
        uomId: uoms['PCS'].id,
        quantity: 3000,
        currencyId: currencies['USD'].id,
        amount: 135000,
      },
      {
        docCode: 'BC-23',
        registerNumber: 'REG-IN-2024-007',
        registerDate: daysAgo(30),
        docNumber: 'BC23-007/2024',
        docDate: daysAgo(32),
        shipperId: suppliers['SUP-007'].id,
        itemId: items['RM-013'].id,
        uomId: uoms['UNIT'].id,
        quantity: 500,
        currencyId: currencies['USD'].id,
        amount: 3750,
      },
      {
        docCode: 'BC-23',
        registerNumber: 'REG-IN-2024-008',
        registerDate: daysAgo(25),
        docNumber: 'BC23-008/2024',
        docDate: daysAgo(27),
        shipperId: suppliers['SUP-008'].id,
        itemId: items['RM-002'].id,
        uomId: uoms['SHEET'].id,
        quantity: 5000,
        currencyId: currencies['USD'].id,
        amount: 75000,
      },
      {
        docCode: 'BC-23',
        registerNumber: 'REG-IN-2024-009',
        registerDate: daysAgo(20),
        docNumber: 'BC23-009/2024',
        docDate: daysAgo(22),
        shipperId: suppliers['SUP-001'].id,
        itemId: items['RM-015'].id,
        uomId: uoms['PCS'].id,
        quantity: 12000,
        currencyId: currencies['USD'].id,
        amount: 24000,
      },
      {
        docCode: 'BC-23',
        registerNumber: 'REG-IN-2024-010',
        registerDate: daysAgo(15),
        docNumber: 'BC23-010/2024',
        docDate: daysAgo(17),
        shipperId: suppliers['SUP-002'].id,
        itemId: items['RM-005'].id,
        uomId: uoms['M'].id,
        quantity: 50000,
        currencyId: currencies['USD'].id,
        amount: 35000,
      },
    ];

    for (const doc of incomingDocData) {
      const existing = await prisma.incomingDocument.findFirst({
        where: { registerNumber: doc.registerNumber },
      });
      if (!existing) {
        await prisma.incomingDocument.create({ data: doc });
        console.log(`  ✓ Created Incoming Doc: ${doc.registerNumber} - ${doc.docNumber}`);
      } else {
        console.log(`  → Incoming Doc already exists: ${doc.registerNumber}`);
      }
    }
    console.log('');

    // ==================== SEED OUTGOING DOCUMENTS ====================
    console.log('📤 Seeding Outgoing Documents...');
    const outgoingDocData = [
      {
        docCode: 'BC-30',
        registerNumber: 'REG-OUT-2024-001',
        registerDate: daysAgo(30),
        docNumber: 'BC30-001/2024',
        docDate: daysAgo(32),
        recipientId: customers['CUST-001'].id,
        itemId: items['FG-001'].id,
        uomId: uoms['UNIT'].id,
        quantity: 500,
        currencyId: currencies['USD'].id,
        amount: 350000,
      },
      {
        docCode: 'BC-30',
        registerNumber: 'REG-OUT-2024-002',
        registerDate: daysAgo(28),
        docNumber: 'BC30-002/2024',
        docDate: daysAgo(30),
        recipientId: customers['CUST-002'].id,
        itemId: items['FG-002'].id,
        uomId: uoms['UNIT'].id,
        quantity: 300,
        currencyId: currencies['USD'].id,
        amount: 270000,
      },
      {
        docCode: 'BC-30',
        registerNumber: 'REG-OUT-2024-003',
        registerDate: daysAgo(25),
        docNumber: 'BC30-003/2024',
        docDate: daysAgo(27),
        recipientId: customers['CUST-003'].id,
        itemId: items['FG-003'].id,
        uomId: uoms['UNIT'].id,
        quantity: 200,
        currencyId: currencies['USD'].id,
        amount: 120000,
      },
      {
        docCode: 'BC-30',
        registerNumber: 'REG-OUT-2024-004',
        registerDate: daysAgo(22),
        docNumber: 'BC30-004/2024',
        docDate: daysAgo(24),
        recipientId: customers['CUST-004'].id,
        itemId: items['FG-005'].id,
        uomId: uoms['UNIT'].id,
        quantity: 1000,
        currencyId: currencies['USD'].id,
        amount: 65000,
      },
      {
        docCode: 'BC-30',
        registerNumber: 'REG-OUT-2024-005',
        registerDate: daysAgo(20),
        docNumber: 'BC30-005/2024',
        docDate: daysAgo(22),
        recipientId: customers['CUST-005'].id,
        itemId: items['FG-004'].id,
        uomId: uoms['UNIT'].id,
        quantity: 800,
        currencyId: currencies['USD'].id,
        amount: 64000,
      },
      {
        docCode: 'BC-30',
        registerNumber: 'REG-OUT-2024-006',
        registerDate: daysAgo(18),
        docNumber: 'BC30-006/2024',
        docDate: daysAgo(20),
        recipientId: customers['CUST-006'].id,
        itemId: items['FG-006'].id,
        uomId: uoms['UNIT'].id,
        quantity: 1500,
        currencyId: currencies['USD'].id,
        amount: 67500,
      },
      {
        docCode: 'BC-30',
        registerNumber: 'REG-OUT-2024-007',
        registerDate: daysAgo(15),
        docNumber: 'BC30-007/2024',
        docDate: daysAgo(17),
        recipientId: customers['CUST-007'].id,
        itemId: items['FG-009'].id,
        uomId: uoms['UNIT'].id,
        quantity: 600,
        currencyId: currencies['USD'].id,
        amount: 96000,
      },
      {
        docCode: 'BC-30',
        registerNumber: 'REG-OUT-2024-008',
        registerDate: daysAgo(12),
        docNumber: 'BC30-008/2024',
        docDate: daysAgo(14),
        recipientId: customers['CUST-008'].id,
        itemId: items['FG-010'].id,
        uomId: uoms['UNIT'].id,
        quantity: 750,
        currencyId: currencies['USD'].id,
        amount: 82500,
      },
      {
        docCode: 'BC-30',
        registerNumber: 'REG-OUT-2024-009',
        registerDate: daysAgo(10),
        docNumber: 'BC30-009/2024',
        docDate: daysAgo(12),
        recipientId: customers['CUST-009'].id,
        itemId: items['FG-007'].id,
        uomId: uoms['UNIT'].id,
        quantity: 400,
        currencyId: currencies['USD'].id,
        amount: 80000,
      },
      {
        docCode: 'BC-30',
        registerNumber: 'REG-OUT-2024-010',
        registerDate: daysAgo(8),
        docNumber: 'BC30-010/2024',
        docDate: daysAgo(10),
        recipientId: customers['CUST-010'].id,
        itemId: items['FG-013'].id,
        uomId: uoms['UNIT'].id,
        quantity: 900,
        currencyId: currencies['USD'].id,
        amount: 135000,
      },
    ];

    for (const doc of outgoingDocData) {
      const existing = await prisma.outgoingDocument.findFirst({
        where: { registerNumber: doc.registerNumber },
      });
      if (!existing) {
        await prisma.outgoingDocument.create({ data: doc });
        console.log(`  ✓ Created Outgoing Doc: ${doc.registerNumber} - ${doc.docNumber}`);
      } else {
        console.log(`  → Outgoing Doc already exists: ${doc.registerNumber}`);
      }
    }
    console.log('');

    // ==================== SEED RAW MATERIAL MUTATIONS ====================
    console.log('🔄 Seeding Raw Material Mutations...');
    const rmMutationData = [
      {
        date: daysAgo(30),
        itemId: items['RM-006'].id,
        uomId: uoms['PCS'].id,
        beginning: 1000,
        incoming: 5000,
        outgoing: 3500,
        adjustment: 0,
        ending: 2500,
        stockOpname: 2500,
        variant: 0,
        remarks: 'Monthly stock movement',
      },
      {
        date: daysAgo(30),
        itemId: items['RM-003'].id,
        uomId: uoms['KG'].id,
        beginning: 5000,
        incoming: 15000,
        outgoing: 12000,
        adjustment: 0,
        ending: 8000,
        stockOpname: 8000,
        variant: 0,
        remarks: 'Monthly stock movement',
      },
      {
        date: daysAgo(30),
        itemId: items['RM-008'].id,
        uomId: uoms['PCS'].id,
        beginning: 2000,
        incoming: 10000,
        outgoing: 8500,
        adjustment: -50,
        ending: 3450,
        stockOpname: 3450,
        variant: 0,
        remarks: 'Minor adjustment for damaged items',
      },
    ];

    for (const mutation of rmMutationData) {
      const existing = await prisma.rawMaterialMutation.findFirst({
        where: {
          date: mutation.date,
          itemId: mutation.itemId,
        },
      });
      if (!existing) {
        await prisma.rawMaterialMutation.create({ data: mutation });
        console.log(`  ✓ Created RM Mutation for date: ${mutation.date.toISOString().split('T')[0]}`);
      } else {
        console.log(`  → RM Mutation already exists for this date and item`);
      }
    }
    console.log('');

    // ==================== SEED PRODUCTION MUTATIONS ====================
    console.log('🔄 Seeding Production Mutations...');
    const prodMutationData = [
      {
        date: daysAgo(25),
        itemId: items['FG-001'].id,
        uomId: uoms['UNIT'].id,
        beginning: 200,
        incoming: 800,
        outgoing: 500,
        adjustment: 0,
        ending: 500,
        stockOpname: 500,
        variant: 0,
        remarks: 'Regular production cycle',
      },
      {
        date: daysAgo(25),
        itemId: items['FG-002'].id,
        uomId: uoms['UNIT'].id,
        beginning: 150,
        incoming: 500,
        outgoing: 300,
        adjustment: 0,
        ending: 350,
        stockOpname: 350,
        variant: 0,
        remarks: 'Regular production cycle',
      },
      {
        date: daysAgo(25),
        itemId: items['FG-005'].id,
        uomId: uoms['UNIT'].id,
        beginning: 500,
        incoming: 2000,
        outgoing: 1000,
        adjustment: -10,
        ending: 1490,
        stockOpname: 1490,
        variant: 0,
        remarks: 'Small adjustment for QC fails',
      },
    ];

    for (const mutation of prodMutationData) {
      const existing = await prisma.productionMutation.findFirst({
        where: {
          date: mutation.date,
          itemId: mutation.itemId,
        },
      });
      if (!existing) {
        await prisma.productionMutation.create({ data: mutation });
        console.log(`  ✓ Created Production Mutation for date: ${mutation.date.toISOString().split('T')[0]}`);
      } else {
        console.log(`  → Production Mutation already exists for this date and item`);
      }
    }
    console.log('');

    // ==================== SEED WIP RECORDS ====================
    console.log('⏳ Seeding WIP Records...');
    const wipData = [
      {
        date: daysAgo(20),
        itemId: items['SFG-001'].id,
        uomId: uoms['PCS'].id,
        quantity: 1500,
        remarks: 'PCB boards in assembly queue',
      },
      {
        date: daysAgo(15),
        itemId: items['SFG-004'].id,
        uomId: uoms['PCS'].id,
        quantity: 800,
        remarks: 'LCD assemblies awaiting final testing',
      },
      {
        date: daysAgo(10),
        itemId: items['SFG-005'].id,
        uomId: uoms['PCS'].id,
        quantity: 1200,
        remarks: 'Battery packs in testing phase',
      },
      {
        date: daysAgo(5),
        itemId: items['SFG-002'].id,
        uomId: uoms['PCS'].id,
        quantity: 600,
        remarks: 'Metal chassis awaiting painting',
      },
    ];

    for (const wip of wipData) {
      const existing = await prisma.wIPRecord.findUnique({
        where: { date: wip.date },
      });
      if (!existing) {
        await prisma.wIPRecord.create({ data: wip });
        console.log(`  ✓ Created WIP Record for date: ${wip.date.toISOString().split('T')[0]}`);
      } else {
        console.log(`  → WIP Record already exists for date: ${wip.date.toISOString().split('T')[0]}`);
      }
    }
    console.log('');

    // ==================== SEED SCRAP MUTATIONS ====================
    console.log('🔄 Seeding Scrap Mutations...');
    const scrapMutationData = [
      {
        date: daysAgo(20),
        scrapId: scrapMasters['SCRAP-2024-001'].id,
        uomId: uoms['KG'].id,
        beginning: 0,
        incoming: 50.5,
        outgoing: 0,
        adjustment: 0,
        ending: 50.5,
        stockOpname: 50.5,
        variant: 0,
        remarks: 'Electronic waste accumulation',
      },
      {
        date: daysAgo(20),
        scrapId: scrapMasters['SCRAP-2024-003'].id,
        uomId: uoms['KG'].id,
        beginning: 100,
        incoming: 245.8,
        outgoing: 200,
        adjustment: 0,
        ending: 145.8,
        stockOpname: 145.8,
        variant: 0,
        remarks: 'Metal scrap disposal cycle',
      },
    ];

    for (const mutation of scrapMutationData) {
      const existing = await prisma.scrapMutation.findFirst({
        where: {
          date: mutation.date,
          scrapId: mutation.scrapId,
        },
      });
      if (!existing) {
        await prisma.scrapMutation.create({ data: mutation });
        console.log(`  ✓ Created Scrap Mutation for date: ${mutation.date.toISOString().split('T')[0]}`);
      } else {
        console.log(`  → Scrap Mutation already exists for this date and scrap`);
      }
    }
    console.log('');

    // ==================== SEED CAPITAL GOODS MUTATIONS ====================
    console.log('🔄 Seeding Capital Goods Mutations...');
    const capitalMutationData = [
      {
        date: daysAgo(60),
        itemId: items['CAP-001'].id,
        uomId: uoms['UNIT'].id,
        beginning: 0,
        incoming: 2,
        outgoing: 0,
        adjustment: 0,
        ending: 2,
        stockOpname: 2,
        variant: 0,
        remarks: 'New equipment acquisition',
      },
      {
        date: daysAgo(60),
        itemId: items['CAP-003'].id,
        uomId: uoms['UNIT'].id,
        beginning: 1,
        incoming: 1,
        outgoing: 0,
        adjustment: 0,
        ending: 2,
        stockOpname: 2,
        variant: 0,
        remarks: 'Additional molding machine',
      },
    ];

    for (const mutation of capitalMutationData) {
      const existing = await prisma.capitalGoodsMutation.findFirst({
        where: {
          date: mutation.date,
          itemId: mutation.itemId,
        },
      });
      if (!existing) {
        await prisma.capitalGoodsMutation.create({ data: mutation });
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
    console.log(`    - Raw Materials        : ${await prisma.item.count({ where: { type: ItemType.RM } })}`);
    console.log(`    - Finished Goods       : ${await prisma.item.count({ where: { type: ItemType.FG } })}`);
    console.log(`    - Semi-Finished Goods  : ${await prisma.item.count({ where: { type: ItemType.SFG } })}`);
    console.log(`    - Capital Goods        : ${await prisma.item.count({ where: { type: ItemType.CAPITAL } })}`);
    console.log(`    - Scrap                : ${await prisma.item.count({ where: { type: ItemType.SCRAP } })}`);
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
