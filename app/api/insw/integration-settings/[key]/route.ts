import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/log-activity';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

/**
 * PATCH /api/insw/integration-settings/[key]
 * Toggle INSW integration endpoint on/off
 * Body: { is_enabled: boolean }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { key } = await params;
    const body = await request.json();

    if (typeof body.is_enabled !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'is_enabled must be a boolean' },
        { status: 400 }
      );
    }

    const { is_enabled } = body;

    const existing = await prisma.$queryRaw<Array<{
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
      WHERE endpoint_key = ${key}
      LIMIT 1
    `;

    if (!existing || existing.length === 0) {
      return NextResponse.json(
        { success: false, error: `Integration setting not found: ${key}` },
        { status: 404 }
      );
    }

    const current = existing[0];
    const previous_state = current.is_enabled;

    const session = await getServerSession(authOptions);
    const updatedBy = session?.user?.email || session?.user?.name || null;

    await prisma.$executeRaw`
      UPDATE insw_integration_settings
      SET is_enabled = ${is_enabled}, updated_at = NOW(), updated_by = ${updatedBy}
      WHERE endpoint_key = ${key}
    `;

    const updated = await prisma.$queryRaw<Array<{
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
      WHERE endpoint_key = ${key}
      LIMIT 1
    `;

    await logActivity({
      action: 'INSW_INTEGRATION_TOGGLE',
      description: `Integrasi INSW "${current.endpoint_name}" ${is_enabled ? 'diaktifkan' : 'dinonaktifkan'}`,
      status: 'success',
      metadata: {
        endpoint_key: key,
        endpoint_name: current.endpoint_name,
        is_enabled,
        previous_state,
      },
    });

    return NextResponse.json({ success: true, data: updated[0] });
  } catch (error: any) {
    console.error('Error updating INSW integration setting:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update integration setting' },
      { status: 500 }
    );
  }
}
