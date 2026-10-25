import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './lib/constants';
import { careersRewrite, isPublicPath } from './lib/public-paths';

const CAREERS_SITE = 'https://www.trendlix.com/en/careers';

// Quick check only: sends visitors without a session cookie to the sign-in page.
// The API still verifies the session and role on every request. The public pages: lib/public-paths.ts.
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // the careers page's own address, once it has one (careers.trendlix.com: lib/public-paths.ts careersRewrite)
  const careers = careersRewrite(req.headers.get('host'), pathname) ?? (pathname === '/careers' || pathname.startsWith('/careers/') ? pathname : null);
  if (careers) return NextResponse.redirect(`${CAREERS_SITE}${careers.slice('/careers'.length)}${search}`, 308);
  if (isPublicPath(pathname) || req.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = new URL('/login', req.url);
  if (pathname !== '/') url.searchParams.set('next', pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
