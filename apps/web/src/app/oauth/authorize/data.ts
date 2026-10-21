import 'server-only';
import { headers } from 'next/headers';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import { originFromHeaders } from '@/lib/connector/site';

// What the Claude connector's sign-in and consent page asks the API (owner, 21 October 2026: "the connection method"),
// with the person's own session, and the site's origin the request came to (the issuer and the MCP address).

/** This site's origin, as the request reached it: https://people.trendlix.com. */
export async function siteOrigin(): Promise<string> {
  const origin = originFromHeaders(await headers());
  if (!origin) throw new Error('The site’s address could not be read from the request.');
  return origin;
}

export type Posted<T> = { kind: 'ok'; value: T } | { kind: 'signin' } | { kind: 'failed'; messages: string[] };

/** A POST with the person's session: the answer, "sign in again" (401), or the API's refusal in its words. */
export async function postWithSession<T>(path: string, body: unknown): Promise<Posted<T>> {
  let res: Response;
  try {
    res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', messages: err.messages };
    throw err;
  }
  if (res.status === 401) return { kind: 'signin' };
  if (res.status === 404) return { kind: 'failed', messages: ['The Claude connector isn’t on the server yet. Please try again after its next update.'] };
  if (!res.ok) return { kind: 'failed', messages: await messagesOf(res) };
  try {
    return { kind: 'ok', value: (await res.json()) as T };
  } catch {
    return { kind: 'failed', messages: ['The server sent an answer that could not be read.'] };
  }
}
