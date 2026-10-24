import { isMeetingProvider, type MeetingConnectResult } from '@trendlix/shared';
import type { NextRequest } from 'next/server';
import { ApiError, apiFetch, signedOutPath } from '@/lib/api';
import { originOfRequest } from '@/lib/connector/site';
import { callbackInput, callbackTarget } from '@/lib/meetings';

// The return from a provider's sign-in (owner, 24 October 2026: "can i link an online meeting service provider to
// automatically generate meeting links?"; "make it both"): the redirect URI each provider's console is given,
// https://people.trendlix.com/meetings/oauth/<google|microsoft|zoom>. The provider sends the browser back here with a
// code and the state the API sealed (or an error); both go to the API with the person's own session (the session cookie
// is SameSite=Lax, so it comes with this top-level return), which checks the state is this person's, trades the code
// for the account's tokens and keeps them encrypted. Then the person is sent on to the page they started from, saying
// connected or why not, in the system's own words. The address carries the code: never cached, never sent on as a
// referrer, and nothing of it is shown or logged.

const answer = (status: number, location?: string) =>
  new Response(location ? null : 'Not found.', {
    status,
    headers: {
      ...(location ? { location } : { 'content-type': 'text/plain; charset=utf-8' }),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });

export async function GET(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isMeetingProvider(provider)) return answer(404);
  const origin = originOfRequest(request);
  const go = (path: string) => answer(303, new URL(path, origin).toString());
  let res: Response;
  try {
    res = await apiFetch('/meetings/oauth/finish', { method: 'POST', body: JSON.stringify({ provider, ...callbackInput(request.nextUrl.searchParams) }) });
  } catch (err) {
    if (err instanceof ApiError) return go(callbackTarget(null, provider, 'unreachable'));
    throw err;
  }
  if (res.status === 401) return go(await signedOutPath(res));
  if (res.status === 404) return go(callbackTarget(null, provider, 'unreachable'));
  if (res.status === 403) return go(callbackTarget(null, provider, 'not_allowed'));
  if (!res.ok) return go(callbackTarget(null, provider, 'refused'));
  let result: MeetingConnectResult | null = null;
  try {
    result = (await res.json()) as MeetingConnectResult;
  } catch {
    result = null;
  }
  return go(callbackTarget(result, provider, 'refused'));
}
