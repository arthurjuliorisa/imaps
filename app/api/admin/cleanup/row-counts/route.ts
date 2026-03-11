/**
 * API Route: Admin - Get Row Counts
 * POST /api/admin/cleanup/row-counts - Get row counts for specified tables
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';
import { CLEANUP_TABLES } from '@/lib/cleanup/table-config';

/**
 * Handler: POST /api/admin/cleanup/row-counts
 * Get row count for each specified table
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify admin role
    const user = await prisma.users.findUnique({
      where: { email: session.user.email },
      select: { role: true }
    });

    if (user?.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { tableIds } = body;

    if (!Array.isArray(tableIds) || tableIds.length === 0) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Table IDs array required' },
        { status: 400 }
      );
    }

    // Get row counts for each table
    const rowCounts: Record<string, number> = {};

    for (const tableId of tableIds) {
      const table = CLEANUP_TABLES.find((t) => t.id === tableId);
      if (!table) {
        logger.warn(`Unknown table ID requested: ${tableId}`);
        continue;
      }

      try {
        const result = await prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM ${Prisma.raw(table.name)}
        `;
        rowCounts[tableId] = Number(result[0]?.count ?? 0);
      } catch (error) {
        logger.error(`Failed to get row count for ${table.name}`, {
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        rowCounts[tableId] = 0;
      }
    }

    return NextResponse.json({
      success: true,
      rowCounts,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get row counts', {
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
