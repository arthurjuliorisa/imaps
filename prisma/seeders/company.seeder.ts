import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedCompanies() {
  console.log('🏢 Seeding Companies...');

  const companies = [
    // ACME and XYZ companies removed
  ];

  let createdCount = 0;
  for (const company of companies) {
    await prisma.companies.upsert({
      where: { company_code: company.company_code },
      update: {
        company_name: company.company_name,
        is_active: company.is_active,
      },
      create: company,
    });
    console.log(`  ✓ Created/Updated Company: ${company.company_code} - ${company.company_name}`);
    createdCount++;
  }

  console.log(`Completed: ${createdCount} companies seeded\n`);
}
