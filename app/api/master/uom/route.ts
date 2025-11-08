import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const uoms = await prisma.uOM.findMany({
      orderBy: {
        code: 'asc',
      },
    });
    return NextResponse.json(uoms);
  } catch (error) {
    console.error('[API Error] Failed to fetch UOMs:', error);
    return NextResponse.json({ message: 'Error fetching UOMs' }, { status: 500 });
  }
}
