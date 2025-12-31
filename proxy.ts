import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Protected routes that require menu access permission
 * These routes will be checked against user's accessible menus
 */
const PROTECTED_ROUTES = [
  '/master/companies',
  '/master/item-types',
  '/master/scrap-items',
  '/customs/incoming',
  '/customs/outgoing',
  '/customs/wip',
  '/customs/raw-material',
  '/customs/production',
  '/customs/scrap',
  '/customs/capital-goods',
  '/customs/scrap-transactions',
  '/customs/capital-goods-transactions',
  '/customs/beginning-data',
  '/settings/users',
  '/settings/access-menu',
  '/settings/log-activity',
];

/**
 * Fetch user's accessible menu paths
 */
async function fetchUserMenuPaths(request: NextRequest): Promise<Set<string>> {
  try {
    const response = await fetch(
      new URL('/api/settings/access-menu/current-user-menus', request.url),
      {
        headers: {
          cookie: request.headers.get('cookie') || '',
        },
      }
    );

    if (!response.ok) {
      return new Set();
    }

    const menus = await response.json();
    return new Set(
      menus
        .filter((menu: any) => menu.menuPath !== null)
        .map((menu: any) => menu.menuPath as string)
    );
  } catch (error) {
    console.error('[Middleware] Error fetching user menus:', error);
    return new Set();
  }
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for non-protected routes
  const isProtectedRoute = PROTECTED_ROUTES.some((route) => pathname.startsWith(route));

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // Check if user is authenticated
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    // Redirect to login if not authenticated
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin users bypass all menu permission checks
  if (token.role === 'ADMIN') {
    return NextResponse.next();
  }

  // For non-admin users, check menu access
  const accessiblePaths = await fetchUserMenuPaths(request);

  // Check if user has access to the current path
  const hasAccess = accessiblePaths.has(pathname);

  if (!hasAccess) {
    // Redirect to access denied page
    return NextResponse.redirect(new URL('/access-denied', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - login (login page)
     * - access-denied (access denied page)
     * - dashboard (dashboard is accessible to all authenticated users)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|login|access-denied|dashboard|logo.png).*)',
  ],
};
