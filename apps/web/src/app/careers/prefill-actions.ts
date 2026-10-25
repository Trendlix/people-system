'use server';

// The careers forms filled in (owner, 25 October 2026, on "Apply for This Job": "can i use linkedin to complete the
// data?"; asked, "Fill the form from the CV" and "Sign in with LinkedIn"):
// - readCv: the CV chosen at the top of the form, sent to the API's prefill (its text read there, never kept), with the
//   visitor's address signed with WEB_KEY for it (its hourly limit), as an application's is; what it found, or that it
//   couldn't be read (the form says so and still sends).
// - takeLinkedIn: what LinkedIn gave, from the httpOnly cookie the sign-in's return left (app/careers/linkedin/callback),
//   read once (the cookie is gone after), opened by the API for this form only: the name, the email, whether LinkedIn
//   confirmed it, and the sealed ticket the form sends with the application for the email's mark.
import { cookies, headers } from 'next/headers';
import {
  CAREERS_BASE_PATH,
  CV_PREFILL_IP_TOKEN,
  CV_PREFILL_LIMITS,
  isPortfolioKind,
  LINKEDIN_RESULT_COOKIE,
  linkedinFormOf,
  type CvPrefillResult,
  type LinkedInDetails,
  type PortfolioLinkKind,
} from '@trendlix/shared';
import { clientIp } from '@/lib/client-ip';
import { careersBaseFrom } from '@/lib/careers-base';
import { publicFetch } from '@/lib/public-api';
import { signedIpHeaders } from '@/lib/signed-ip';
import { linkedinCookie } from './linkedin/linkedin-return';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null);

/** The CV read for the form: what it found, or `failed` (no text, not a PDF or a Word file, too large, too many tries). */
export async function readCv(fd: FormData): Promise<CvPrefillResult | { failed: true }> {
  const cv = fd.get('cv');
  if (!(cv instanceof Blob) || cv.size === 0 || cv.size > CV_PREFILL_LIMITS.mb * 1024 * 1024) return { failed: true };
  const h = await headers();
  const ip = clientIp(h);
  const body = new FormData();
  body.set('cv', cv, cv instanceof File && cv.name ? cv.name : 'cv');
  if (ip) body.set('ip', ip);
  let res: Response;
  try {
    res = await publicFetch('/cv-prefill', { method: 'POST', body, headers: signedIpHeaders(process.env.WEB_KEY, CV_PREFILL_IP_TOKEN, ip) });
  } catch {
    return { failed: true };
  }
  if (!res.ok) return { failed: true };
  const said = (await res.json().catch(() => null)) as Partial<CvPrefillResult> | null;
  if (!said || said.read !== true) return { failed: true };
  const links = Array.isArray(said.portfolioLinks) ? said.portfolioLinks : [];
  return {
    read: true,
    fullName: str(said.fullName),
    email: str(said.email),
    mobile: str(said.mobile),
    linkedin: str(said.linkedin),
    portfolioLinks: links
      .filter((l): l is { url: string; kind: PortfolioLinkKind } => !!l && typeof l.url === 'string' && isPortfolioKind(l.kind) && (l.kind as string) !== 'pdf')
      .slice(0, CV_PREFILL_LIMITS.links)
      .map((l) => ({ url: l.url.slice(0, 300), kind: l.kind })),
    yearsExperience: typeof said.yearsExperience === 'number' && Number.isFinite(said.yearsExperience) ? said.yearsExperience : null,
  };
}

/** What LinkedIn gave this form, once: null without it (none, expired, another form's, or the API couldn't open it). */
export async function takeLinkedIn(formKey: string): Promise<LinkedInDetails | null> {
  if (!linkedinFormOf(formKey)) return null;
  const store = await cookies();
  const ticket = store.get(LINKEDIN_RESULT_COOKIE)?.value;
  if (!ticket) return null;
  // read once: gone whatever the API says
  // its path the careers pages' (lib/careers-base.ts), as the return set it
  const base = careersBaseFrom(await headers());
  store.set(LINKEDIN_RESULT_COOKIE, '', base ? linkedinCookie(base, '', 0) : { path: CAREERS_BASE_PATH, maxAge: 0, httpOnly: true, sameSite: 'lax', secure: true });
  let res: Response;
  try {
    res = await publicFetch('/linkedin/open', { method: 'POST', body: JSON.stringify({ ticket, form: formKey }) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const said = (await res.json().catch(() => null)) as Partial<LinkedInDetails> | null;
  if (!said) return null;
  return {
    fullName: str(said.fullName),
    email: str(said.email),
    emailConfirmed: said.emailConfirmed === true,
    ticket: typeof said.ticket === 'string' && said.ticket ? said.ticket : ticket,
  };
}
