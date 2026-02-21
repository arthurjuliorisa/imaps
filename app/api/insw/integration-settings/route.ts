import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/insw/integration-settings
 * Returns all INSW integration settings ordered by id
 */
export async function GET() {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const settings = await prisma.$queryRaw<Array<{
      id: number;
      endpoint_key: string;
      endpoint_name: string;
      description: string | null;
      is_enabled: boolean;
      updated_at: Date;
      updated_by: string | null;
    }>>`
      SELECT id, endpoint_key, endpoint_name, description, is_enabled, updated_at, updated_by
      FROM insw_integration_settings
      ORDER BY id ASC
    `;

    return NextResponse.json({ success: true, data: settings });
  } catch (error: any) {
    console.error('Error fetching INSW integration settings:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch integration settings' },
      { status: 500 }
    );
  }
}
