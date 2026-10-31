import { createHash, createHmac } from 'node:crypto';
import {
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  CLIENT_META_HEADER,
  CLIENT_META_SIGNATURE_HEADER,
  clientIpPayload,
  clientMetaPayload,
  USER_AGENT_MAX,
  vercelCity,
  webKeyUsable,
  type ClientMeta,
} from '@trendlix/shared';

// The visitor's address, signed for the API (owner, 20 October 2026: check-ins locked to the office network, "allow me to
// lock checkin's to wifi name or ip, whatever is right"). The API is reachable by anyone with a session token, so it
// trusts no address a request merely names: the website signs the one it saw (lib/client-ip.ts) with the key it shares
// with the API (WEB_KEY: deploy/web-key.sh prints it on the server, saved in Vercel's project settings), an HMAC-SHA256
// over the address, the time and the SHA-256 of the session token it is sent with (packages/shared office-network.ts).
// The API checks the signature, the time (a minute either way) and the token (apps/api/src/attendance/signed-ip.ts).
// Sent on every call since 31 October 2026, for the audit log (owner: "with location and ip capture"; lib/api.ts), with
// the visitor's browser and place, Vercel's city, region and country, signed the same way in a header of their own
// (clientMetaHeaders), so an API still on the older version ignores them. Without the key or an address, nothing is
// signed. Server code only (node:crypto); pure, tested; no "@/" imports.

/** The headers that carry the signed address, or none without a usable key, a session token or an address. */
export function signedIpHeaders(key: string | undefined, token: string | undefined, ip: string | undefined, now: number = Date.now()): Record<string, string> {
  if (!webKeyUsable(key) || !token || !ip) return {};
  const at = String(now);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const signature = createHmac('sha256', key.trim()).update(clientIpPayload(ip, at, tokenHash)).digest('base64url');
  return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: at, [CLIENT_IP_SIGNATURE_HEADER]: signature };
}

/** Whether this website holds a key to sign with (WEB_KEY, 32 characters or more). */
export const webKeySet = (key: string | undefined = process.env.WEB_KEY): boolean => webKeyUsable(key);

type HeaderSource = Pick<Headers, 'get'>;

/**
 * The visitor's browser and place as this website sees them (owner, 31 October 2026: "with location and ip capture"):
 * their user agent, and Vercel's country code, region code and city (URL-encoded by Vercel); none of these off Vercel.
 */
export function clientMetaOf(h: HeaderSource): Omit<ClientMeta, 'at'> {
  const ua = h.get('user-agent')?.trim().slice(0, USER_AGENT_MAX);
  const country = h.get('x-vercel-ip-country')?.trim();
  const region = h.get('x-vercel-ip-country-region')?.trim();
  const city = vercelCity(h.get('x-vercel-ip-city')?.trim());
  return { ...(ua && { ua }), ...(country && { country }), ...(region && { region }), ...(city && { city }) };
}

/**
 * The headers that carry the browser and place, signed with the key for the session token (or a stand-in for a call
 * without one): the meta as JSON (base64url) and an HMAC-SHA256 over it and the token's SHA-256. None without a key or
 * a token.
 */
export function clientMetaHeaders(key: string | undefined, token: string | undefined, meta: Omit<ClientMeta, 'at'>, now: number = Date.now()): Record<string, string> {
  if (!webKeyUsable(key) || !token) return {};
  const encoded = Buffer.from(JSON.stringify({ at: now, ...meta }), 'utf8').toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const signature = createHmac('sha256', key.trim()).update(clientMetaPayload(encoded, tokenHash)).digest('base64url');
  return { [CLIENT_META_HEADER]: encoded, [CLIENT_META_SIGNATURE_HEADER]: signature };
}
