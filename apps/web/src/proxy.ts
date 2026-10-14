import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './lib/constants';

// Quick check only: sends visitors without a session cookie to the sign-in page.
// The API still verifies the session and role on every request.
const PUBLIC_PATHS = new Set(['/login', '/company-logo']);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || req.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = new URL('/login', req.url);
  if (pathname !== '/') url.searchParams.set('next', pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
