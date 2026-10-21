// The pages open to visitors without a session (proxy.ts sends everyone else to the sign-in page). Pure code, tested.

// The company's logo and thumbnail are shown on the sign-in page and the candidate's offer page, and the thumbnail is the
// browser tab icon there too (owner's request, 15 October 2026).
const PUBLIC_PATHS = new Set([
  '/login',
  '/company-logo',
  '/company-thumbnail',
  // the Claude connector (owner, 21 October 2026: "the connection method"): Claude calls these from its servers, without
  // the session cookie. The MCP endpoint answers 401 itself (which starts Claude's sign-in), the metadata is public by
  // design, and the token, registration and revocation endpoints authenticate the client themselves. The sign-in and
  // consent page (/oauth/authorize) is not here: without a session, the person signs in first.
  '/api/mcp',
  '/oauth/token',
  '/oauth/register',
  '/oauth/revoke',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/api/mcp',
  '/.well-known/oauth-authorization-server',
]);

/**
 * Everything under these is public too: a candidate's job offer, /offer/<token> and its document, opened from the link
 * HR sends, without an account (owner's request, 15 October 2026). The link's secret is the token; /offers (HR's) is not.
 */
const PUBLIC_PREFIXES = ['/offer/'];

/** Whether a page is open to visitors without a session. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}
