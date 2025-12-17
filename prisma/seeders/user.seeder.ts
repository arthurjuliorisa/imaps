import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function seedUsers() {
  console.log('👥 Seeding Users...');

  const users = [
    {
      username: 'admin',
      email: 'admin@imaps.local',
      password: await bcrypt.hash('admin123', 10),
      role: UserRole.ADMIN,
      company_code: 'ACME',
    },
    {
      username: 'viewer',
      email: 'viewer@imaps.local',
      password: await bcrypt.hash('viewer123', 10),
      role: UserRole.VIEWER,
      company_code: 'ACME',
    },
    {
      username: 'operator',
      email: 'operator@imaps.local',
      password: await bcrypt.hash('operator123', 10),
      role: UserRole.USER,
      company_code: 'ACME',
    },
  ];

  const createdUsers = [];
  for (const user of users) {
    const createdUser = await prisma.users.upsert({
      where: { email: user.email },
      update: {
        username: user.username,
        password: user.password,
        role: user.role,
        company_code: user.company_code,
      },
      create: user,
    });
    createdUsers.push(createdUser);
    console.log(`  ✓ Created/Updated User: ${user.email} (${user.role})`);
  }

  console.log(`Completed: ${createdUsers.length} users seeded\n`);
  return createdUsers;
}
