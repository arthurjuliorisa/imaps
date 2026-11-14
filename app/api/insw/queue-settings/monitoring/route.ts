import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { queueMonitoringRequest } from '@/lib/insw-queue/monitoring';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return queueMonitoringRequest(request, await getServerSession(authOptions), prisma);
}
