import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedCompanies() {
  console.log('📦 Seeding companies...');

  const companies = await Promise.all([
    prisma.companies.upsert({
      where: { code: 1370 },
      update: {},
      create: {
        code: 1370,
        name: 'PT. Polygroup Manufaktur Indonesia',
        status: 'ACTIVE',
      },
    }),
    prisma.companies.upsert({
      where: { code: 1310 },
      update: {},
      create: {
        code: 1310,
        name: 'PT. Harmoni Cahaya Indonesia',
        status: 'ACTIVE',
      },
    }),
    prisma.companies.upsert({
      where: { code: 1380 },
      update: {},
      create: {
        code: 1380,
        name: 'PT. Sino Berkat Indonesia',
        status: 'ACTIVE',
      },
    }),
  ]);

  console.log(`✅ Created ${companies.length} companies`);
  return companies;
}
