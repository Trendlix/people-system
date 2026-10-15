// The pages open to visitors without a session (proxy.ts sends everyone else to the sign-in page). Pure code, tested.

const PUBLIC_PATHS = new Set(['/login', '/company-logo']);

/**
 * Everything under these is public too: a candidate's job offer, /offer/<token> and its document, opened from the link
 * HR sends, without an account (owner's request, 15 October 2026). The link's secret is the token; /offers (HR's) is not.
 */
const PUBLIC_PREFIXES = ['/offer/'];

/** Whether a page is open to visitors without a session. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}
