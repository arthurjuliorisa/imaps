import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Simple database connection test endpoint
 * GET /api/test-db
 */
export async function GET() {
  try {
    // Test 1: Check if Prisma client is initialized
    if (!prisma) {
      return NextResponse.json(
        {
          status: 'error',
          message: 'Prisma client not initialized',
        },
        { status: 500 }
      );
    }

    // Test 2: Try a simple query
    const result = await prisma.$queryRaw`SELECT 1 as test`;

    // Test 3: Count items in database
    const itemCount = await prisma.item.count();
    const uomCount = await prisma.uOM.count();

    return NextResponse.json({
      status: 'success',
      message: 'Database connection successful',
      data: {
        rawQuery: result,
        itemCount,
        uomCount,
        databaseUrl: process.env.DATABASE_URL ? 'Set' : 'Not Set',
        nodeEnv: process.env.NODE_ENV,
      },
    });
  } catch (error: unknown) {
    console.error('[Test DB] Error:', error);

    let errorMessage = 'Unknown error';
    let errorCode = 'UNKNOWN';

    if (error instanceof Error) {
      errorMessage = error.message;
      console.error('[Test DB] Error stack:', error.stack);
    }

    if (error && typeof error === 'object' && 'code' in error) {
      errorCode = String(error.code);
    }

    return NextResponse.json(
      {
        status: 'error',
        message: 'Database connection failed',
        error: {
          message: errorMessage,
          code: errorCode,
          databaseUrl: process.env.DATABASE_URL ? 'Set (hidden)' : 'Not Set',
        },
      },
      { status: 500 }
    );
  }
}
