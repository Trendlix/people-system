// "Fill in with LinkedIn" on the careers forms (owner, 25 October 2026, on "Apply for This Job": "can i use linkedin to
// complete the data?"; told that LinkedIn's sign-in shares only a name, an email and a photo, never the work history,
// they chose "Sign in with LinkedIn" too, with "Fill the form from the CV"). LinkedIn's OpenID Connect sign-in (scopes
// openid profile email):
// - set up by a Super Admin in Organization → Hiring & Leaving → Recruitment Settings, "LinkedIn Sign-in": the app's
//   client ID and secret (the secret sealed, never sent back: only "set"), a switch, and the redirect URL to give
//   LinkedIn (the careers site's address, careers-base.ts, and /linkedin/callback); audited;
// - on both forms when it is on: the button goes to LinkedIn with a state bound to the form (a job's or "Send us your
//   CV") and to the browser, and a nonce; the website's callback has the API trade the code and read /v2/userinfo; the
//   person comes back to the same form with their name and email filled in where empty (they can change them);
// - LinkedIn's email_verified marks the email "Confirmed by LinkedIn": kept on the application or general CV as
//   email_confirmed_by = 'linkedin' while the email sent is the one LinkedIn gave; HR sees a small mark;
// - no account is made, nothing is kept but that mark, never the photo; no token is ever in an address or a log.
// Cancelled, failed or off: back to the form with a plain note; the form works as ever.
// The API: apps/api/src/recruitment/linkedin-signin.service.ts. The website: app/careers/linkedin/.

import { careersSiteUrl } from './careers-base.js';

/** The callback's path in the website (the redirect URL LinkedIn is given is the careers site's address and /linkedin/callback). */
export const LINKEDIN_CALLBACK_PATH = '/careers/linkedin/callback';

/** Where the form's button goes on the website (it asks the API for LinkedIn's address and sends the browser there). */
export const LINKEDIN_START_PATH = '/careers/linkedin/start';

/** The redirect URL for the careers site's address (careers-base.ts): "https://www.trendlix.com/en/careers/linkedin/callback". */
export const linkedinRedirectUri = (careersBase: string): string => careersSiteUrl(careersBase, { linkedinCallback: true });

export const LINKEDIN_SCOPES = 'openid profile email';
export const LINKEDIN_AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
export const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
/** The issuer of LinkedIn's ID tokens. */
export const LINKEDIN_ISSUER = 'https://www.linkedin.com/oauth';
/** The issuers LinkedIn's ID tokens have been seen with: its discovery's, and the bare site (29 October 2026). */
export const LINKEDIN_ISSUERS: readonly string[] = [LINKEDIN_ISSUER, 'https://www.linkedin.com'];

export const LINKEDIN_LIMITS = {
  clientId: 100,
  clientSecret: 200,
  /** The sign-in's state lasts this long (from the button to LinkedIn's answer). */
  stateMinutes: 10,
  /** What LinkedIn gave (the cookie, then the form's hidden field) lasts this long: time enough to fill the form. */
  resultMinutes: 120,
  /** Starts and returns from one address an hour, then refused. */
  perHour: 30,
} as const;

/** The httpOnly cookies on the website: the browser's half of the state, and what LinkedIn gave (read once). */
export const LINKEDIN_STATE_COOKIE = 'tl_linkedin_state';
export const LINKEDIN_RESULT_COOKIE = 'tl_linkedin';

/** What the website's signature of the address is bound to for the sign-in's start and return (their hourly limit). */
export const LINKEDIN_IP_TOKEN = 'careers-linkedin';

/** The form's field carrying what LinkedIn gave, sealed by the API, to the application (the email's mark). */
export const LINKEDIN_TICKET_FIELD = 'linkedinTicket';

/** The value of email_confirmed_by on an application or a general CV. */
export const EMAIL_CONFIRMED_BY = ['linkedin'] as const;
export type EmailConfirmedBy = (typeof EMAIL_CONFIRMED_BY)[number];
export const EMAIL_CONFIRMED_LABEL = 'Confirmed by LinkedIn';

// ---------- the form it is for ----------

/** A careers form: a job's (by its address) or "Send us your CV". */
export type LinkedInForm = { kind: 'job'; slug: string } | { kind: 'general' };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A form as written in the state and the address: "job:<slug>" or "general". */
export const linkedinFormKey = (form: LinkedInForm): string => (form.kind === 'general' ? 'general' : `job:${form.slug}`);

/** "job:<slug>" or "general" read back; null for anything else. */
export function linkedinFormOf(value: unknown): LinkedInForm | null {
  if (value === 'general') return { kind: 'general' };
  if (typeof value !== 'string' || !value.startsWith('job:')) return null;
  const slug = value.slice(4);
  return slug.length <= 90 && SLUG.test(slug) ? { kind: 'job', slug } : null;
}

/** The form's page: "/careers/<slug>" (its ?src= kept) or "/careers/general". */
export function linkedinFormPath(form: LinkedInForm, src?: string | null): string {
  if (form.kind === 'general') return '/careers/general';
  const source = src && /^[a-z_]{1,40}$/.test(src) && src !== 'careers' ? `?src=${src}` : '';
  return `/careers/${form.slug}${source}`;
}

/** The form's page at the careers site's address (careers-base.ts), its ?src= kept. */
export const linkedinFormHref = (careersBase: string, form: LinkedInForm, src?: string | null): string =>
  form.kind === 'general' ? careersSiteUrl(careersBase, { general: true }) : careersSiteUrl(careersBase, { slug: form.slug, src: src && /^[a-z_]{1,40}$/.test(src) ? src : null });

/** The address's word for how it went: ?linkedin=done, or the problem. */
export const LINKEDIN_RETURN_PARAM = 'linkedin';

export const LINKEDIN_PROBLEMS = ['cancelled', 'failed', 'off', 'expired', 'busy'] as const;
export type LinkedInProblem = (typeof LINKEDIN_PROBLEMS)[number];

/** The note on the form for each, in plain words; the form still works. */
export const LINKEDIN_PROBLEM_TEXT: Record<LinkedInProblem, string> = {
  cancelled: 'LinkedIn sign-in was cancelled. You can fill in the form yourself.',
  failed: 'We couldn’t get your details from LinkedIn. Please fill in the form yourself.',
  off: 'Fill in with LinkedIn isn’t available right now. Please fill in the form yourself.',
  expired: 'The LinkedIn sign-in took too long or was opened in another browser. Please try again, or fill in the form yourself.',
  busy: 'Too many LinkedIn sign-ins from your connection in the last hour. Please fill in the form yourself.',
};

export const isLinkedInProblem = (v: unknown): v is LinkedInProblem => typeof v === 'string' && (LINKEDIN_PROBLEMS as readonly string[]).includes(v);

// ---------- the API's answers ----------

/** POST /public/linkedin/start { form, src?, origin }: LinkedIn's sign-in address and the browser's half of the state. */
export type LinkedInStart = { ok: true; url: string; binding: string } | { ok: false; problem: LinkedInProblem };

/**
 * POST /public/linkedin/finish { state, binding, code?, error? }: the form to go back to, and what LinkedIn gave, sealed
 * (`ticket`: kept in the website's cookie, read once by the form); or the problem.
 */
export type LinkedInFinish =
  | { ok: true; form: string; src: string | null; ticket: string }
  | {
      ok: false;
      form: string | null;
      src: string | null;
      problem: LinkedInProblem;
      /**
       * Which step refused, for the website's log (29 October 2026: "the button is live but not filling anything"):
       * "token:401", "id_token:audience", "userinfo:403", "no_details"; never a name, an email, a code or a token.
       */
      reason?: string;
    };

/** POST /public/linkedin/open { ticket, form }: what the form fills in; null fields when LinkedIn didn't give them. */
export interface LinkedInDetails {
  fullName: string | null;
  email: string | null;
  /** LinkedIn's email_verified: the email shows "Confirmed by LinkedIn" while it is the one sent. */
  emailConfirmed: boolean;
  /** The sealed ticket again, for the form's hidden field (the application's email mark). */
  ticket: string;
}

// ---------- the settings (Recruitment Settings: "LinkedIn Sign-in") ----------

/** GET /recruitment/settings/linkedin (a Super Admin's): never the secret, only whether one is set. */
export interface LinkedInSettingsView {
  enabled: boolean;
  clientId: string | null;
  secretSet: boolean;
  /** The secret was sealed with another key (JWT_SECRET changed): paste it again. */
  secretUnreadable: boolean;
  /** On, with an ID and a secret that opens: the forms show the button. */
  ready: boolean;
  updatedAt: string | null;
  updatedBy: { email: string; name: string | null } | null;
}

/** PUT /recruitment/settings/linkedin: a field left out stays; an empty secret keeps the one set. */
export interface LinkedInSettingsInput {
  enabled?: boolean;
  clientId?: string | null;
  clientSecret?: string | null;
}

/** What is wrong with the settings, in words (once merged with what is kept). */
export function linkedinSettingsProblems(s: { enabled: boolean; clientId: string | null; secretSet: boolean }): string[] {
  const problems: string[] = [];
  const id = s.clientId?.trim() ?? '';
  if (id && (id.length > LINKEDIN_LIMITS.clientId || !/^[A-Za-z0-9_-]+$/.test(id))) problems.push('Paste the client ID as LinkedIn shows it: letters and digits.');
  if (s.enabled && !id) problems.push('Paste the client ID before switching LinkedIn sign-in on.');
  if (s.enabled && !s.secretSet) problems.push('Paste the client secret before switching LinkedIn sign-in on.');
  return problems;
}

/** The steps on the settings page, for the owner (LinkedIn Developer Portal, October 2026). */
export const LINKEDIN_SETUP_STEPS: readonly string[] = [
  'Open the LinkedIn Developer Portal (linkedin.com/developers) and choose Create app: the company’s LinkedIn page, a logo, and agree to the terms.',
  'On the app’s Products tab, add “Sign In with LinkedIn using OpenID Connect”.',
  'On its Auth tab, under Authorized redirect URLs for your app, add the redirect URL below exactly as shown.',
  'Copy the Client ID and the Primary Client Secret from the Auth tab, paste them here, switch it on and save.',
];
