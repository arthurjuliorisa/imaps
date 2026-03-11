import { NextResponse } from 'next/server';
import { INSWIntegrationService } from '@/lib/services/insw-integration.service';
import { checkAuth } from '@/lib/api-auth';

export async function DELETE(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };

    if (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPERADMIN') {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized: Only ADMIN can perform cleansing data',
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const npwp = searchParams.get('npwp');

    if (!npwp) {
      return NextResponse.json(
        {
          success: false,
          error: 'NPWP is required',
        },
        { status: 400 }
      );
    }

    const service = new INSWIntegrationService(
      process.env.INSW_API_KEY || 'RqT40lH7Hy202uUybBLkFhtNnfAvxrlp',
      process.env.INSW_UNIQUE_KEY_TEST || '',
      true
    );

    const result = await service.cleansingData(npwp);

    return NextResponse.json({
      success: result.status,
      message: result.message,
      data: result.data,
      inswResponse: result,
    });
  } catch (error: any) {
    console.error('Error cleansing INSW data:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
