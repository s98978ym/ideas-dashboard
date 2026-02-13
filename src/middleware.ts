import { NextRequest, NextResponse } from 'next/server';

// Paths that should NOT require auth
const PUBLIC_PATHS = [
  '/api/auth',        // NextAuth routes
  '/api/slack/events',
  '/api/slack/oauth',
  '/api/slack/oauth/callback',
  '/api/sync/dm',     // QStash needs access (has its own auth)
  '/login',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth for public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Skip if Google OAuth not configured (dev mode without credentials)
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.next();
  }

  // Check for session cookie (database strategy uses a plain session ID, not JWT)
  const sessionToken =
    request.cookies.get('next-auth.session-token')?.value ||
    request.cookies.get('__Secure-next-auth.session-token')?.value;

  if (!sessionToken) {
    // Redirect to login page for browser requests
    if (!pathname.startsWith('/api/')) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Return 401 for API requests
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
