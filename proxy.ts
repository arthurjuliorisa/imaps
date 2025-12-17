import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Proxy to protect API routes
 * Runs before API routes are executed
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protected API routes
  const protectedApiRoutes = [
    '/api/master',
    '/api/settings',
    '/api/dashboard',
    '/api/admin',
  ];

  // Check if the request is for a protected API route
  const isProtectedApi = protectedApiRoutes.some((route) =>
    pathname.startsWith(route)
  );

  if (isProtectedApi) {
    // Get the session token
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    // If no token, return 401 Unauthorized
    if (!token) {
      return NextResponse.json(
        { message: 'Unauthorized - Please log in to access this resource' },
        { status: 401 }
      );
    }

    // Token exists, continue to the API route
    return NextResponse.next();
  }

  // Not a protected route, continue
  return NextResponse.next();
}

/**
 * Configure which routes the proxy should run on
 */
export const config = {
  matcher: [
    '/api/master/:path*',
    '/api/settings/:path*',
    '/api/dashboard/:path*',
    '/api/admin/:path*',
  ],
};
