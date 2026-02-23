import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedCompanies() {
  console.log('📦 Seeding companies...');

  const companies = await Promise.all([
    prisma.companies.upsert({
      where: { code: 1370 },
      update: { company_type: 'SEZ' },
      create: {
        code: 1370,
        name: 'PT. Polygroup Manufaktur Indonesia',
        company_type: 'SEZ',
        status: 'ACTIVE',
      },
    }),
    prisma.companies.upsert({
      where: { code: 1310 },
      update: { company_type: 'BZ' },
      create: {
        code: 1310,
        name: 'PT. Harmoni Cahaya Indonesia',
        company_type: 'BZ',
        status: 'ACTIVE',
      },
    }),
    prisma.companies.upsert({
      where: { code: 1380 },
      update: { company_type: 'BZ' },
      create: {
        code: 1380,
        name: 'PT. Sino Berkat Indonesia',
        company_type: 'BZ',
        status: 'ACTIVE',
      },
    }),
  ]);

  console.log(`✅ Created ${companies.length} companies`);
  return companies;
}
