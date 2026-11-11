import type { Session } from 'next-auth';
import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { resolveQueue, ResolutionError } from '@/lib/insw-queue/admin-resolution';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkAuth();
  if (!auth.authenticated) return auth.response;
  const session = auth.session as Session | null;
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ success: false, message: 'FORBIDDEN' }, { status: 403 });
  }
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ success: false, message: 'INVALID_ORIGIN' }, { status: 403 });
  }
  try {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ResolutionError('INVALID_REQUEST', 400);
    let body: unknown;
    try { body = await request.json(); } catch { throw new ResolutionError('INVALID_REQUEST', 400); }
    const { id } = await params;
    return NextResponse.json(await resolveQueue(prisma, session.user, id, body));
  } catch (error) {
    const known = error instanceof ResolutionError;
    return NextResponse.json({ success: false, message: known ? error.code : 'Resolution could not be recorded. Refresh and try again.' },
      { status: known ? error.status : 409 });
  }
}
