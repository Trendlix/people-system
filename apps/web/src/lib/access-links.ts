import 'server-only';
import { headers } from 'next/headers';
import { ACCESS_IP_TOKEN } from '@trendlix/shared';
import { API_URL, messagesOf } from './api';
import { clientIp } from './client-ip';
import { signedIpHeaders } from './signed-ip';

// The set-password page's and Forgot password's calls to the API (owner, 22 October 2026: "Set-password link"): its
// public /auth addresses, never with the session cookie, the token always in the body (never in a path a log keeps),
// and the visitor's address signed with WEB_KEY, which the API counts its limits by.

export type AccessCall<T> = { ok: true; data: T } | { ok: false; status: number; messages: string[] };

export async function accessPost<T>(path: '/auth/password-link/check' | '/auth/password-link' | '/auth/forgot-password', body: unknown): Promise<AccessCall<T>> {
  const signed = signedIpHeaders(process.env.WEB_KEY, ACCESS_IP_TOKEN, clientIp(await headers()));
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signed },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503, messages: ['Cannot reach the server. Please try again in a moment.'] };
  }
  if (!res.ok) return { ok: false, status: res.status, messages: await messagesOf(res) };
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 502, messages: ['The server sent an answer that could not be read.'] };
  }
}
