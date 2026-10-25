import { isLinkedInProblem, LINKEDIN_IP_TOKEN, LINKEDIN_LIMITS, LINKEDIN_RESULT_COOKIE, LINKEDIN_STATE_COOKIE, type LinkedInFinish } from '@trendlix/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { careersBaseOfRequest } from '@/lib/careers-base';
import { publicFetch } from '@/lib/public-api';
import { signedIpHeaders } from '@/lib/signed-ip';
import { linkedinCookie, linkedinReturnUrl, NO_STORE } from '../linkedin-return';

// The return from LinkedIn's sign-in (owner, 25 October 2026: "can i use linkedin to complete the data?"; asked, "Sign
// in with LinkedIn"): the redirect URL LinkedIn's app is given, the careers pages' address and /linkedin/callback.
// LinkedIn sends the browser back with a code and the state (or an error: cancelled); both go to the API with the
// browser's half of the state (its cookie, set by the start), which checks the state, trades the code on the server and
// reads LinkedIn's userinfo. What LinkedIn gave comes back sealed: kept in an httpOnly cookie for a few minutes, read once
// by the form (prefill-actions.ts takeLinkedIn), never in an address. Then the person is back on the same form, with
// ?linkedin=done or the problem. The address carries the code: never cached, never sent on as a referrer, and nothing of
// it is shown or logged.

const text = (v: string | null, max: number) => (v && v.length <= max ? v : null);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // the careers pages' public address (lib/careers-base.ts): the way back is there
  const careersBase = careersBaseOfRequest(request);
  const binding = request.cookies.get(LINKEDIN_STATE_COOKIE)?.value ?? '';
  const state = text(params.get('state'), 4000) ?? '';
  const code = text(params.get('code'), 2000);
  const error = text(params.get('error'), 100);
  const go = (url: URL) => {
    const res = NextResponse.redirect(url, 303);
    for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
    // the state's half is used once
    res.cookies.set(LINKEDIN_STATE_COOKIE, '', linkedinCookie(careersBase, '/linkedin', 0));
    return res;
  };
  let res: Response;
  try {
    res = await publicFetch('/linkedin/finish', {
      method: 'POST',
      body: JSON.stringify({ state, binding, ...(code && { code }), ...(error && { error }) }),
      headers: signedIpHeaders(process.env.WEB_KEY, LINKEDIN_IP_TOKEN, clientIp(request.headers)),
    });
  } catch {
    return go(linkedinReturnUrl(careersBase, null, null, 'failed'));
  }
  if (!res.ok) return go(linkedinReturnUrl(careersBase, null, null, res.status === 404 ? 'off' : res.status === 429 ? 'busy' : 'failed'));
  const finish = (await res.json().catch(() => null)) as LinkedInFinish | null;
  if (!finish) return go(linkedinReturnUrl(careersBase, null, null, 'failed'));
  if (!finish.ok) return go(linkedinReturnUrl(careersBase, finish.form, finish.src, isLinkedInProblem(finish.problem) ? finish.problem : 'failed'));
  if (typeof finish.ticket !== 'string' || !finish.ticket) return go(linkedinReturnUrl(careersBase, finish.form, finish.src, 'failed'));
  const out = go(linkedinReturnUrl(careersBase, finish.form, finish.src, 'done'));
  out.cookies.set(LINKEDIN_RESULT_COOKIE, finish.ticket, linkedinCookie(careersBase, '', Math.min(LINKEDIN_LIMITS.resultMinutes, 10) * 60));
  return out;
}
