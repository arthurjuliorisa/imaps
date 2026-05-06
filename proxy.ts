import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isAllowedRequestHost, getRequestHost } from './lib/security/request-origin';

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

const isAuthDebugEnabled = process.env.AUTH_DEBUG === 'true';

function getForwardedProto(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase() || null;
}

function shouldUseSecureCookie(request: NextRequest): boolean {
  const forwardedProto = getForwardedProto(request);

  return (
    forwardedProto === 'https' ||
    process.env.NEXTAUTH_URL?.startsWith('https://') === true
  );
}

function authDebug(message: string, details?: Record<string, unknown>) {
  if (!isAuthDebugEnabled) {
    return;
  }

  if (details) {
    console.log(`[Auth Debug] ${message}`, details);
    return;
  }

  console.log(`[Auth Debug] ${message}`);
}

/**
 * Fetch user's accessible menu paths with retry logic and better error handling
 * @param request - NextRequest object
 * @param retries - Number of retry attempts (default: 2)
 * @returns Set of accessible menu paths
 */
async function fetchUserMenuPaths(
  request: NextRequest,
  retries = 2
): Promise<Set<string>> {
  const startTime = Date.now();
  const pathname = request.nextUrl.pathname;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(
        new URL('/api/settings/access-menu/current-user-menus', request.url),
        {
          headers: {
            cookie: request.headers.get('cookie') || '',
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (!response.ok) {
        if (attempt < retries) {
          console.warn(
            `[Middleware] Attempt ${attempt + 1}/${retries + 1} failed with status ${response.status} (${duration}ms) for ${pathname}, retrying...`
          );
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
          continue;
        }
        console.error(
          `[Middleware] API failed with status ${response.status} after ${retries + 1} attempts (${duration}ms) for ${pathname}`
        );
        return new Set();
      }

      const menus = await response.json();
      const accessiblePaths: Set<string> = new Set(
        menus
          .filter((menu: any) => menu.menuPath !== null)
          .map((menu: any) => menu.menuPath as string)
      );

      console.log(
        `[Middleware] Successfully fetched ${menus.length} menus, ${accessiblePaths.size} accessible paths (${duration}ms) for ${pathname}`
      );

      return accessiblePaths;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (attempt < retries) {
        console.warn(
          `[Middleware] Attempt ${attempt + 1}/${retries + 1} failed (${duration}ms) for ${pathname}, retrying...`,
          error instanceof Error ? error.message : String(error)
        );
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
        continue;
      }

      // Final attempt failed - log comprehensive error
      console.error(
        `[Middleware] Error fetching user menus after ${retries + 1} attempts (${duration}ms) for ${pathname}:`
      );
      console.error(`[Middleware] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
      console.error(`[Middleware] Error message: ${error instanceof Error ? error.message : String(error)}`);

      return new Set();
    }
  }

  // Fallback (should never reach here)
  return new Set();
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestStartTime = Date.now();
  const forwardedProto = getForwardedProto(request);
  const secureCookie = shouldUseSecureCookie(request);

  if (!isAllowedRequestHost(request)) {
    console.warn(`[Middleware] Invalid host header: ${getRequestHost(request) || 'missing'}`);
    return NextResponse.json({ message: 'Invalid host' }, { status: 400 });
  }

  authDebug('request', {
    pathname,
    url: request.url,
    host: request.headers.get('host'),
    forwardedHost: request.headers.get('x-forwarded-host'),
    forwardedProto,
    forwardedPort: request.headers.get('x-forwarded-port'),
    secureCookie,
    hasSessionCookie: Boolean(request.cookies.get('next-auth.session-token')),
    hasSecureSessionCookie: Boolean(request.cookies.get('__Secure-next-auth.session-token')),
  });

  // Skip middleware for non-protected routes
  const isProtectedRoute = PROTECTED_ROUTES.some((route) => pathname.startsWith(route));

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // Check if user is authenticated
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie,
  });

  if (!token) {
    console.warn(`[Middleware] Unauthenticated access attempt to ${pathname}`);
    // Redirect to login if not authenticated
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    authDebug('redirect unauthenticated request', {
      pathname,
      redirectTarget: `${loginUrl.pathname}${loginUrl.search}`,
      secureCookie,
      tokenExists: false,
    });
    return NextResponse.redirect(loginUrl);
  }

  authDebug('token resolved', {
    pathname,
    secureCookie,
    tokenExists: true,
    role: token.role || null,
  });

  const userEmail = token.email || 'unknown';
  const userRole = token.role || 'unknown';

  // Admin users bypass all menu permission checks
  if (token.role === 'ADMIN') {
    const duration = Date.now() - requestStartTime;
    console.log(`[Middleware] ADMIN user ${userEmail} accessing ${pathname} - ALLOWED (${duration}ms)`);
    return NextResponse.next();
  }

  // For non-admin users, check menu access
  const accessiblePaths = await fetchUserMenuPaths(request);

  // Check if user has access to the current path or its parent path (for dynamic routes)
  let hasAccess = accessiblePaths.has(pathname);

  // If no exact match, check parent paths for dynamic routes
  // Example: /customs/outgoing/123 -> check /customs/outgoing
  if (!hasAccess) {
    const pathSegments = pathname.split('/').filter(Boolean);
    // Try removing last segment(s) to find parent path
    for (let i = pathSegments.length - 1; i > 0; i--) {
      const parentPath = '/' + pathSegments.slice(0, i).join('/');
      if (accessiblePaths.has(parentPath)) {
        hasAccess = true;
        console.log(`[Middleware] Access granted via parent path: ${parentPath} for ${pathname}`);
        break;
      }
    }
  }

  const totalDuration = Date.now() - requestStartTime;

  if (!hasAccess) {
    console.warn(
      `[Middleware] ACCESS DENIED for ${userEmail} (${userRole}) to ${pathname} (${totalDuration}ms) - User has access to ${accessiblePaths.size} paths: ${Array.from(accessiblePaths).join(', ')}`
    );
    // Redirect to access denied page
    authDebug('redirect unauthorized request', {
      pathname,
      redirectTarget: '/access-denied',
      accessiblePathCount: accessiblePaths.size,
    });
    return NextResponse.redirect(new URL('/access-denied', request.url));
  }

  console.log(`[Middleware] Access granted for ${userEmail} (${userRole}) to ${pathname} (${totalDuration}ms)`);
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Keep the proxy narrowly scoped so build/runtime cost stays close to the
     * original setup while still covering auth entry points and protected pages.
     */
    '/login',
    '/api/auth/:path*',
    '/master/companies/:path*',
    '/master/item-types/:path*',
    '/master/scrap-items/:path*',
    '/customs/incoming/:path*',
    '/customs/outgoing/:path*',
    '/customs/wip/:path*',
    '/customs/raw-material/:path*',
    '/customs/production/:path*',
    '/customs/scrap/:path*',
    '/customs/capital-goods/:path*',
    '/customs/scrap-transactions/:path*',
    '/customs/capital-goods-transactions/:path*',
    '/customs/beginning-data/:path*',
    '/settings/users/:path*',
    '/settings/access-menu/:path*',
    '/settings/log-activity/:path*',
  ],
};
