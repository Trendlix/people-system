// The careers site's address, one base for every public careers link the system makes (25 October 2026: the careers
// pages moved to the main website, www.trendlix.com/en/careers, built by the owner's developer; people.trendlix.com/careers
// only redirects there now, apps/web/src/proxy.ts, kept for old links). The owner asked that the links stop relying on
// that redirect, so they are all built here from "Careers site address" in Recruitment Settings (HR and a Super Admin,
// audited; the standard https://www.trendlix.com/en/careers when unset): the invitation to apply's link, the vacancy's
// apply links per channel and "Open on the careers site", and LinkedIn's redirect URL. The job pages are <base>/<slug>
// (the API's slugs), "Send us your CV" <base>/general, the list <base> itself.
// Pure code, tested in apps/api/src/common/careers-base.spec.ts.

/** The careers site when Recruitment Settings set none (owner, 25 October 2026). */
export const CAREERS_SITE_STANDARD = 'https://www.trendlix.com/en/careers';

export const CAREERS_SITE_LIMITS = { address: 200 } as const;

/** An address with no query or fragment: http(s), a host, a port maybe, and a path of plain segments. */
const BASE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~-]+)*$/i;
const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?(?:\/|$)/i;
/** A host name of labels joined by dots, e.g. www.trendlix.com. */
const HOST = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:\/|$)/i;

const trimmed = (value: string): string => value.trim().replace(/\/+$/, '');
/** Trimmed, its scheme and host in lower case ("HTTPS://WWW.Trendlix.com/en/careers/" → "https://www.trendlix.com/en/careers"). */
const tidy = (value: string): string => trimmed(value).replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, (m) => m.toLowerCase());

/** Whether a text is a careers base: https (http only on this computer), a host, a path, no trailing slash, query or #. */
export const isCareersBase = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= CAREERS_SITE_LIMITS.address && BASE.test(value) && (value.startsWith('https://') || LOCAL.test(value));

/** What is wrong with the careers site's address as typed in Recruitment Settings, in words; null when it is fine. */
export function careersSiteProblem(value: string): string | null {
  const v = tidy(value);
  if (v.length > CAREERS_SITE_LIMITS.address) return `Keep the careers site’s address to ${CAREERS_SITE_LIMITS.address} characters or fewer.`;
  if (/[?#]/.test(v)) return 'Leave out the part from ? or # in the careers site’s address: the links add their own.';
  if (!v.startsWith('https://')) return `Write the careers site’s address in full, starting with https://, e.g. ${CAREERS_SITE_STANDARD}.`;
  if (!HOST.test(v) || !BASE.test(v)) return `Write the careers site’s address as its job list’s page, e.g. ${CAREERS_SITE_STANDARD}.`;
  return null;
}

/** The address as kept: trimmed, without a slash at its end, its scheme and host in lower case; null for an empty one (the standard). */
export const careersSiteValue = (value: string | null | undefined): string | null => (value && tidy(value) ? tidy(value) : null);

/**
 * The careers site in use: the address Recruitment Settings keep when it is one, else `fallback` (the website's
 * CAREERS_BASE_URL, for when the setting can't be read) when it is one, else the standard.
 */
export function careersSiteOf(stored?: string | null, fallback?: string | null): string {
  const set = careersSiteValue(stored);
  if (set && careersSiteProblem(set) === null) return set;
  const env = careersSiteValue(fallback);
  return env && isCareersBase(env) ? env : CAREERS_SITE_STANDARD;
}

/** A page of the careers site: a job's (its slug, and the ?src= of the link it came by), "Send us your CV", LinkedIn's return, or the list. */
export interface CareersSitePage {
  slug?: string;
  /** Where the job's link is posted (?src=): none, or "careers", for the page reached directly. */
  src?: string | null;
  general?: boolean;
  linkedinCallback?: boolean;
}

/**
 * A public careers link (owner, 25 October 2026: every one at the careers site's address): a job "<base>/<slug>?src=<src>",
 * "Send us your CV" "<base>/general", LinkedIn's redirect URL "<base>/linkedin/callback", else the list "<base>".
 */
export function careersSiteUrl(base: string, page: CareersSitePage = {}): string {
  const root = trimmed(base);
  if (page.slug) {
    const src = page.src && page.src !== 'careers' ? `?src=${encodeURIComponent(page.src)}` : '';
    return `${root}/${encodeURIComponent(page.slug)}${src}`;
  }
  if (page.general) return `${root}/general`;
  if (page.linkedinCallback) return `${root}/linkedin/callback`;
  return root;
}
