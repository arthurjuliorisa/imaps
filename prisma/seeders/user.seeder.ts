import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function seedUsers() {
  console.log('👥 Seeding Users...');

  const users = [
    {
      username: 'admin',
      email: 'admin@harmoni.co.id',
      password: await bcrypt.hash('admin123', 10),
      full_name: 'System Administrator',
      role: 'ADMIN',
      company_code: 1310, // Default company for admin UI access
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
      email: 'user1370@polygroup.co.id',
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
