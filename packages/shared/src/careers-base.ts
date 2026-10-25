// The careers pages' public address, one base for the links the careers forms' sign-in builds (25 October 2026: the
// owner is moving the careers pages to www.trendlix.com/careers, the main site proxying /careers/* to this app with a
// Next.js multi-zones rewrite). So no careers address is written into the code: LinkedIn's redirect URL (shown in
// Recruitment Settings and sent to LinkedIn) and the pages the sign-in returns to are built from this base — the
// website's CAREERS_BASE_URL when it is set ("https://www.trendlix.com/careers"), else the site's own address and
// /careers, as today. The app's own routes stay under /careers either way (the proxy keeps the path).
// Pure code, tested in apps/api/src/common/careers-base.spec.ts.

/** Where the careers pages live in this app. */
export const CAREERS_BASE_PATH = '/careers';

/** An address with no query or fragment: http(s), a host, a port maybe, and a path of plain segments. */
const BASE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~-]+)*$/i;
const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?(?:\/|$)/i;

/** Whether a text is a careers base: https (http only on this computer), a host, a path, no trailing slash, query or #. */
export const isCareersBase = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 200 && BASE.test(value) && (value.startsWith('https://') || LOCAL.test(value));

/**
 * The careers pages' public address: `configured` (CAREERS_BASE_URL) when it is one, else `origin` (the site's own
 * address, as the request reached it) and /careers; null when neither can be read.
 */
export function careersBaseOf(origin: string | null | undefined, configured?: string | null): string | null {
  const set = configured?.trim().replace(/\/+$/, '');
  if (set && isCareersBase(set)) return set;
  const own = origin?.trim().replace(/\/+$/, '');
  return own && isCareersBase(own) && new URL(own).pathname === '/' ? `${own}${CAREERS_BASE_PATH}` : null;
}

/**
 * An app path under /careers ("/careers/<slug>?src=linkedin", "/careers/linkedin/callback", "/careers") as the same page
 * at the careers base ("https://www.trendlix.com/careers/<slug>?src=linkedin").
 */
export function careersHref(base: string, appPath: string): string {
  const root = base.replace(/\/+$/, '');
  if (appPath === CAREERS_BASE_PATH) return root;
  const rest = appPath.startsWith(`${CAREERS_BASE_PATH}/`) || appPath.startsWith(`${CAREERS_BASE_PATH}?`) ? appPath.slice(CAREERS_BASE_PATH.length) : appPath;
  return `${root}${rest.startsWith('/') || rest.startsWith('?') ? rest : `/${rest}`}`;
}

/** The path the browser sees the careers base at ("/careers", or "" on a host of its own), for a cookie's path. */
export const careersCookiePath = (base: string, under = ''): string => `${new URL(base).pathname.replace(/\/+$/, '')}${under}` || '/';
