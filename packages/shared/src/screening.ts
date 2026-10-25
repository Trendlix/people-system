// Screening comments (owner, 24 October 2026, on a candidate's profile: "is there a way to add screening comments?", then
// "and i can add genearrl comments"; asked, the verdict "Yes: Good fit / Maybe / Not a fit" and who "HR + hiring manager
// & interviewers"). A comment is about one of a candidate's applications or general CVs, or about the person in general;
// it may carry a verdict, and it may @mention colleagues, who are told:
// - HR, the CEO and a Super Admin read and write on every candidate, but a C-level vacancy's applications, which stay
//   the CEO's and a Super Admin's (as the applicants themselves);
// - a vacancy's hiring manager and its interviewers read and write only on the applications they open today (the hiring
//   manager from Shortlisted on, an interviewer those they interview), their comments marked with their role; never the
//   general comments, the general CVs, another vacancy's comments, nor the candidate's profile;
// - the author edits their own comment for 24 hours ("edited" shown); only a Super Admin deletes one;
// - the latest verdict (the newest comment with one) shows as a badge and filters the lists; per application from its
//   own comments only (the general ones don't count), per candidate across everything the caller may see. It never
//   moves a stage by itself.
// HR's single notes box of before (an application's, a general CV's) became each record's first comment, "HR (earlier
// notes)". Pure code: the API enforces it (apps/api/src/recruitment/screening-comments.service.ts), the web shows it.
// Tested in apps/api/src/common/screening.spec.ts.

import type { CandidateCv } from './candidates.js';
import type { CvFit, OpenPositionFit } from './cv-fit.js';
import type { RecruitmentUserRef } from './recruitment.js';

// ---------- the verdict ----------

export const SCREENING_VERDICTS = ['good_fit', 'maybe', 'not_a_fit'] as const;
export type ScreeningVerdict = (typeof SCREENING_VERDICTS)[number];

export const SCREENING_VERDICT_LABELS: Record<ScreeningVerdict, string> = { good_fit: 'Good fit', maybe: 'Maybe', not_a_fit: 'Not a fit' };

export const isScreeningVerdict = (value: unknown): value is ScreeningVerdict => (SCREENING_VERDICTS as readonly unknown[]).includes(value);

/** The lists' Verdict filter: a verdict, or `none` (no verdict yet). Any: no filter. */
export const VERDICT_FILTERS = [...SCREENING_VERDICTS, 'none'] as const;
export type VerdictFilter = (typeof VERDICT_FILTERS)[number];

export const VERDICT_FILTER_LABELS: Record<VerdictFilter, string> = { ...SCREENING_VERDICT_LABELS, none: 'None yet' };

export const isVerdictFilter = (value: unknown): value is VerdictFilter => (VERDICT_FILTERS as readonly unknown[]).includes(value);

/** Whether a latest verdict (null: none yet) passes the filter (none given: everything does). */
export const verdictMatches = (filter: VerdictFilter | null | undefined, verdict: ScreeningVerdict | null | undefined): boolean =>
  !filter || (filter === 'none' ? !verdict : verdict === filter);

/** A comment as the latest verdict reads it. */
export interface VerdictRow {
  id: string;
  verdict: string | null;
  createdAt: Date | string;
}

const time = (d: Date | string) => (typeof d === 'string' ? Date.parse(d) : d.getTime());

/** The newer of two comments: by when it was written (not edited), then by id, so ties always fall the same way. */
const newer = (a: VerdictRow, b: VerdictRow): boolean => time(a.createdAt) > time(b.createdAt) || (time(a.createdAt) === time(b.createdAt) && a.id > b.id);

/** The latest verdict of these comments: the newest one with a verdict; null when none has one. */
export function latestVerdict(rows: readonly VerdictRow[]): ScreeningVerdict | null {
  let best: VerdictRow | null = null;
  for (const r of rows) if (isScreeningVerdict(r.verdict) && (!best || newer(r, best))) best = r;
  return best ? (best.verdict as ScreeningVerdict) : null;
}

/** The latest verdict of each group of comments (`keyOf`: its group; null: left out), e.g. each application's. */
export function latestVerdictsBy<R extends VerdictRow, K>(rows: readonly R[], keyOf: (row: R) => K | null): Map<K, ScreeningVerdict> {
  const best = new Map<K, R>();
  for (const r of rows) {
    if (!isScreeningVerdict(r.verdict)) continue;
    const key = keyOf(r);
    if (key === null) continue;
    const was = best.get(key);
    if (!was || newer(r, was)) best.set(key, r);
  }
  return new Map([...best].map(([k, r]) => [k, r.verdict as ScreeningVerdict]));
}

/** The latest verdict of each application: from its own comments only (a general comment isn't about it). */
export const applicationVerdicts = <R extends VerdictRow & { applicationId: string | null }>(rows: readonly R[]) => latestVerdictsBy(rows, (r) => r.applicationId);

/** The latest verdict of each candidate: across every comment of theirs given (those the caller may see). */
export const candidateVerdicts = <R extends VerdictRow & { candidateId: string }>(rows: readonly R[]) => latestVerdictsBy(rows, (r) => r.candidateId);

// ---------- who writes ----------

/** The author's role when they wrote it. */
export const SCREENING_AUTHOR_ROLES = ['hr', 'ceo', 'super_admin', 'hiring_manager', 'interviewer'] as const;
export type ScreeningAuthorRole = (typeof SCREENING_AUTHOR_ROLES)[number];

export const SCREENING_AUTHOR_ROLE_LABELS: Record<ScreeningAuthorRole, string> = {
  hr: 'HR',
  ceo: 'CEO',
  super_admin: 'Super Admin',
  hiring_manager: 'Hiring manager',
  interviewer: 'Interviewer',
};

/**
 * The role a reader of recruitment writes as, by the roles they hold: the CEO, else a Super Admin, else HR; null for
 * anyone else (a hiring manager or an interviewer is told by the application they write on).
 */
export function readerRoleOf(roles: readonly string[]): ScreeningAuthorRole | null {
  if (roles.includes('ceo')) return 'ceo';
  if (roles.includes('super_admin')) return 'super_admin';
  if (roles.includes('hr')) return 'hr';
  return null;
}

/** Who wrote HR's notes of before, moved into a first comment (no author of their own). */
export const EARLIER_NOTES_AUTHOR = 'HR (earlier notes)';

// ---------- what it is about ----------

export const SCREENING_ABOUT_KINDS = ['general', 'application', 'general_cv'] as const;
export type ScreeningAboutKind = (typeof SCREENING_ABOUT_KINDS)[number];

/** What a comment is about: the person in general, or one of their applications (APP-… for a job) or general CVs. */
export interface ScreeningAbout {
  kind: ScreeningAboutKind;
  /** The application's or the general CV's id; null for a general comment. */
  id: string | null;
  /** Its reference (APP-2026-0001); null for a general comment. */
  reference: string | null;
  /** The vacancy's title for an application; null otherwise. */
  title: string | null;
}

/** A comment's or a CV's key: "general", "application:<id>" or "general_cv:<id>". */
export const aboutKey = (a: { kind: ScreeningAboutKind; id: string | null }): string => (a.kind === 'general' || !a.id ? 'general' : `${a.kind}:${a.id}`);

export const GENERAL_KEY = 'general';
export const applicationKey = (id: string) => `application:${id}`;
export const generalCvKey = (id: string) => `general_cv:${id}`;

/** The chip of what it is about: "General", "APP-2026-0001 · Video Editor", "General CV APP-2026-0007". */
export function aboutLabel(a: ScreeningAbout): string {
  if (a.kind === 'general') return 'General';
  if (a.kind === 'general_cv') return a.reference ? `General CV ${a.reference}` : 'General CV';
  return [a.reference, a.title].filter(Boolean).join(' · ') || 'Application';
}

// ---------- the rules of a comment ----------

export const SCREENING_LIMITS = {
  /** A comment's text, in characters. */
  text: 2000,
  /** Colleagues mentioned in one comment. */
  mentions: 20,
} as const;

/** How long the author may edit their comment. */
export const SCREENING_EDIT_HOURS = 24;

/** Until when a comment written at `createdAt` may be edited. */
export const editableUntil = (createdAt: Date | string): Date => new Date(time(createdAt) + SCREENING_EDIT_HOURS * 3_600_000);

/** Whether `userId` may edit the comment now: their own (an earlier note has no author), within 24 hours of writing it. */
export function canEditComment(c: { authorId: string | null; createdAt: Date | string }, userId: string, now: Date = new Date()): boolean {
  return !!c.authorId && c.authorId === userId && now.getTime() < editableUntil(c.createdAt).getTime();
}

/** What is written: the text, an optional verdict, the colleagues mentioned (their user ids). */
export interface ScreeningCommentInput {
  comment?: string | null;
  verdict?: string | null;
  mentions?: readonly string[] | null;
}

/** What is wrong with a comment, each in words: some text (at most 2,000 characters), a verdict of the three or none, at most 20 mentions. */
export function screeningCommentProblems(input: ScreeningCommentInput): string[] {
  const out: string[] = [];
  const text = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (!text) out.push('Write the comment.');
  else if (text.length > SCREENING_LIMITS.text) out.push(`Keep the comment to ${SCREENING_LIMITS.text.toLocaleString('en-US')} characters or fewer.`);
  if (input.verdict !== undefined && input.verdict !== null && input.verdict !== '' && !isScreeningVerdict(input.verdict)) out.push('Choose Good fit, Maybe or Not a fit, or no verdict.');
  if (input.mentions && input.mentions.length > SCREENING_LIMITS.mentions) out.push(`Mention at most ${SCREENING_LIMITS.mentions} people in one comment.`);
  return out;
}

/** The mentions kept: each once, in the order given. */
export const uniqueMentions = (ids: readonly string[] | null | undefined): string[] => [...new Set((ids ?? []).filter((x) => typeof x === 'string' && x))];

/** Those mentioned who may not read the comment (so may not be mentioned): the API refuses the comment, naming them. */
export const refusedMentions = (mentions: readonly string[], mayRead: ReadonlySet<string>): string[] => mentions.filter((id) => !mayRead.has(id));

/** The newly mentioned of an edit: told; those mentioned before aren't told again. */
export const newlyMentioned = (before: readonly string[], after: readonly string[]): string[] => after.filter((id) => !before.includes(id));

// ---------- what the API answers ----------

/** A colleague who may be mentioned (they may read the comment): their account, name and role. */
export interface ScreeningPerson {
  /** Their user (sign-in account) id: what a mention keeps. */
  id: string;
  name: string;
  email: string;
  role: ScreeningAuthorRole;
}

/** A screening comment. */
export interface ScreeningCommentView {
  id: string;
  candidateId: string;
  about: ScreeningAbout;
  /** "General", "APP-2026-0001 · Video Editor", "General CV APP-2026-0007". */
  aboutLabel: string;
  /** Who wrote it; null for HR's earlier notes (authorLabel) or an account since removed. */
  author: RecruitmentUserRef | null;
  /** "HR (earlier notes)" when there is no author. */
  authorLabel: string | null;
  /** Their role when they wrote it; null for the earlier notes. */
  authorRole: ScreeningAuthorRole | null;
  /** The text (hidden from a developer). */
  comment: string;
  verdict: ScreeningVerdict | null;
  /** The colleagues mentioned (those since gone left out). */
  mentions: { id: string; name: string; email: string }[];
  createdAt: string;
  /** When its author last edited it; null: never ("edited" shows otherwise). */
  editedAt: string | null;
  /** Written by the caller. */
  mine: boolean;
  /** Until when its author may edit it; null once they no longer may (or it isn't the caller's). */
  editableUntil: string | null;
  can: { edit: boolean; delete: boolean };
}

/** What a new comment may be about here: "General", or one of the candidate's applications or general CVs. */
export interface ScreeningTarget {
  /** "general", "application:<id>" or "general_cv:<id>". */
  key: string;
  about: ScreeningAbout;
  label: string;
  /**
   * The other record holding the same CV (a general CV added to a vacancy, and the application made from it): their
   * comments are shown together on either's page; null otherwise.
   */
  linkedKey: string | null;
  /** Its comments the caller may see. */
  count: number;
  /** Its latest verdict (a general target: the general comments'). */
  verdict: ScreeningVerdict | null;
  /** Who may read a comment on it, so may be mentioned (ScreeningComments.people's ids). */
  mentionable: string[];
}

/** A CV the candidate sent, for the CV window: what it belongs to (its key), and the record holding the same CV. */
export interface ScreeningCv extends CandidateCv {
  key: string;
  linkedKey: string | null;
  /**
   * The CV window's CV Fit (25 October 2026: "Full CV fit score"): an application's fit for its vacancy; null for a
   * general CV, a CV not read, or one the API leaves out.
   */
  fit?: CvFit | null;
  /** Its Other Open Positions (25 October 2026), for HR, the CEO and a Super Admin: the top 3 at 50% or more. */
  openPositions?: OpenPositionFit[];
}

/**
 * GET /recruitment/candidates/:id/comments, /recruitment/applications/:id/comments, /recruitment/general-cvs/:id/comments:
 * the comments the caller may see, newest first. For HR, the CEO and a Super Admin, the candidate's every comment, CV
 * and target (the record pages show their own record's comments with the general ones: recordComments); for a hiring
 * manager or an interviewer, the application's only.
 */
export interface ScreeningComments {
  candidateId: string | null;
  comments: ScreeningCommentView[];
  /** What a new comment may be about here: General first (HR, the CEO, a Super Admin), then each application, then each general CV. */
  targets: ScreeningTarget[];
  /** The colleagues who may be mentioned on one target or another (the caller left out). */
  people: ScreeningPerson[];
  /** The CVs the caller may open, the newest first (the CV window's previous and next). */
  cvs: ScreeningCv[];
  /** The latest verdict of the comments given (per candidate for HR, the CEO and a Super Admin; per application otherwise). */
  verdict: ScreeningVerdict | null;
  can: { add: boolean };
}

/** POST /recruitment/comments: about an application, a general CV, or (only a candidate) the person in general. */
export interface ScreeningCommentCreate {
  applicationId?: string;
  generalCvId?: string;
  candidateId?: string;
  comment: string;
  verdict?: ScreeningVerdict | null;
  mentions?: string[];
}

/**
 * A record's comments on its page and in the CV window: those about `keys` (the record, and the one holding the same CV)
 * and the general ones, newest first.
 */
export function recordComments(comments: readonly ScreeningCommentView[], keys: readonly (string | null | undefined)[]): ScreeningCommentView[] {
  const wanted = new Set(keys.filter((k): k is string => !!k));
  return comments.filter((c) => c.about.kind === 'general' || wanted.has(aboutKey(c.about)));
}

/** The comments under a filter of the profile's card: all, the general ones, or one record's (with the one holding the same CV). */
export function filteredComments(comments: readonly ScreeningCommentView[], filter: string, targets: readonly ScreeningTarget[]): ScreeningCommentView[] {
  if (!filter || filter === 'all') return [...comments];
  if (filter === GENERAL_KEY) return comments.filter((c) => c.about.kind === 'general');
  const linked = targets.find((t) => t.key === filter)?.linkedKey ?? null;
  return comments.filter((c) => {
    const k = aboutKey(c.about);
    return k === filter || (!!linked && k === linked);
  });
}

/** A notification's words when someone is mentioned (names only, never the comment: it may show on a locked phone). */
export function mentionNotice(author: string, candidate: string, about: ScreeningAbout): { title: string; body: string } {
  return { title: `${author} mentioned you in a screening comment`, body: about.kind === 'general' ? candidate : `${candidate} · ${aboutLabel(about)}` };
}
