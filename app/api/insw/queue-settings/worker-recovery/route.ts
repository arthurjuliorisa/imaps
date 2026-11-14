import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { workerRecoveryRequest } from '@/lib/insw-queue/worker-recovery-http';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return workerRecoveryRequest(request, await getServerSession(authOptions));
}
