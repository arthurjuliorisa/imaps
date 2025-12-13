export const userData = [
  {
    username: 'admin',
    email: 'admin@imaps.com',
    password: 'admin123', // Will be hashed in seeder
    role: 'ADMIN' as const,
    companyCode: 'DEFAULT',
  },
  {
    username: 'admin',
    email: 'admin@email.com',
    password: '12345', // Will be hashed in seeder - FOR TESTING ONLY
    role: 'ADMIN' as const,
    companyCode: 'DEFAULT',
  },
  {
    username: 'operator',
    email: 'operator@imaps.com',
    password: 'operator123', // Will be hashed in seeder
    role: 'USER' as const,
    companyCode: 'DEFAULT',
  },
  {
    username: 'supervisor',
    email: 'supervisor@imaps.com',
    password: 'supervisor123', // Will be hashed in seeder
    role: 'USER' as const,
    companyCode: 'DEFAULT',
  },
];
