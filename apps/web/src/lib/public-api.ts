import 'server-only';
import { API_URL, ApiError, messagesOf } from './api';
import { originHeaders } from './origin-headers';

// Calls to the API's public addresses (/api/public/...), for the pages people open without signing in: a candidate's
// job offer, from the link HR sends (owner's request, 15 October 2026). Never sends the session cookie, even when the
// visitor happens to be signed in, and never sends anyone to the sign-in page: a 401 or 404 is the page's to explain.

/** A public GET as the raw response, e.g. a file to stream on. Throws ApiError (503) when the API is unreachable. */
export async function publicFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  // a form sent (an application, an offer's answer): where the visitor is, signed, for the audit log (31 October 2026)
  if (init.method && init.method !== 'GET') for (const [name, value] of Object.entries(await originHeaders())) headers.set(name, value);
  try {
    return await fetch(`${API_URL}/api/public${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiError(503, ['Cannot reach the server. Please try again in a moment.']);
  }
}

export type PublicResult<T> = { ok: true; data: T } | { ok: false; status: number; messages: string[] };

/** A public GET: the answer, or its status and messages (404 for a link that isn't valid). Never throws for the API's answers. */
export async function publicGet<T>(path: string): Promise<PublicResult<T>> {
  let res: Response;
  try {
    res = await publicFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, status: err.status, messages: err.messages };
    throw err;
  }
  if (!res.ok) return { ok: false, status: res.status, messages: await messagesOf(res) };
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 502, messages: ['The server sent an answer that could not be read.'] };
  }
}

/** A public POST, for a form's action: throws ApiError with the API's messages. */
export async function publicSend<T = unknown>(path: string, body?: unknown): Promise<T | undefined> {
  const res = await publicFetch(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new ApiError(res.status, await messagesOf(res));
  return res.status === 204 || !res.headers.get('content-type')?.includes('json') ? undefined : ((await res.json()) as T);
}
