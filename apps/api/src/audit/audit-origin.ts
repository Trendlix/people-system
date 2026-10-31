import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ACCESS_IP_TOKEN,
  APP_LOCATION_HEADER,
  CLIENT_IP_WINDOW_MS,
  CLIENT_META_HEADER,
  CLIENT_META_SIGNATURE_HEADER,
  clientMetaPayload,
  normalizedIp,
  parseAppLocation,
  readClientMeta,
  sessionKindOf,
  USER_AGENT_MAX,
  webKeyUsable,
  type AppLocation,
  type AuditIpSource,
  type ClientMeta,
} from '@trendlix/shared';
import { tokenHash, verifySignedIp } from '../attendance/signed-ip.js';

// Where a request came from, for every audit entry it writes (owner, 31 October 2026: "with location and ip capture";
// the app's position: "Yes, with each sign-in and action"). Recorded, never trusted for a decision:
// - the address: the one the website (on Vercel) signed with WEB_KEY, as for a check-in's network lock (signed-ip.ts),
//   bound to the session token, or for a request without one (signing in, Forgot password) to the stand-in
//   ACCESS_IP_TOKEN; else the connection's own, as Caddy wrote it last in X-Forwarded-For (the app talks to the API
//   itself), marked 'connection'. A plain header naming an address counts for nothing;
// - the browser or app and the place: the visitor's user agent and Vercel's city, region and country, signed by the
//   website the same way in a header of their own (CLIENT_META_HEADER), so an older API ignores it; else the request's
//   own user agent (the app's) and no place: nothing is looked up anywhere else;
// - the phone's position: only from the app's own requests (its user agent, and its session's kind once known), as the
//   app sent it. Never from the website's.

type Headers = Record<string, string | string[] | undefined>;

/** Where a request came from, as its audit entries keep it. */
export interface AuditOrigin {
  ip: string | null;
  ipSource: AuditIpSource | null;
  country: string | null;
  region: string | null;
  city: string | null;
  userAgent: string | null;
  location: AppLocation | null;
}

const one = (h: Headers, name: string): string | undefined => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

/** The website's signed browser and place, if signed with `key` for `token` within a minute of `now`; else null. */
export function verifySignedMeta(headers: Headers, token: string, key: string | undefined, now: number): ClientMeta | null {
  if (!webKeyUsable(key)) return null;
  const encoded = one(headers, CLIENT_META_HEADER)?.trim();
  const signature = one(headers, CLIENT_META_SIGNATURE_HEADER)?.trim();
  if (!encoded || !signature || encoded.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
  const expected = Buffer.from(createHmac('sha256', key.trim()).update(clientMetaPayload(encoded, tokenHash(token))).digest('base64url'));
  const sent = Buffer.from(signature);
  if (expected.length !== sent.length || !timingSafeEqual(expected, sent)) return null;
  let meta: ClientMeta | null;
  try {
    meta = readClientMeta(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
  return meta && Math.abs(now - meta.at) <= CLIENT_IP_WINDOW_MS ? meta : null;
}

/** The connection's own address: the last X-Forwarded-For entry (Caddy's), else the socket's. */
export function connectionIp(headers: Headers, socketAddress: string | null | undefined): string | null {
  return normalizedIp(one(headers, 'x-forwarded-for')?.split(',').pop()?.trim()) ?? normalizedIp(socketAddress);
}

/** Where a request came from (above), from its headers, its session token (if any) and its socket's address. */
export function auditOriginOf(headers: Headers, token: string | undefined, key: string | undefined, now: number, socketAddress: string | null | undefined): AuditOrigin {
  const bound = token || ACCESS_IP_TOKEN;
  const signed = verifySignedIp(headers, bound, key, now);
  const meta = verifySignedMeta(headers, bound, key, now);
  const ownAgent = one(headers, 'user-agent')?.trim().slice(0, USER_AGENT_MAX) || null;
  const ip = signed.ip ?? connectionIp(headers, socketAddress);
  return {
    ip,
    ipSource: signed.ip ? 'website' : ip ? 'connection' : null,
    country: meta?.country ?? null,
    region: meta?.region ?? null,
    city: meta?.city ?? null,
    userAgent: meta ? (meta.ua ?? null) : ownAgent,
    // the app's own request (not one the website passed on): its position as it sent it
    location: !meta && !signed.ip && sessionKindOf(ownAgent) === 'app' ? parseAppLocation(one(headers, APP_LOCATION_HEADER)) : null,
  };
}
