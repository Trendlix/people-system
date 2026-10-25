import type { ZohoPeopleConnectResult } from '@trendlix/shared';
import type { NextRequest } from 'next/server';
import { ApiError, apiFetch, signedOutPath } from '@/lib/api';
import { calendarCallbackInput } from '@/lib/calendars';
import { originOfRequest } from '@/lib/connector/site';
import { zohoPeopleCallbackTarget } from '@/lib/zoho-people';

// The return from Zoho's sign-in for Zoho People (owner, 25 October 2026: "Yes, daily + backfill": "a Super Admin connects
// Zoho once"): the second redirect URI on the shared Zoho app, https://people.trendlix.com/zoho-people/oauth. Zoho sends
// the browser back here with a code and the state the API sealed (or an error), and the sign-in address of the
// account's data centre (`accounts-server`); they go to the API with the person's own session (the session cookie is
// SameSite=Lax, so it comes with this top-level return), which checks the state is this Super Admin's, trades the code
// for the account's tokens and keeps them encrypted. Then the person is sent on to Organization → Zoho People, saying
// connected or why not, in the system's own words. The address carries the code: never cached, never sent on as a
// referrer, and nothing of it is shown or logged. As the calendars' return (calendars/oauth/[provider]/route.ts).

const answer = (status: number, location: string) =>
  new Response(null, { status, headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });

export async function GET(request: NextRequest) {
  const origin = originOfRequest(request);
  const go = (path: string) => answer(303, new URL(path, origin).toString());
  let res: Response;
  try {
    res = await apiFetch('/zoho-people/oauth/finish', { method: 'POST', body: JSON.stringify(calendarCallbackInput(request.nextUrl.searchParams)) });
  } catch (err) {
    if (err instanceof ApiError) return go(zohoPeopleCallbackTarget(null, 'unreachable'));
    throw err;
  }
  if (res.status === 401) return go(await signedOutPath(res));
  if (res.status === 404) return go(zohoPeopleCallbackTarget(null, 'unreachable'));
  if (res.status === 403) return go(zohoPeopleCallbackTarget(null, 'not_allowed'));
  if (!res.ok) return go(zohoPeopleCallbackTarget(null, 'refused'));
  let result: ZohoPeopleConnectResult | null = null;
  try {
    result = (await res.json()) as ZohoPeopleConnectResult;
  } catch {
    result = null;
  }
  return go(zohoPeopleCallbackTarget(result, 'refused'));
}
