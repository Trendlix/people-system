import {
  portfolioPlatformLabel,
  portfolioPlatformOf,
  type CvPrefill,
  type LinkedInDetails,
  type PortfolioAsk,
  type PortfolioLinkKind,
} from '@trendlix/shared';

// The careers forms filled in for the person to check (owner, 25 October 2026, on "Apply for This Job": "can i use
// linkedin to complete the data?"; asked, "Fill the form from the CV" and "Sign in with LinkedIn"): what the CV gave
// (POST /public/cv-prefill) or LinkedIn gave (the name and the email) goes only into the fields still empty, never over
// what was typed; the CV's portfolio links into empty link boxes, those of a kind the position takes. And a typed link's
// platform, shown beside its box. Before going to LinkedIn the typed fields are kept in the tab (sessionStorage) and put
// back on return, into the fields still empty. Pure code (relative imports), tested in prefill.test.ts.

/** The fields a CV or LinkedIn fills in, as the forms name them. */
export const FILL_FIELDS = ['fullName', 'email', 'mobile', 'linkedin', 'yearsExperience'] as const;
export type FillField = (typeof FILL_FIELDS)[number];

/** Where a field's value came from: the CV, or LinkedIn. */
export type FillOrigin = 'cv' | 'linkedin';

export const FILL_ORIGIN_LABELS: Record<FillOrigin, string> = { cv: 'From your CV', linkedin: 'From LinkedIn' };

/** What a field holds now ('' when empty), and what was found for it ('' or left out: nothing). */
export type FieldValues<K extends string = string> = Partial<Record<K, string>>;

/** The fields to fill: only those empty now, with what was found for them (never one typed in). */
export function emptyFieldsPatch<K extends string>(current: FieldValues<K>, found: FieldValues<K>): FieldValues<K> {
  const out: FieldValues<K> = {};
  for (const [k, v] of Object.entries(found) as [K, string | undefined][]) {
    const value = typeof v === 'string' ? v.trim() : '';
    if (value && !(current[k] ?? '').trim()) out[k] = value;
  }
  return out;
}

/** What the CV gave, as the form's fields take it: the years as text ("4"). */
export function cvFieldValues(found: CvPrefill): FieldValues<FillField> {
  const out: FieldValues<FillField> = {};
  if (found.fullName) out.fullName = found.fullName;
  if (found.email) out.email = found.email;
  if (found.mobile) out.mobile = found.mobile;
  if (found.linkedin) out.linkedin = found.linkedin;
  if (typeof found.yearsExperience === 'number' && Number.isFinite(found.yearsExperience) && found.yearsExperience >= 0) out.yearsExperience = String(found.yearsExperience);
  return out;
}

/** What LinkedIn gave: the name and the email (never a photo). */
export function linkedinFieldValues(found: Pick<LinkedInDetails, 'fullName' | 'email'>): FieldValues<FillField> {
  const out: FieldValues<FillField> = {};
  if (found.fullName) out.fullName = found.fullName;
  if (found.email) out.email = found.email;
  return out;
}

/** Whether a position takes a link of this kind: listed, or any site when a personal website is taken. */
export const takesKind = (ask: PortfolioAsk, kind: PortfolioLinkKind): boolean => ask.kinds.includes(kind) || ask.kinds.includes('website');

/**
 * The portfolio's boxes with the CV's links put in the empty ones (and new boxes, up to the links allowed), those of a
 * kind the position takes and not typed already; and the boxes filled. Hidden, or no link kind taken: as they are.
 */
export function portfolioBoxesPatch(boxes: readonly string[], found: readonly { url: string; kind: PortfolioLinkKind }[], ask: PortfolioAsk): { boxes: string[]; filled: number[] } {
  const out = [...boxes];
  const filled: number[] = [];
  const linkKinds = ask.kinds.filter((k) => k !== 'pdf');
  if (ask.mode === 'hidden' || !linkKinds.length) return { boxes: out, filled };
  const max = Math.max(1, ask.maxLinks);
  const typed = new Set(out.map((b) => b.trim().toLowerCase()).filter(Boolean));
  for (const link of found) {
    if (!takesKind(ask, link.kind) || typed.has(link.url.toLowerCase())) continue;
    let at = out.findIndex((b, i) => i < max && !b.trim());
    if (at < 0 && out.length < max) at = out.length;
    if (at < 0) break;
    out[at] = link.url;
    filled.push(at);
    typed.add(link.url.toLowerCase());
  }
  return { boxes: out, filled };
}

/** A typed link's platform, as shown beside its box ("Vimeo", "Website"); '' while it isn't a link yet. */
export function platformLabelOf(typed: string): string {
  const t = typed.trim();
  if (!t || !portfolioPlatformOf(t)) return '';
  // a host without its ending yet ("vimeo") is no link
  if (!/^(?:https?:\/\/)?[^/\s]+\.[a-z]{2,}(?:[/?#]|$)/i.test(t)) return '';
  return portfolioPlatformLabel(t);
}

// ---------- the fields kept while the person signs in with LinkedIn ----------

/** The tab's key for a form's fields kept while away at LinkedIn. */
export const draftKey = (formKey: string): string => `careers-linkedin-draft:${formKey}`;

/** Fields never kept: the honeypot, the CV and the PDF (files can't be), LinkedIn's ticket. */
const NOT_KEPT = new Set(['website', 'cv', 'portfolioFile', 'linkedinTicket']);

/** The form's typed text fields, to keep while away (the ticks as "on"), and whether a CV was chosen (it must be again). */
export function draftOf(fd: FormData): { values: Record<string, string>; hadCv: boolean } {
  const values: Record<string, string> = {};
  for (const [name, v] of fd.entries()) {
    if (typeof v !== 'string' || NOT_KEPT.has(name) || name.startsWith('$')) continue;
    const t = v.trim();
    if (t && t.length <= 2000) values[name] = t;
  }
  const cv = fd.get('cv');
  return { values, hadCv: cv instanceof Blob && cv.size > 0 };
}

/** A kept draft read back; null for anything that isn't one. */
export function draftFrom(raw: string | null): { values: Record<string, string>; hadCv: boolean } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as { values?: unknown; hadCv?: unknown };
    if (!o.values || typeof o.values !== 'object' || Array.isArray(o.values)) return null;
    const values = Object.fromEntries(Object.entries(o.values as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
    return { values, hadCv: o.hadCv === true };
  } catch {
    return null;
  }
}

/** The address without ?linkedin= (once its note is shown or its details filled in), the rest kept. */
export function withoutLinkedInParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('linkedin');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** The form's "Fill in with LinkedIn" address: LinkedIn's start on the website, for this form (and its ?src=). */
export function linkedinStartHref(startPath: string, formKey: string, src: string | null | undefined): string {
  const params = new URLSearchParams({ form: formKey });
  if (src && /^[a-z_]{1,40}$/.test(src)) params.set('src', src);
  return `${startPath}?${params.toString()}`;
}
