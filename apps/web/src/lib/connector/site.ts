// The website's own origin, for the Claude connector (owner, 21 October 2026: "the connection method": a custom connector
// on the owner's own Claude account): the MCP address pasted into Claude, the OAuth issuer and every metadata address
// are this origin's, so a preview deployment is self-consistent and production is https://people.trendlix.com. Read from
// the request: Vercel sets x-forwarded-host and x-forwarded-proto to the public host and scheme. Pure code (no "@/"
// imports): tested.

type HeaderSource = Pick<Headers, 'get'>;

const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

const firstOf = (value: string | null | undefined): string => (value ?? '').split(',')[0].trim();

/**
 * The site's origin, "https://people.trendlix.com" (never a trailing slash): the forwarded host and scheme, else the
 * host header; https unless the request says http or the host is this computer. Null when no host can be read.
 */
export function originFromHeaders(h: HeaderSource): string | null {
  const host = firstOf(h.get('x-forwarded-host')) || firstOf(h.get('host'));
  if (!host || !HOST.test(host)) return null;
  const proto = firstOf(h.get('x-forwarded-proto')).toLowerCase();
  const scheme = proto === 'https' || proto === 'http' ? proto : LOCAL.test(host) ? 'http' : 'https';
  return `${scheme}://${host.toLowerCase()}`;
}

/** A route handler's origin: from its headers, else from its URL. */
export function originOfRequest(request: Pick<Request, 'url' | 'headers'>): string {
  return originFromHeaders(request.headers) ?? new URL(request.url).origin;
}

/**
 * The browser origins that may call the MCP endpoint: the site itself, and Claude's own web apps. Claude calls from its
 * servers, with no Origin at all; a request that carries another origin is refused (the transport spec: "Servers MUST
 * validate the Origin header … If the Origin header is present and invalid, servers MUST respond with HTTP 403").
 */
export const CLAUDE_WEB_ORIGINS = ['https://claude.ai', 'https://claude.com'] as const;

export function mcpOriginAllowed(origin: string | null, siteOrigin: string): boolean {
  if (origin === null || origin === '') return true;
  const o = origin.trim().toLowerCase();
  return o === siteOrigin.toLowerCase() || (CLAUDE_WEB_ORIGINS as readonly string[]).includes(o);
}
