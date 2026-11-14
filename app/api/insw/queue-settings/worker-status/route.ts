import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { workerStatusRequest } from '@/lib/insw-queue/worker-status-http';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return workerStatusRequest(request, await getServerSession(authOptions));
}
