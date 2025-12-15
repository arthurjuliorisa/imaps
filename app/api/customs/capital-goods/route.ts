import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';

export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return NextResponse.json(
          { message: 'Invalid date format' },
          { status: 400 }
        );
      }

      if (start > end) {
        return NextResponse.json(
          { message: 'Start date must be before or equal to end date' },
          { status: 400 }
        );
      }
    }

    const where: any = {
      item_type_code: {
        startsWith: 'HIBE',
      },
    };

    if (startDate || endDate) {
      where.snapshot_date = {};
      if (startDate) {
        where.snapshot_date.gte = new Date(startDate);
      }
      if (endDate) {
        where.snapshot_date.lte = new Date(endDate);
      }
    }

    const snapshots = await prisma.stock_daily_snapshot.findMany({
      where,
      orderBy: [
        { snapshot_date: 'desc' },
        { item_code: 'asc' },
      ],
    });

    const transformedData = snapshots.map((snapshot) => ({
      id: snapshot.item_code + '-' + snapshot.snapshot_date.toISOString(),
      itemCode: snapshot.item_code,
      itemName: snapshot.item_name,
      unit: 'N/A',
      date: snapshot.snapshot_date,
      beginning: Number(snapshot.opening_balance),
      in: Number(snapshot.incoming_qty),
      out: Number(snapshot.outgoing_qty),
      adjustment: Number(snapshot.adjustment_qty),
      ending: Number(snapshot.closing_balance),
      stockOpname: 0,
      variant: 0,
      remarks: null,
    }));

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error('[API Error] Failed to fetch capital goods mutations:', error);
    return NextResponse.json(
      { message: 'Error fetching capital goods mutations' },
      { status: 500 }
    );
  }
}
