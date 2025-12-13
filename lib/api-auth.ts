import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';

/**
 * Check if the user is authenticated
 * Returns the session if authenticated, or an error response if not
 */
export async function checkAuth(): Promise<
  | { authenticated: true; session: Awaited<ReturnType<typeof getServerSession>> }
  | { authenticated: false; response: NextResponse }
> {
  const session = await getServerSession(authOptions);

  if (!session) {
    return {
      authenticated: false,
      response: NextResponse.json(
        { message: 'Unauthorized - Please log in to access this resource' },
        { status: 401 }
      ),
    };
  }

  return { authenticated: true, session };
}

/**
 * Check if the user is authenticated and has required role
 */
export async function checkAuthWithRole(allowedRoles: string[]): Promise<
  | { authenticated: true; session: Awaited<ReturnType<typeof getServerSession>> }
  | { authenticated: false; response: NextResponse }
> {
  const authCheck = await checkAuth();

  if (!authCheck.authenticated) {
    return authCheck;
  }

  const userRole = (authCheck.session as any)?.user?.role;

  if (!userRole || !allowedRoles.includes(userRole)) {
    return {
      authenticated: false,
      response: NextResponse.json(
        { message: 'Forbidden - Insufficient permissions' },
        { status: 403 }
      ),
    };
  }

  return authCheck;
}
