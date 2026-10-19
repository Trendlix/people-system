import { OFFER_STATUS_LABELS, TEMPLATE_SLOTS, type OfferShownStatus } from '@trendlix/shared';

// Previewing a template version with a real employee's data (owner's request, 15 October 2026: "When previewing a
// template, fetch any demo data already uploaded"): where the browser opens the filled version, where the people to
// choose from are read, and how each is offered. A job offer template is previewed with a job offer's data instead
// ("Job offer preview should call data from the offer tab, even if not published yet"), or an employee's while there
// is no offer of its employment type. Pure code (no server-only), tested.

/** Someone to preview a version with (GET /templates/versions/:id/preview-people), best first. */
export interface PreviewPerson {
  kind: 'employee';
  id: string;
  employeeCode: string;
  fullNameEn: string;
  employmentType: string | null;
  /** How many of the tags the version prints have a value for them, of `total`. */
  filled: number;
  total: number;
}

/** A job offer to preview a job offer template with, best first. */
export interface PreviewOffer {
  kind: 'offer';
  id: string;
  /** OFF-2026-0001 */
  number: string;
  fullNameEn: string;
  employmentType: string | null;
  /** As shown: a sent offer past its last day is expired. */
  status: string;
  /** How many of the tags the version prints have a value on it, of `total`. */
  filled: number;
  total: number;
}

/** Whose data a version can be previewed with. */
export type PreviewChoice = PreviewPerson | PreviewOffer;

// every job offer slot, by its folder: their keys stayed when the employment types changed (owner, 18 October 2026: one
// paid by commission is offer_sales; since 19 October 2026 an intern's, the unpaid internship, is offer_internship and a
// trainee's offer_trainee), so they don't all follow the types' names
const OFFER_SLOTS: readonly string[] = TEMPLATE_SLOTS.filter((s) => s.folder === 'job_offers').map((s) => s.key);

/** Whether a template is a job offer template (an employment type's, or paid by commission), previewed with job offers' data. */
export const isOfferSlot = (slotKey: string) => OFFER_SLOTS.includes(slotKey);

export const PREVIEW_HINT = "Filled with a real employee's data, nothing saved. Missing values show as [Field].";

/** The hint under a job offer template's previews. */
export const OFFER_PREVIEW_HINT = "Filled with a job offer's data (an employee's while there is no offer yet), nothing saved. Missing values show as [Field].";

/** The hint under a template's previews. */
export const previewHint = (slotKey: string) => (isOfferSlot(slotKey) ? OFFER_PREVIEW_HINT : PREVIEW_HINT);

const versionPath = (versionId: string) => `/templates/versions/${encodeURIComponent(versionId)}`;

/** The query parameter that names whose data to preview with: ?offerId= or ?employeeId=. */
export const choiceParam = (kind: PreviewChoice['kind']) => (kind === 'offer' ? 'offerId' : 'employeeId');

/**
 * Where the browser opens a version filled in with someone's data (the best choice when no one is chosen): a protected
 * PDF shown in a new tab, or saved (`download`); never a Word file (owner's request, 15 October 2026: "No doc file
 * export, just a protected PDF"). The web server fetches it from the API with the session.
 */
export function dataPreviewHref(versionId: string, chosen?: Pick<PreviewChoice, 'kind' | 'id'> | null, download = false): string {
  const query = new URLSearchParams();
  if (chosen?.id) query.set(choiceParam(chosen.kind), chosen.id);
  if (download) query.set('download', '1');
  const q = query.toString();
  return `${versionPath(versionId)}/preview${q ? `?${q}` : ''}`;
}

/** Where the template page reads the people to preview a version with, when asked. */
export const previewPeopleHref = (versionId: string) => `${versionPath(versionId)}/preview-people`;

/** "18 of 20 filled"; nothing for a version that prints no tags. */
const filledText = (p: Pick<PreviewChoice, 'filled' | 'total'>) => (p.total > 0 ? [`${p.filled} of ${p.total} filled`] : []);

/** "Omar Khaled · EMP-0001 · 18 of 20 filled"; without the count for a version that prints no tags. */
export function personOption(p: Pick<PreviewPerson, 'fullNameEn' | 'employeeCode' | 'filled' | 'total'>): string {
  return [p.fullNameEn, p.employeeCode, ...filledText(p)].join(' · ');
}

/** "OFF-2026-0001 · Omar Khaled · Draft · 9 of 10 filled"; without the count for a version that prints no tags. */
export function offerOption(o: Pick<PreviewOffer, 'number' | 'fullNameEn' | 'status' | 'filled' | 'total'>): string {
  const status = OFFER_STATUS_LABELS[o.status as OfferShownStatus] ?? o.status;
  return [o.number, o.fullNameEn, status, ...filledText(o)].join(' · ');
}

/** How a choice is offered in "Preview as". */
export const choiceOption = (c: PreviewChoice) => (c.kind === 'offer' ? offerOption(c) : personOption(c));

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const isText = (s: unknown): s is string => typeof s === 'string' && s !== '';

/**
 * The people (or job offers) in the API's answer, in its order; anything that isn't one is left out. An entry without
 * a kind is an employee, as the API sent them before job offers were offered.
 */
export function readPeople(body: unknown): PreviewChoice[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((x: unknown): PreviewChoice[] => {
    if (!x || typeof x !== 'object') return [];
    const p = x as Record<string, unknown>;
    if (!isText(p.id) || typeof p.fullNameEn !== 'string' || !isCount(p.filled) || !isCount(p.total)) return [];
    const employmentType = typeof p.employmentType === 'string' ? p.employmentType : null;
    if (p.kind === 'offer') {
      if (!isText(p.number) || !isText(p.status)) return [];
      return [{ kind: 'offer', id: p.id, number: p.number, fullNameEn: p.fullNameEn, employmentType, status: p.status, filled: p.filled, total: p.total }];
    }
    if ((p.kind !== undefined && p.kind !== 'employee') || typeof p.employeeCode !== 'string') return [];
    return [{ kind: 'employee', id: p.id, employeeCode: p.employeeCode, fullNameEn: p.fullNameEn, employmentType, filled: p.filled, total: p.total }];
  });
}
