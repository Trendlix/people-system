import { isLinkedInProblem, LINKEDIN_IP_TOKEN, LINKEDIN_LIMITS, LINKEDIN_STATE_COOKIE, linkedinFormKey, linkedinFormOf, type LinkedInStart } from '@trendlix/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { careersBaseOfRequest } from '@/lib/careers-base';
import { originOfRequest } from '@/lib/connector/site';
import { publicFetch } from '@/lib/public-api';
import { signedIpHeaders } from '@/lib/signed-ip';
import { isLinkedInAuthorizeUrl, linkedinCookie, linkedinReturnUrl, NO_STORE } from '../linkedin-return';

// "Fill in with LinkedIn" (owner, 25 October 2026: "can i use linkedin to complete the data?"; asked, "Sign in with
// LinkedIn"): the form's button comes here (?form=job:<slug> or general, and its ?src=). The API seals the state (the
// form, a nonce, this site's redirect URL, ten minutes) and answers LinkedIn's sign-in address with the browser's half
// of the state, kept here in an httpOnly cookie for the return (app/careers/linkedin/callback), so the return is this
// browser's. Off, not set up or refused: back to the form with a plain note; the form works as ever. The visitor's
// address is signed with WEB_KEY for the API's hourly limit.

const go = (url: URL | string) => {
  const res = NextResponse.redirect(url, 303);
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
};

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const form = linkedinFormOf(params.get('form'));
  const src = params.get('src');
  const origin = originOfRequest(request);
  // the careers pages' public address (lib/careers-base.ts): LinkedIn's redirect URL and the way back are there
  const careersBase = careersBaseOfRequest(request);
  if (!form) return go(linkedinReturnUrl(careersBase, null, null, 'failed'));
  const formKey = linkedinFormKey(form);
  const back = (problem: Parameters<typeof linkedinReturnUrl>[3]) => go(linkedinReturnUrl(careersBase, formKey, src, problem));
  const ip = clientIp(request.headers);
  let res: Response;
  try {
    res = await publicFetch('/linkedin/start', {
      method: 'POST',
      body: JSON.stringify({ form: formKey, src: src && /^[a-z_]{1,40}$/.test(src) ? src : null, origin, careersBase }),
      headers: signedIpHeaders(process.env.WEB_KEY, LINKEDIN_IP_TOKEN, ip),
    });
  } catch {
    return back('failed');
  }
  // an API from before the sign-in has no such address: off
  if (res.status === 404) return back('off');
  if (res.status === 429) return back('busy');
  if (!res.ok) return back('failed');
  const start = (await res.json().catch(() => null)) as LinkedInStart | null;
  if (!start) return back('failed');
  if (!start.ok) return back(isLinkedInProblem(start.problem) ? start.problem : 'failed');
  if (!isLinkedInAuthorizeUrl(start.url) || typeof start.binding !== 'string' || !start.binding) return back('failed');
  const out = go(start.url);
  out.cookies.set(LINKEDIN_STATE_COOKIE, start.binding, linkedinCookie(careersBase, '/linkedin', LINKEDIN_LIMITS.stateMinutes * 60));
  return out;
}
