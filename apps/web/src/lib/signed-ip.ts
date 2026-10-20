import { createHash, createHmac } from 'node:crypto';
import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, clientIpPayload, webKeyUsable } from '@trendlix/shared';

// The visitor's address, signed for the API (owner, 20 October 2026: check-ins locked to the office network, "allow me to
// lock checkin's to wifi name or ip, whatever is right"). The API is reachable by anyone with a session token, so it
// trusts no address a request merely names: the website signs the one it saw (lib/client-ip.ts) with the key it shares
// with the API (WEB_KEY: deploy/web-key.sh prints it on the server, saved in Vercel's project settings), an HMAC-SHA256
// over the address, the time and the SHA-256 of the session token it is sent with (packages/shared office-network.ts).
// The API checks the signature, the time (a minute either way) and the token (apps/api/src/attendance/signed-ip.ts).
// Sent only on the check-in's calls and Check-in Setup's (lib/api.ts, `signIp`). Without the key or an address, nothing
// is signed. Server code only (node:crypto); pure, tested; no "@/" imports.

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
