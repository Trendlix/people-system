import { CAREERS_BASE_PATH, careersCookiePath, careersHref, LINKEDIN_AUTHORIZE_URL, LINKEDIN_RETURN_PARAM, linkedinFormHref, linkedinFormOf, type LinkedInProblem } from '@trendlix/shared';

// "Fill in with LinkedIn" on the careers forms (owner, 25 October 2026: "can i use linkedin to complete the data?";
// asked, "Sign in with LinkedIn"): where the sign-in's start and return send the browser, and their cookies' options,
// all from the careers pages' public address (lib/careers-base.ts: the main site's /careers once they move there, this
// site's /careers until then). The cookies are the host's own (no Domain), so they work on whichever host serves the
// page. Pure code (no "@/" imports), tested in prefill.test.ts.

/** The form's page with ?linkedin=done or the problem (its ?src= kept); the open roles when the form isn't known. */
export function linkedinReturnUrl(careersBase: string, formKey: string | null | undefined, src: string | null | undefined, value: 'done' | LinkedInProblem): URL {
  const form = linkedinFormOf(formKey);
  const url = new URL(form ? linkedinFormHref(careersBase, form, src) : careersHref(careersBase, CAREERS_BASE_PATH));
  url.searchParams.set(LINKEDIN_RETURN_PARAM, value);
  return url;
}

/** Only LinkedIn's own sign-in page, never an address the answer merely names. */
export const isLinkedInAuthorizeUrl = (url: unknown): url is string => typeof url === 'string' && url.startsWith(`${LINKEDIN_AUTHORIZE_URL}?`) && !/\s/.test(url);

/**
 * The cookies' options: httpOnly, Lax (they come with LinkedIn's top-level return), secure on https, host-only (no
 * Domain), for the careers pages' path and `under` it ("/careers", "/careers/linkedin").
 */
export const linkedinCookie = (careersBase: string, under: '' | '/linkedin', maxAge: number) =>
  ({ httpOnly: true, sameSite: 'lax', secure: careersBase.startsWith('https://'), path: careersCookiePath(careersBase, under), maxAge }) as const;

/** A route's answer: a redirect (303), never cached, its address never sent on as a referrer. */
export const NO_STORE = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } as const;
