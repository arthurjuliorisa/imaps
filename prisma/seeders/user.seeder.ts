import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function seedUsers() {
  console.log('👥 Seeding Users...');

  const users = [
    {
      username: 'superadmin',
      email: 'superadmin@imaps.co.id',
      password: await bcrypt.hash('superadmin123', 10),
      full_name: 'System Administrator',
      role: 'SUPER_ADMIN',
      company_code: null, // All companies access for SUPER_ADMIN
      is_active: true,
    },
    {
      username: 'admin_1310',
      email: 'admin@harmoni.co.id',
      password: await bcrypt.hash('admin123', 10),
      full_name: 'Administrator Harmoni',
      role: 'ADMIN',
      company_code: 1310, // Default company for admin UI access
      is_active: true,
    },
    {
      username: 'admin_1370',
      email: 'admin@pmi.co.id',
      password: await bcrypt.hash('admin123', 10),
      full_name: 'Administrator PMI',
      role: 'ADMIN',
      company_code: 1370, // Default company for admin UI access
      is_active: true,
    },
    {
      username: 'wms_integration',
      email: 'wms@harmoni.co.id',
      password: await bcrypt.hash('wms123', 10),
      full_name: 'WMS Integration User',
      role: 'API',
      company_code: 1310, // Default company for API access
      is_active: true,
    },
    {
      username: 'user_1310',
      email: 'user@harmoni.co.id',
      password: await bcrypt.hash('user123', 10),
      full_name: 'PT. Harmoni Cahaya Indonesia',
      role: 'USER',
      company_code: 1310,
      is_active: true,
    },
    {
      username: 'user_1370',
      email: 'user@pmi.co.id',
      password: await bcrypt.hash('user123', 10),
      full_name: 'PT. Polygroup Manufaktur Indonesia',
      role: 'USER',
      company_code: 1370,
      is_active: false,
    },
    {
      username: 'user_1380',
      email: 'user1380@sino.co.id',
      password: await bcrypt.hash('user123', 10),
      full_name: 'PT. Sino Berkat Indonesia',
      role: 'USER',
      company_code: 1380,
      is_active: false,
    },
    // Customs users per company
    {
      username: 'customs_1310',
      email: 'customs@harmoni.co.id',
      password: await bcrypt.hash('customs123', 10),
      full_name: 'Customs Officer - Harmoni (Company 1310)',
      role: 'CUSTOMS',
      company_code: 1310,
      is_active: true,
    },
    {
      username: 'customs_1370',
      email: 'customs@pmi.co.id',
      password: await bcrypt.hash('customs123', 10),
      full_name: 'Customs Officer - PMI (Company 1370)',
      role: 'CUSTOMS',
      company_code: 1370,
      is_active: true,
    },
    {
      username: 'customs_1380',
      email: 'customs@sbi.co.id',
      password: await bcrypt.hash('customs123', 10),
      full_name: 'Customs Officer - SBI (Company 1380)',
      role: 'CUSTOMS',
      company_code: 1380,
      is_active: true,
    },
  ];

  const createdUsers = [];
  for (const user of users) {
    const createdUser = await prisma.users.upsert({
      where: { username: user.username },
      update: {
        email: user.email,
        password: user.password,
        full_name: user.full_name,
        role: user.role,
        company_code: user.company_code,
        is_active: user.is_active,
      },
      create: user,
    });
    createdUsers.push(createdUser);
    console.log(`  ✓ Created/Updated User: ${user.email} (${user.role})`);
  }

  console.log(`Completed: ${createdUsers.length} users seeded\n`);
  return createdUsers;
}
