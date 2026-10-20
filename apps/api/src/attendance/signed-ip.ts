import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  CLIENT_IP_WINDOW_MS,
  clientIpPayload,
  normalizedIp,
  webKeyUsable,
  type SignedIpProblem,
} from '@trendlix/shared';

// The address a check-in comes from (owner, 20 October 2026: check-ins locked to the office network). The API is
// reachable on port 8443 by anyone with a session token, so it never trusts an address a request merely names: only one
// the website (on Vercel) signed with the key both share (WEB_KEY, made by deploy/web-key.sh), an HMAC-SHA256 over the
// address, the time it was signed and the SHA-256 of the session token sent with it (packages/shared office-network.ts,
// clientIpPayload). Trusted only with the right signature, within a minute either way, for the same token; without the
// key here nothing is trusted, and the lock isn't in force. The address is used for the decision and never kept.

/** A request's address, trusted (normalised: an IPv4-mapped IPv6 address as its IPv4 one), or why it isn't. */
export type SignedIp = { ip: string; problem?: undefined } | { ip?: undefined; problem: SignedIpProblem };

/** The session token's SHA-256, hex: what the signature binds the address to. */
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** The signature the website sends for an address, a time and a session token (base64url). */
export const signatureOf = (key: string, ip: string, at: string, token: string): string =>
  createHmac('sha256', key.trim()).update(clientIpPayload(ip, at, tokenHash(token))).digest('base64url');

type Headers = Record<string, string | string[] | undefined>;

const one = (h: Headers, name: string): string | undefined => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * The address a request's headers carry, if the website signed it with `key` for this `token` within a minute of `now`
 * (milliseconds); else why not: no key here, nothing signed, not readable, too old or ahead, a wrong signature (another
 * key, another token, or an address or time changed after signing).
 */
export function verifySignedIp(headers: Headers, token: string | undefined, key: string | undefined, now: number): SignedIp {
  if (!webKeyUsable(key)) return { problem: 'no_server_key' };
  const ip = one(headers, CLIENT_IP_HEADER)?.trim();
  const at = one(headers, CLIENT_IP_AT_HEADER)?.trim();
  const signature = one(headers, CLIENT_IP_SIGNATURE_HEADER)?.trim();
  if (!ip && !at && !signature) return { problem: 'unsigned' };
  const shown = normalizedIp(ip);
  if (!ip || !shown || !at || !/^\d{10,16}$/.test(at) || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature) || !token) return { problem: 'malformed' };
  if (Math.abs(now - Number(at)) > CLIENT_IP_WINDOW_MS) return { problem: 'stale' };
  const expected = Buffer.from(signatureOf(key, ip, at, token));
  const sent = Buffer.from(signature);
  if (expected.length !== sent.length || !timingSafeEqual(expected, sent)) return { problem: 'bad_signature' };
  return { ip: shown };
}
