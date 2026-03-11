import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaVersion: number | undefined;
};

const PRISMA_VERSION = 2;

if (globalForPrisma.prismaVersion !== PRISMA_VERSION) {
  globalForPrisma.prisma = undefined;
  globalForPrisma.prismaVersion = PRISMA_VERSION;
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
