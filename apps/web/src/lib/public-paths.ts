// The pages open to visitors without a session (proxy.ts sends everyone else to the sign-in page). Pure code, tested.

// The company's logo and thumbnail are shown on the sign-in page and the candidate's offer page, and the thumbnail is the
// browser tab icon there too (owner's request, 15 October 2026).
const PUBLIC_PATHS = new Set([
  '/login',
  // set-password links and Forgot password (owner, 22 October 2026: "Set-password link"): opened without a session, the
  // link's token (after its #) the proof
  '/set-password',
  '/forgot-password',
  // signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login", "via app and web")
  '/login/code',
  '/company-logo',
  '/company-thumbnail',
  // the careers page's list of open jobs (recruitment, 22 October 2026)
  '/careers',
  // the app's newest APK (its force update, 31 October 2026: app/download/route.ts), opened from the app or a phone's
  // browser without a session
  '/download',
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
  // Meta's WhatsApp webhook (owner, 24 October 2026: "how to make whatsapp notifications?"; "Directly to Meta"): Meta
  // calls it from its servers without a session; the API checks the verify token and each event's signature itself
  '/whatsapp/webhook',
  // and Twilio's (owner, 25 October 2026: "Add Twilio as a choice"): each message's status callback and what people write
  // to the business number; the API checks each call's X-Twilio-Signature itself
  '/whatsapp/twilio/status',
  '/whatsapp/twilio/incoming',
]);

/**
 * Everything under these is public too: a candidate's job offer, /offer/<token> and its document, opened from the link
 * HR sends, without an account (owner's request, 15 October 2026). The link's secret is the token; /offers (HR's) is not.
 */
const PUBLIC_PREFIXES = [
  '/offer/',
  // the careers page (owner, 22 October 2026: "where will we include the ATS?"): open jobs, a job's page and its form
  '/careers/',
];

/** Whether a page is open to visitors without a session. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** What the careers address shows besides the careers pages: the company's logo and thumbnail on them. */
const CAREERS_HOST_KEEPS = ['/careers', '/company-logo', '/company-thumbnail'];

/**
 * The careers page on its own address, when it gets one (owner, 22 October 2026: "i dont know how to decide it for now";
 * the page lives at people.trendlix.com/careers, made so careers.trendlix.com can point at it later with a CNAME and
 * the domain added to the same Vercel project): on a host starting "careers.", every address is the careers pages'
 * (careers.trendlix.com/ is /careers, careers.trendlix.com/<job> is /careers/<job>), so the staff pages and the sign-in
 * are never reached there. The path to rewrite to; null to leave the request as it is.
 */
export function careersRewrite(host: string | null | undefined, pathname: string): string | null {
  const name = (host ?? '').toLowerCase().split(':')[0];
  if (!name.startsWith('careers.')) return null;
  if (CAREERS_HOST_KEEPS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return pathname === '/' ? '/careers' : `/careers${pathname}`;
}
