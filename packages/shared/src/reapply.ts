// Applying again for the same job (owner, 25 October 2026: "if an employee updated the cv and reapplied, how will he be
// treated in the system?"; asked, "Update their application"): the same person (the rule that finds them: the email, or
// their candidate profile by email or mobile) applying again on the careers page for a job whose application is still
// open updates that one application instead of being refused:
// - the new CV becomes current, every earlier one kept with its date (Earlier CVs), read again and its fit worked out
//   again; the same file sent again is no new CV (nothing kept twice, nothing read again);
// - what they sent is updated (name, mobile, links, portfolio, years, notice, salary, WhatsApp) and the answers scored
//   again; the email they first applied with stays the application's (a new one joins their candidate profile);
// - a step "Updated by the candidate" says what changed, HR is told ("CV updated"), the applicant is told "We've
//   updated your application", and the API answers { reference, updated: true }.
// Open: Applied, Shortlisted, Interview or Offer, with no job offer accepted and no profile made from it (an offer
// declined or withdrawn takes it back to Shortlisted: open again; an application has no withdrawn stage of its own).
// Closed (Rejected, Hired, an offer accepted): refused in words (APPLICATION_CLOSED). Pure code: the API applies it,
// tested in apps/api/src/common/reapply.spec.ts.

import type { ApplicationStage } from './recruitment.js';

/** The careers page's refusal of applying again for a job whose application is closed (rejected, hired). */
export const APPLICATION_CLOSED = 'Your application for this job is closed. You can apply for other jobs.';

/** The stages at which applying again updates the application. */
export const REAPPLY_OPEN_STAGES = ['applied', 'shortlisted', 'interview', 'offer'] as const satisfies readonly ApplicationStage[];

/** An application as the rule reads it: its stage, the profile made from it, its job offers' statuses. */
export interface ReapplyTarget {
  stage: string;
  employeeId?: string | null;
  offers?: readonly { status: string }[];
}

/**
 * What applying again does: 'update' while the application is open (Applied, Shortlisted, Interview, Offer, no offer
 * accepted, no profile made from it); 'closed' once Rejected or Hired (or an offer accepted, a moment before Hired).
 */
export function reapplyOutcome(a: ReapplyTarget): 'update' | 'closed' {
  if (!(REAPPLY_OPEN_STAGES as readonly string[]).includes(a.stage)) return 'closed';
  if (a.employeeId) return 'closed';
  if ((a.offers ?? []).some((o) => o.status === 'accepted')) return 'closed';
  return 'update';
}

/** How the must-have questions changed the application: filtered out now, no longer, still failed with HR's decision kept, or nothing. */
export type ReapplyFilterChange = 'now_filtered' | 'no_longer_filtered' | 'kept_by_hr' | null;

/**
 * Whether the updated application is filtered out by a must-have question, by its new answers' knockouts:
 * - still at Applied and never restored by HR: as the new answers say (filtered out now, or no longer, both kept in its
 *   history);
 * - once HR moved them on (Shortlisted, Interview, Offer) or restored them after a must-have (at Applied, not filtered
 *   out with knockouts kept): HR's decision stands, never filtered out by itself; the must-haves not met now are told in
 *   the step (kept_by_hr), for HR to decide.
 */
export function reapplyFilter(before: { stage: string; filteredOut: boolean; knockedOut: readonly string[] }, knockedOut: readonly string[]): { filteredOut: boolean; change: ReapplyFilterChange } {
  const hrDecided = before.stage !== 'applied' || (!before.filteredOut && before.knockedOut.length > 0);
  if (hrDecided) return { filteredOut: before.filteredOut, change: knockedOut.length > 0 && !before.filteredOut ? 'kept_by_hr' : null };
  const filteredOut = knockedOut.length > 0;
  return { filteredOut, change: filteredOut && !before.filteredOut ? 'now_filtered' : !filteredOut && before.filteredOut ? 'no_longer_filtered' : null };
}

/** What an application holds of what was sent, as compared when they apply again. */
export interface ReapplySent {
  fullName: string;
  mobile: string;
  linkedin: string | null;
  portfolioLinks: readonly string[];
  /** A PDF case study sent with it (the new one replaces the earlier; none sent keeps it). */
  portfolioFile: boolean;
  yearsExperience: number | null;
  noticePeriod: string | null;
  expectedSalary: number | null;
  answers: Readonly<Record<string, unknown>>;
  /** "Send me updates about my application on WhatsApp" ticked, and its language. */
  whatsapp: boolean;
  whatsappLanguage: string | null;
}

export const REAPPLY_FIELDS = ['fullName', 'mobile', 'linkedin', 'portfolio', 'yearsExperience', 'noticePeriod', 'expectedSalary', 'answers', 'whatsapp'] as const;
export type ReapplyField = (typeof REAPPLY_FIELDS)[number];

/** Each changed field as the step names it (never its value: the step is read by the hiring manager too). */
export const REAPPLY_FIELD_LABELS: Record<ReapplyField, string> = {
  fullName: 'name',
  mobile: 'mobile',
  linkedin: 'LinkedIn',
  portfolio: 'portfolio',
  yearsExperience: 'years of experience',
  noticePeriod: 'notice period',
  expectedSalary: 'expected salary',
  answers: 'answers',
  whatsapp: 'WhatsApp updates',
};

const sameAnswers = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (String(a[k] ?? '') !== String(b[k] ?? '')) return false;
  return true;
};

/** The fields they changed by applying again, in the order of REAPPLY_FIELDS. */
export function reapplyChanges(before: ReapplySent, after: ReapplySent): ReapplyField[] {
  const changed: Record<ReapplyField, boolean> = {
    fullName: before.fullName !== after.fullName,
    mobile: before.mobile !== after.mobile,
    linkedin: (before.linkedin ?? null) !== (after.linkedin ?? null),
    portfolio: before.portfolioLinks.join('\n') !== after.portfolioLinks.join('\n') || after.portfolioFile,
    yearsExperience: (before.yearsExperience ?? null) !== (after.yearsExperience ?? null),
    noticePeriod: (before.noticePeriod ?? null) !== (after.noticePeriod ?? null),
    expectedSalary: (before.expectedSalary ?? null) !== (after.expectedSalary ?? null),
    answers: !sameAnswers(before.answers, after.answers),
    whatsapp: before.whatsapp !== after.whatsapp || (after.whatsapp && (before.whatsappLanguage ?? 'en') !== (after.whatsappLanguage ?? 'en')),
  };
  return REAPPLY_FIELDS.filter((f) => changed[f]);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The step's note: "New CV. Changed: mobile, answers (match 60% → 100%). Now filtered out: 1 must-have question not
 * met. Sent from LinkedIn this time." (`sourceLabel`: this submission's source in words, when it differs from the
 * application's; `stageLabel`: where HR has them, for a must-have now failed while HR's decision stands.)
 */
export function reapplyNote(x: {
  newCv: boolean;
  changed: readonly ReapplyField[];
  match: { from: number | null; to: number | null };
  filter: ReapplyFilterChange;
  knockedOut: number;
  stageLabel: string;
  sourceLabel: string | null;
}): string {
  const parts: string[] = [x.newCv ? 'New CV.' : 'Same CV.'];
  if (x.changed.length) {
    const matchMoved = x.changed.includes('answers') && x.match.from !== x.match.to && (x.match.from !== null || x.match.to !== null);
    const list = x.changed.map((f) => (f === 'answers' && matchMoved ? `answers (match ${x.match.from ?? '—'}% → ${x.match.to ?? '—'}%)` : REAPPLY_FIELD_LABELS[f]));
    parts.push(`Changed: ${list.join(', ')}.`);
  } else if (!x.newCv) parts.push('Nothing else changed.');
  if (x.filter === 'now_filtered') parts.push(`Now filtered out: ${plural(x.knockedOut, 'must-have question', 'must-have questions')} not met.`);
  if (x.filter === 'no_longer_filtered') parts.push('No longer filtered out: every must-have question met.');
  if (x.filter === 'kept_by_hr') parts.push(`${sentence(plural(x.knockedOut, 'must-have question', 'must-have questions'))} not met; kept at ${x.stageLabel} (HR decides).`);
  if (x.sourceLabel) parts.push(`Sent from ${x.sourceLabel} this time.`);
  return parts.join(' ');
}

// ---------- what HR sees ----------

/** The "CV updated" mark on the board and the lists, for this many days after the new CV came. */
export const CV_UPDATED_MARK_DAYS = 7;
export const CV_UPDATED_LABEL = 'CV updated';

/** Whether a new CV came in the last 7 days (the mark); never for a time to come. */
export function cvUpdatedMark(cvUpdatedAt: string | Date | null | undefined, now: Date | number = Date.now()): boolean {
  if (!cvUpdatedAt) return false;
  const at = new Date(cvUpdatedAt).getTime();
  const t = new Date(now).getTime();
  return Number.isFinite(at) && at <= t && t - at < CV_UPDATED_MARK_DAYS * 86_400_000;
}

/** An earlier CV of an application, as its page and the CV window list it (its file at …/applications/:id/earlier-cvs/:cvId). */
export interface EarlierCvView {
  id: string;
  /** The file's name (hidden from a developer, as the CV's is: it often carries the person's name). */
  cvFileName: string;
  mimeType: string;
  sizeBytes: number;
  /** When it was sent, and when a newer one replaced it. */
  sentAt: string;
  replacedAt: string;
}
