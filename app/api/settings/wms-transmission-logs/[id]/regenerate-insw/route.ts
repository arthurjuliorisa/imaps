import { regenerationMessage } from '@/lib/insw-regeneration-messages';
import { NextResponse } from 'next/server';
import { checkMenuAuth } from '@/lib/menu-auth';
import { prisma } from '@/lib/prisma';
import { regenerateWmsInsw, RegenerationError, validateRegenerationRequest } from '@/lib/insw-queue/manual-regeneration';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkMenuAuth('/settings/wms-logs');
  if (!auth.authenticated) {
    const code = auth.response.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN';
    return NextResponse.json({ success: false, code, message: regenerationMessage(code) }, { status: auth.response.status });
  }
  if (!auth.grants.canView || !auth.grants.canEdit) return NextResponse.json({ success: false, code: 'FORBIDDEN', message: regenerationMessage('FORBIDDEN') }, { status: 403 });
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ success: false, code: 'INVALID_ORIGIN', message: regenerationMessage('INVALID_ORIGIN') }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > BigInt('9223372036854775807')) {
    return NextResponse.json({ success: false, code: 'INVALID_ID', message: regenerationMessage('INVALID_ID') }, { status: 400 });
  }
  try {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new RegenerationError('INVALID_REQUEST', 'JSON content type required.', 400);
    }
    let body: unknown;
    try { body = await request.json(); } catch {
      throw new RegenerationError('INVALID_REQUEST', 'Malformed JSON request.', 400);
    }
    const reason = validateRegenerationRequest(body);
    const result = await regenerateWmsInsw(prisma, auth.session.user, BigInt(id), { reason });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const code = error instanceof RegenerationError ? error.code : 'VERIFICATION_INCONCLUSIVE';
    console.warn('INSW regeneration refused', { logId: id, code,
      detail: error instanceof RegenerationError ? error.message : 'Unexpected coordinator or concurrent transaction failure' });
    return NextResponse.json({ success: false, code, message: regenerationMessage(code) },
      { status: error instanceof RegenerationError ? error.status : 409 });
  }
}
