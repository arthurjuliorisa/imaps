import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

/**
 * Test beginning stock query to diagnose exact error
 * GET /api/test-beginning
 */
export async function GET() {
  try {
    console.log('[Test Beginning] Starting test...');

    // Test 1: Simple query without any filters
    console.log('[Test Beginning] Test 1: Simple query');
    const simple = await prisma.beginningStock.findMany({
      take: 5,
    });
    console.log('[Test Beginning] Test 1 result:', simple.length);

    // Test 2: With type filter
    console.log('[Test Beginning] Test 2: With type filter');
    const withType = await prisma.beginningStock.findMany({
      where: { type: 'RAW_MATERIAL' },
      take: 5,
    });
    console.log('[Test Beginning] Test 2 result:', withType.length);

    // Test 3: With item include
    console.log('[Test Beginning] Test 3: With item include');
    const withItem = await prisma.beginningStock.findMany({
      where: { type: 'RAW_MATERIAL' },
      include: {
        item: true,
      },
      take: 5,
    });
    console.log('[Test Beginning] Test 3 result:', withItem.length);

    // Test 4: With item select (like actual route)
    console.log('[Test Beginning] Test 4: With item select');
    const withItemSelect = await prisma.beginningStock.findMany({
      where: { type: 'RAW_MATERIAL' },
      include: {
        item: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
          },
        },
      },
      take: 5,
    });
    console.log('[Test Beginning] Test 4 result:', withItemSelect.length);

    // Test 5: With uom select
    console.log('[Test Beginning] Test 5: With uom select');
    const withUom = await prisma.beginningStock.findMany({
      where: { type: 'RAW_MATERIAL' },
      include: {
        item: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
          },
        },
        uom: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
      take: 5,
    });
    console.log('[Test Beginning] Test 5 result:', withUom.length);

    // Test 6: With orderBy
    console.log('[Test Beginning] Test 6: With orderBy');
    const withOrder = await prisma.beginningStock.findMany({
      where: { type: 'RAW_MATERIAL' },
      include: {
        item: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
          },
        },
        uom: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
      orderBy: { beginningDate: 'desc' },
      take: 5,
    });
    console.log('[Test Beginning] Test 6 result:', withOrder.length);

    return NextResponse.json({
      status: 'success',
      message: 'All tests passed',
      results: {
        simpleQuery: simple.length,
        withTypeFilter: withType.length,
        withItemInclude: withItem.length,
        withItemSelect: withItemSelect.length,
        withUomSelect: withUom.length,
        withOrderBy: withOrder.length,
      },
    });
  } catch (error: unknown) {
    console.error('[Test Beginning] Error:', error);

    let errorMessage = 'Unknown error';
    let errorCode = 'UNKNOWN';
    let errorStack = '';

    if (error instanceof Error) {
      errorMessage = error.message;
      errorStack = error.stack || '';
      console.error('[Test Beginning] Error stack:', error.stack);
    }

    if (error && typeof error === 'object' && 'code' in error) {
      errorCode = String(error.code);
    }

    return NextResponse.json(
      {
        status: 'error',
        message: 'Test failed',
        error: {
          message: errorMessage,
          code: errorCode,
          stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
        },
      },
      { status: 500 }
    );
  }
}
