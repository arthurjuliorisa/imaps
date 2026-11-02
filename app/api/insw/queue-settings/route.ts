import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { intervalSettingsRequest } from '@/lib/insw-queue/interval-settings-http';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return intervalSettingsRequest(request, await getServerSession(authOptions), prisma);
}
export async function PATCH(request: Request) {
  return intervalSettingsRequest(request, await getServerSession(authOptions), prisma);
}
