import 'server-only';
import { headers } from 'next/headers';
import { ACCESS_IP_TOKEN } from '@trendlix/shared';
import { clientIp } from './client-ip';
import { clientMetaHeaders, clientMetaOf, signedIpHeaders } from './signed-ip';

// Where the visitor is, signed for the API on every call this website makes for them (owner, 31 October 2026: "with
// location and ip capture"): their address, browser and place (lib/signed-ip.ts), bound to their session token, or for
// a call without one (signing in, Forgot password, the set-password page) to the stand-in ACCESS_IP_TOKEN. The API keeps
// them with every entry the call writes to the audit log, and the address still decides a check-in's network lock.
// Nothing outside a request (headers() refuses), and nothing without WEB_KEY.

/** The signed address, browser and place of the visitor this request is for. */
export async function originHeaders(token?: string): Promise<Record<string, string>> {
  let h: Awaited<ReturnType<typeof headers>>;
  try {
    h = await headers();
  } catch {
    return {};
  }
  const key = process.env.WEB_KEY;
  const bound = token || ACCESS_IP_TOKEN;
  return { ...signedIpHeaders(key, bound, clientIp(h)), ...clientMetaHeaders(key, bound, clientMetaOf(h)) };
}
