import { NextResponse } from 'next/server';

/**
 * This legacy endpoint persisted only outgoing_goods and could violate the
 * Scrap OUT dual-persistence invariant. The supported manual creation endpoint
 * is /api/customs/scrap-transactions/out.
 */
export async function POST() {
  return NextResponse.json(
    { message: 'This legacy Scrap OUT endpoint is retired. Use /api/customs/scrap-transactions/out.' },
    { status: 410 }
  );
}
