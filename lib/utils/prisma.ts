// lib/utils/prisma.ts

import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient Singleton
 * 
 * Purpose:
 * - Prevent multiple Prisma Client instances in development (hot reload)
 * - Reuse single connection pool
 * - Optimize database connections
 * 
 * How it works:
 * - In development: Store instance in global object (survives hot reload)
 * - In production: Create single instance
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
      ? ['query', 'error', 'warn'] 
      : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
