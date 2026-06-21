import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type InswTrackingLogDbClient = PrismaClient | Prisma.TransactionClient;

export async function deleteINSWTrackingLogsForCompany(
  companyCode: number,
  client: InswTrackingLogDbClient = prisma
): Promise<number> {
  const result = await client.insw_tracking_log.deleteMany({
    where: { company_code: companyCode },
  });

  return result.count;
}
