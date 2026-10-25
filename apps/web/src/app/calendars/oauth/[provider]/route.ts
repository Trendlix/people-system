import { isCalendarProvider, type CalendarConnectResult } from '@trendlix/shared';
import type { NextRequest } from 'next/server';
import { ApiError, apiFetch, signedOutPath } from '@/lib/api';
import { calendarCallbackInput, calendarCallbackTarget } from '@/lib/calendars';
import { originOfRequest } from '@/lib/connector/site';

// The return from a calendar's sign-in (owner, 25 October 2026: "Hours + calendar"; "its zoho mails"): the redirect URI
// each console is given, https://people.trendlix.com/calendars/oauth/<zoho|google|microsoft>. The provider sends the
// browser back here with a code and the state the API sealed (or an error), and Zoho with the sign-in address of the
// account's data centre (`accounts-server`); they go to the API with the person's own session (the session cookie is
// SameSite=Lax, so it comes with this top-level return), which checks the state is this person's, trades the code for
// the account's tokens and keeps them encrypted. Then the person is sent on to the page they started from, saying
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
  if (!isCalendarProvider(provider)) return answer(404);
  const origin = originOfRequest(request);
  const go = (path: string) => answer(303, new URL(path, origin).toString());
  let res: Response;
  try {
    res = await apiFetch('/calendars/oauth/finish', { method: 'POST', body: JSON.stringify({ provider, ...calendarCallbackInput(request.nextUrl.searchParams) }) });
  } catch (err) {
    if (err instanceof ApiError) return go(calendarCallbackTarget(null, provider, 'unreachable'));
    throw err;
  }
  if (res.status === 401) return go(await signedOutPath(res));
  if (res.status === 404) return go(calendarCallbackTarget(null, provider, 'unreachable'));
  if (res.status === 403) return go(calendarCallbackTarget(null, provider, 'not_allowed'));
  if (!res.ok) return go(calendarCallbackTarget(null, provider, 'refused'));
  let result: CalendarConnectResult | null = null;
  try {
    result = (await res.json()) as CalendarConnectResult;
  } catch {
    result = null;
  }
  return go(calendarCallbackTarget(result, provider, 'refused'));
}
