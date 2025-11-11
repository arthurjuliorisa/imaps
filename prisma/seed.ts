import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Create default admin user
  const hashedPassword = await hash('admin123', 10);

  // Delete existing admin user if exists
  await prisma.user.deleteMany({
    where: { email: 'admin@email.com' },
  });

  // Create new admin user
  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      email: 'admin@email.com',
      password: hashedPassword,
    },
  });

  console.log('Created admin user:', admin.email);

  // Create default UOMs
  const uoms = [
    { code: 'PCS', name: 'Pieces' },
    { code: 'KG', name: 'Kilogram' },
    { code: 'M', name: 'Meter' },
    { code: 'L', name: 'Liter' },
    { code: 'BOX', name: 'Box' },
  ];

  for (const uom of uoms) {
    await prisma.uOM.upsert({
      where: { code: uom.code },
      update: {},
      create: uom,
    });
  }

  console.log('Created UOMs');

  // Create default currencies
  const currencies = [
    { code: 'USD', name: 'US Dollar' },
    { code: 'IDR', name: 'Indonesian Rupiah' },
    { code: 'EUR', name: 'Euro' },
    { code: 'JPY', name: 'Japanese Yen' },
  ];

  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: {},
      create: currency,
    });
  }

  console.log('Created Currencies');

  // Create menu structure
  const menus = [
    { name: 'Dashboard', route: '/dashboard', order: 1 },
    { name: 'Master', route: null, order: 2 },
    { name: 'Customs Report', route: null, order: 3 },
    { name: 'Settings', route: null, order: 4 },
  ];

  for (const menu of menus) {
    await prisma.menu.upsert({
      where: { name: menu.name },
      update: {},
      create: menu,
    });
  }

  console.log('Created Menu structure');

  console.log('Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
