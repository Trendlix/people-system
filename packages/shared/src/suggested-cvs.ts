// Suggested From Earlier CVs (owner, 24 October 2026: "does the system automatically add recomended general cv's to the
// opened posts?" and "is there a run to fetch previously updated CV's?"; it didn't: a general CV reached a vacancy only by
// HR's "Add to a vacancy", and the CVs were read again but never matched). Asked, they chose:
// - "Suggest; HR adds": each open vacancy lists the earlier CVs that match it, each with its reasons; HR adds the good
//   ones in one click or dismisses them. Nothing joins a vacancy unseen.
// - "General CVs + past applicants": the general CVs (new or reviewed), and the people who applied for other jobs and
//   weren't hired, weren't found "Not a fit" (the screening verdict) and weren't filtered out; never C-level; one row a
//   candidate, their profile tying their CVs together.
// - "Yes, HR presses 'Invite to apply'": an email with the job and its apply link (?src=invite), sent only when HR
//   presses it, never by itself.
// Here: who is in the pool (each exclusion named, for the tests and the API), the score out of 100 with its reasons, the
// threshold and the top 50, the invitation's words, and what the API answers. Pure code: the API keeps and refreshes the
// suggestions (apps/api/src/recruitment/vacancy-suggestions.service.ts), the web shows them. Tested in
// apps/api/src/common/suggested-cvs.spec.ts.

import { experienceOf, meetsMinYears, titleLikeness } from './cv-analysis.js';
import { HIDDEN } from './developer.js';
import type { RehireEligibility } from './offboarding.js';
import type { RecruitmentUserRef, VacancyQuestion, VacancyStatus } from './recruitment.js';
import type { ScreeningCv, ScreeningVerdict } from './screening.js';

// ---------- statuses ----------

/**
 * A suggestion: suggested (waiting for HR); invited (HR emailed them the job's apply link); added (HR made their
 * application from it); applied (they are on the vacancy otherwise: they applied, through the invitation or not, or HR
 * added them another way); dismissed (by HR, never suggested again for the vacancy).
 */
export const SUGGESTION_STATUSES = ['suggested', 'invited', 'added', 'applied', 'dismissed'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, string> = {
  suggested: 'Suggested',
  invited: 'Invited',
  added: 'Added',
  applied: 'Applied',
  dismissed: 'Dismissed',
};

export const isSuggestionStatus = (value: unknown): value is SuggestionStatus => (SUGGESTION_STATUSES as readonly unknown[]).includes(value);

/** Those HR may still act on: add (either), invite (suggested only), dismiss (either). */
export const OPEN_SUGGESTIONS = ['suggested', 'invited'] as const satisfies readonly SuggestionStatus[];
export const isOpenSuggestion = (status: string): boolean => (OPEN_SUGGESTIONS as readonly string[]).includes(status);

export const SUGGESTION_LIMITS = {
  /** The most a vacancy lists, best first. */
  shown: 50,
  /** The least score listed, unless the area matches. */
  minScore: 30,
  /** How far back CVs and applications count, in months (Recruitment Settings; the standard 12). */
  recencyMonths: 12,
  recencyMonthsMin: 1,
  recencyMonthsMax: 36,
  /** A dismissal's reason, at most. */
  reason: 500,
  /** How long a vacancy's suggestions are kept before its page works them out again, in minutes. */
  freshMinutes: 2,
} as const;

/** What a recency in months may be (Recruitment Settings), in words; null when fine. */
export function recencyMonthsProblem(value: unknown): string | null {
  const L = SUGGESTION_LIMITS;
  return typeof value === 'number' && Number.isInteger(value) && value >= L.recencyMonthsMin && value <= L.recencyMonthsMax
    ? null
    : `Give how many months back CVs count: a whole number from ${L.recencyMonthsMin} to ${L.recencyMonthsMax}.`;
}

// ---------- the score ----------

/** The points of each reason, 100 in all: the area 30 (the same team) or 15 (the same department), the key skills 35 by share, the title 20 by likeness, experience 10, recency 5 (3 months) or 3 (6 months). */
export const SUGGESTION_POINTS = { team: 30, department: 15, skills: 35, title: 20, experience: 10, recent: 5, halfYear: 3 } as const;

/**
 * Why an earlier CV matches, each with its points (the chips on the row): the area (`exact`: the vacancy's own team, or
 * department when it has none; else the same department); the key skills its CV names; a title like the job's (the CV's
 * latest, or the job applied for before), named `matchedTitle` so a developer never reads it (developer.ts); the years
 * (typed, else the CV's) against the least the vacancy's screening questions ask (`met` null: none asked); and how recent.
 */
export type SuggestionReason =
  | { kind: 'area'; exact: boolean; ofTeam: boolean; points: number }
  | { kind: 'skills'; found: string[]; listed: number; points: number }
  | { kind: 'title'; from: 'cv' | 'vacancy'; matchedTitle: string; points: number }
  | { kind: 'experience'; years: number; fromCv: boolean; minYears: number | null; met: boolean | null; points: number }
  | { kind: 'recency'; months: number; points: number };

/** A reason in words, as its chip says it: "Same team", "4 of 6 key skills", "Video Editor before", "≈ 3 y", "Recent". */
export function reasonText(r: SuggestionReason): string {
  if (r.kind === 'area') return r.exact && r.ofTeam ? 'Same team' : 'Same department';
  if (r.kind === 'skills') return `${r.found.length} of ${r.listed} key skills`;
  if (r.kind === 'title') {
    const title = r.matchedTitle && r.matchedTitle !== HIDDEN ? r.matchedTitle : null;
    if (r.from === 'cv') return title ? `${title} before` : 'A similar job before';
    return title ? `Applied for ${title}` : 'Applied for a similar job';
  }
  if (r.kind === 'experience') {
    const years = r.fromCv && r.years === 0 ? '< 1 y' : `${r.fromCv ? '≈ ' : ''}${r.years} y`;
    return r.met === false && r.minYears !== null ? `${years} (${r.minYears}+ wanted)` : years;
  }
  return r.points >= SUGGESTION_POINTS.recent ? 'Recent' : 'Within 6 months';
}

/** The reasons in a line: "Same team · 4 of 6 key skills · Video Editor before · ≈ 3 y". */
export const reasonsLine = (reasons: readonly SuggestionReason[]): string => reasons.map(reasonText).join(' · ');

/** The words a "years of experience" question is told by: years, experience; خبرة, سنوات, سنة, عام. */
const YEARS_QUESTION = /\b(years?|yrs?|experience)\b|خبر|سنوات|سنة|عام|أعوام/i;

/** The least years a vacancy's screening questions ask (a number question about years or experience with a least set); null when none does. */
export function minYearsWanted(questions: readonly VacancyQuestion[]): number | null {
  let least: number | null = null;
  for (const q of questions) {
    if (q.kind !== 'number' || typeof q.atLeast !== 'number' || !(q.atLeast > 0) || !YEARS_QUESTION.test(q.text)) continue;
    least = Math.max(least ?? 0, Math.min(q.atLeast, 60));
  }
  return least;
}

const time = (d: Date | string) => (typeof d === 'string' ? Date.parse(d) : d.getTime());

const MONTH_MS = 30.4375 * 86_400_000;

/** The whole months from a moment to now (30.44 days each), never below 0. */
export const monthsSince = (at: Date | string, now: Date = new Date()): number => Math.max(0, Math.floor((now.getTime() - time(at)) / MONTH_MS));

/** The moment `months` calendar months before `now`: from when CVs count. */
export function monthsBefore(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/** A vacancy as its suggestions are worked out for it. */
export interface SuggestionVacancy {
  id: string;
  title: string;
  /** Its team or department (its job title's), and the department at the top; null for none. */
  departmentId: string | null;
  topDepartmentId: string | null;
  /** Whether `departmentId` is a team (another department's). */
  ofTeam: boolean;
  keySkills: readonly string[];
  /** The least years its screening questions ask (minYearsWanted); null when none do. */
  minYears: number | null;
}

/** An earlier CV: a general CV, or an application to another vacancy. */
export interface SuggestionRecord {
  kind: 'general_cv' | 'application';
  id: string;
  candidateId: string;
  /** When it came: received, or applied. */
  at: Date | string;
  /** A general CV's status (new, reviewed, moved, archived). */
  status?: string;
  /** An application's vacancy and how it went. */
  vacancyId?: string | null;
  vacancyTitle?: string | null;
  vacancyCLevel?: boolean;
  stage?: string;
  filteredOut?: boolean;
  /** Its own latest screening verdict. */
  verdict: ScreeningVerdict | null;
  /** Its area: a general CV's team (or department), an application's vacancy's; and the department at the top of it. */
  departmentId: string | null;
  topDepartmentId: string | null;
  /** The years typed on it; null when none. */
  yearsTyped: number | null;
  /** What its CV's reading found: the months of experience and the latest title (null: not read, or none). */
  cvMonths: number | null;
  cvLatestTitle: string | null;
  /** The key skills its CV names (cv-analysis.ts cvSkillsMatcher of its text); null when not read. */
  skillsFound: ((skills: readonly string[]) => { found: string[] }) | null;
}

/**
 * An earlier CV's score for a vacancy, 0 to 100, and its reasons in the chips' order (SUGGESTION_POINTS): the area, the
 * key skills found (by share), a title like the job's (the better of the CV's latest and, for an application, the job
 * applied for; from half the job's words), the years against the least asked (counting only when met), and recency.
 */
export function scoreSuggestion(v: SuggestionVacancy, r: SuggestionRecord, now: Date = new Date()): { score: number; reasons: SuggestionReason[] } {
  const P = SUGGESTION_POINTS;
  const reasons: SuggestionReason[] = [];
  if (v.departmentId && r.departmentId === v.departmentId) reasons.push({ kind: 'area', exact: true, ofTeam: v.ofTeam, points: P.team });
  else if (v.topDepartmentId && r.topDepartmentId === v.topDepartmentId) reasons.push({ kind: 'area', exact: false, ofTeam: v.ofTeam, points: P.department });
  if (v.keySkills.length && r.skillsFound) {
    const found = r.skillsFound(v.keySkills).found;
    if (found.length) reasons.push({ kind: 'skills', found, listed: v.keySkills.length, points: Math.round((P.skills * found.length) / v.keySkills.length) });
  }
  const titles: { from: 'cv' | 'vacancy'; title: string | null | undefined }[] = [{ from: 'cv', title: r.cvLatestTitle }];
  if (r.kind === 'application') titles.push({ from: 'vacancy', title: r.vacancyTitle });
  let like: { from: 'cv' | 'vacancy'; title: string; share: number } | null = null;
  for (const t of titles) {
    if (!t.title) continue;
    const share = titleLikeness(v.title, t.title);
    if (share >= 0.5 && (!like || share > like.share)) like = { from: t.from, title: t.title, share };
  }
  if (like) reasons.push({ kind: 'title', from: like.from, matchedTitle: like.title, points: Math.round(P.title * like.share) });
  const shown = experienceOf(r.yearsTyped, r.cvMonths);
  if (shown) {
    const met = v.minYears === null ? null : meetsMinYears(r.yearsTyped, r.cvMonths, v.minYears);
    reasons.push({ kind: 'experience', years: shown.years, fromCv: shown.fromCv, minYears: v.minYears, met, points: met ? P.experience : 0 });
  }
  const age = (now.getTime() - time(r.at)) / MONTH_MS;
  if (age <= 6) reasons.push({ kind: 'recency', months: monthsSince(r.at, now), points: age <= 3 ? P.recent : P.halfYear });
  return { score: Math.min(100, reasons.reduce((n, x) => n + x.points, 0)), reasons };
}

/** Whether a scored CV is listed: a score of 30 or more, or its area matching. */
export const isListed = (s: { score: number; reasons: readonly SuggestionReason[] }): boolean => s.score >= SUGGESTION_LIMITS.minScore || s.reasons.some((r) => r.kind === 'area');

// ---------- the pool ----------

/** A candidate as the pool reads them. */
export interface SuggestionPerson {
  candidateId: string;
  /** Their profile was merged into another (that one is suggested instead). */
  merged: boolean;
  /**
   * The employee they are: working here now (or on file without an employment yet: `current`), else a former one with
   * their rehire eligibility; `cLevel` a C-level person's.
   */
  employee: { current: boolean; rehire: RehireEligibility | null; cLevel: boolean } | null;
  /** Their latest screening verdict, across every comment about them (the badge the Candidates list shows). */
  verdict: ScreeningVerdict | null;
  /** They applied for a C-level vacancy: never suggested (C-level applicants are the CEO's and a Super Admin's only). */
  cLevelApplicant: boolean;
  /** In the running for another job past Shortlisted (at Interview or Offer, not filtered out): skipped while they are. */
  inProcess: boolean;
}

/** Why a candidate is never suggested for a vacancy. */
export const PERSON_EXCLUSIONS = ['merged', 'applied_here', 'decided', 'c_level', 'employee', 'not_rehirable', 'not_a_fit', 'in_process'] as const;
export type PersonExclusion = (typeof PERSON_EXCLUSIONS)[number];

/**
 * Why a candidate is never suggested for the vacancy (null: they may be): merged into another profile; applied for it
 * already (`applied`); decided on it already (`decided`: dismissed, invited, added); C-level; a current employee; a
 * former one whose rehire eligibility is "No"; their latest verdict "Not a fit"; in the running elsewhere past Shortlisted.
 */
export function personExclusion(p: SuggestionPerson, here: { applied: boolean; decided: boolean }): PersonExclusion | null {
  if (p.merged) return 'merged';
  if (here.applied) return 'applied_here';
  if (here.decided) return 'decided';
  if (p.employee?.cLevel || p.cLevelApplicant) return 'c_level';
  if (p.employee?.current) return 'employee';
  if (p.employee && p.employee.rehire === 'not_eligible') return 'not_rehirable';
  if (p.verdict === 'not_a_fit') return 'not_a_fit';
  if (p.inProcess) return 'in_process';
  return null;
}

/** Why an earlier CV doesn't count for a vacancy. */
export const RECORD_EXCLUSIONS = ['too_old', 'not_a_fit', 'moved', 'archived', 'this_vacancy', 'c_level', 'hired', 'filtered_out'] as const;
export type RecordExclusion = (typeof RECORD_EXCLUSIONS)[number];

/**
 * Why an earlier CV doesn't count (null: it does): older than `since`; its own latest verdict "Not a fit"; a general CV
 * moved to a vacancy, or archived (only new and reviewed count); an application to this vacancy, to a C-level one, hired
 * from, or filtered out by a must-have.
 */
export function recordExclusion(r: SuggestionRecord, vacancyId: string, since: Date): RecordExclusion | null {
  if (time(r.at) < since.getTime()) return 'too_old';
  if (r.verdict === 'not_a_fit') return 'not_a_fit';
  if (r.kind === 'general_cv') {
    if (r.status === 'moved') return 'moved';
    return r.status === 'new' || r.status === 'reviewed' ? null : 'archived';
  }
  if (r.vacancyId === vacancyId) return 'this_vacancy';
  if (r.vacancyCLevel) return 'c_level';
  if (r.stage === 'hired') return 'hired';
  if (r.filteredOut) return 'filtered_out';
  return null;
}

/** A candidate suggested for a vacancy: their best earlier CV, its score and reasons. */
export interface SuggestionFound {
  candidateId: string;
  record: { kind: 'general_cv' | 'application'; id: string };
  at: string;
  score: number;
  reasons: SuggestionReason[];
}

/**
 * Who is suggested for a vacancy, one a candidate: of each candidate not excluded (personExclusion), their earlier CVs
 * that count (recordExclusion, within `recencyMonths`), scored; the best listed one (isListed; the highest score, then the
 * newest) kept; the top `limit` (50), best first, then newest.
 */
export function suggestionsFor(
  v: SuggestionVacancy,
  people: ReadonlyMap<string, SuggestionPerson>,
  records: readonly SuggestionRecord[],
  opts: {
    now?: Date;
    recencyMonths?: number;
    /** Whether the candidate has applied for this vacancy already. */
    appliedHere: (candidateId: string) => boolean;
    /** Whether the vacancy has a decided suggestion of this candidate (or of one of these records of theirs). */
    decided: (candidateId: string, recordIds: readonly string[]) => boolean;
    limit?: number;
  },
): SuggestionFound[] {
  const now = opts.now ?? new Date();
  const since = monthsBefore(now, opts.recencyMonths ?? SUGGESTION_LIMITS.recencyMonths);
  const byCandidate = new Map<string, SuggestionRecord[]>();
  for (const r of records) byCandidate.set(r.candidateId, [...(byCandidate.get(r.candidateId) ?? []), r]);
  const out: SuggestionFound[] = [];
  for (const [candidateId, own] of byCandidate) {
    const person = people.get(candidateId);
    if (!person) continue;
    const excluded = personExclusion(person, { applied: opts.appliedHere(candidateId), decided: opts.decided(candidateId, own.map((r) => r.id)) });
    if (excluded) continue;
    let best: SuggestionFound | null = null;
    for (const r of own) {
      if (recordExclusion(r, v.id, since)) continue;
      const s = scoreSuggestion(v, r, now);
      if (!isListed(s)) continue;
      const at = new Date(time(r.at)).toISOString();
      if (!best || s.score > best.score || (s.score === best.score && at > best.at)) best = { candidateId, record: { kind: r.kind, id: r.id }, at, ...s };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.score - a.score || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, opts.limit ?? SUGGESTION_LIMITS.shown);
}

// ---------- HR told ----------

/** HR's notice of new matches, once a batch (names never in it): "5 earlier CVs match Video Editor". */
export function suggestionsNotice(count: number, vacancy: { title: string; number: string }): { title: string; body: string } {
  return {
    title: `${count} earlier ${count === 1 ? 'CV matches' : 'CVs match'} ${vacancy.title}`,
    body: `${vacancy.number}: open Suggested From Earlier CVs on the vacancy to add them, invite them to apply or dismiss them.`,
  };
}

// ---------- the invitation to apply ----------

/** The invitation's words as HR set them in Recruitment Settings; null: the standard. */
export interface InviteWords {
  subject: string | null;
  en: string | null;
  ar: string | null;
}

/** The standard words: short, English then Arabic (as the rejection email), with {name}, {job}, {company} and {link} filled in. */
export const INVITE_STANDARD = {
  subject: 'An opening that may suit you: {job} · فرصة قد تناسبك: {job}',
  en: [
    'Dear {name},',
    '',
    'You sent us your CV earlier, and a new opening at {company} may suit your experience: {job}.',
    '',
    'If you are interested, please apply here: {link}',
    '',
    'We look forward to hearing from you,',
    '{company} HR',
  ].join('\n'),
  ar: [
    'عزيزي/عزيزتي {name}،',
    '',
    'أرسلت إلينا سيرتك الذاتية من قبل، ولدينا فرصة جديدة في {company} قد تناسب خبرتك: {job}.',
    '',
    'إن كنت مهتمًا، يمكنك التقديم من هنا: {link}',
    '',
    'نتطلع إلى تواصلك معنا،',
    'الموارد البشرية – {company}',
  ].join('\n'),
} as const;

export const INVITE_LIMITS = { subject: 150, text: 3000 } as const;

/** What is wrong with HR's invitation words, each in words (empty: the standard). */
export function inviteWordsProblems(w: Partial<InviteWords>): string[] {
  const problems: string[] = [];
  const len = (v: unknown) => (typeof v === 'string' ? v.trim().length : 0);
  if (len(w.subject) > INVITE_LIMITS.subject) problems.push(`Keep the invitation’s subject to ${INVITE_LIMITS.subject} characters or fewer.`);
  if (len(w.en) > INVITE_LIMITS.text) problems.push(`Keep the invitation’s English text to ${INVITE_LIMITS.text} characters or fewer.`);
  if (len(w.ar) > INVITE_LIMITS.text) problems.push(`Keep the invitation’s Arabic text to ${INVITE_LIMITS.text} characters or fewer.`);
  return problems;
}

/** The apply link an invitation carries: the job's page on the careers site with ?src=invite (its applications say so). */
export const inviteLink = (origin: string, slug: string): string => `${origin.replace(/\/+$/, '')}/careers/${encodeURIComponent(slug)}?src=invite`;

const fill = (text: string, vars: { name: string; job: string; company: string; link: string }) =>
  text.replace(/\{name\}/g, vars.name).replace(/\{job\}/g, vars.job).replace(/\{company\}/g, vars.company).replace(/\{link\}/g, vars.link);

/**
 * The invitation with HR's words (or the standard ones), English then Arabic; the link is always in it (HR's words
 * without {link} have it added at their end).
 */
export function inviteMail(words: InviteWords, vars: { name: string; job: string; company: string; link: string }): { subject: string; text: string } {
  const withLink = (text: string, line: string) => (text.includes('{link}') ? text : `${text}\n\n${line}`);
  const subject = fill(words.subject?.trim() || INVITE_STANDARD.subject, vars);
  const en = fill(withLink(words.en?.trim() || INVITE_STANDARD.en, 'Apply here: {link}'), vars);
  const ar = fill(withLink(words.ar?.trim() || INVITE_STANDARD.ar, 'للتقديم: {link}'), vars);
  return { subject, text: `${en}\n\n— — —\n\n${ar}` };
}

// ---------- the API's answers ----------

/** Where a suggestion came from: a general CV, or an application to another job. */
export type SuggestionSourceView =
  | { kind: 'general_cv'; id: string; number: string; area: string; receivedAt: string }
  | { kind: 'application'; id: string; number: string; vacancy: { id: string; number: string; title: string }; appliedAt: string };

/** A row of Suggested From Earlier CVs. */
export interface VacancySuggestionView {
  id: string;
  candidate: { id: string; code: string; fullName: string };
  /** Where an invitation goes: the email of the CV it came from; null when none is known. */
  email: string | null;
  /** None when the record it came from has gone since (deleted); its decision is kept. */
  source: SuggestionSourceView | null;
  score: number;
  reasons: SuggestionReason[];
  status: SuggestionStatus;
  /** The candidate's latest screening verdict (the badge). */
  verdict: ScreeningVerdict | null;
  /** The CV it came from, for the CV window; null without one. */
  cv: ScreeningCv | null;
  invitedAt: string | null;
  /** The address the invitation went to. */
  sentTo: string | null;
  dismissReason: string | null;
  /** The application it led to (added, or applied). */
  application: { id: string; number: string } | null;
  decidedBy: RecruitmentUserRef | null;
  decidedAt: string | null;
  suggestedAt: string;
  can: { add: boolean; invite: boolean; dismiss: boolean };
}

/** GET /recruitment/vacancies/:id/suggestions?status=. */
export interface VacancySuggestions {
  vacancy: { id: string; number: string; title: string; status: VacancyStatus };
  /** The status shown (?status=; suggested unless asked). */
  status: SuggestionStatus;
  rows: VacancySuggestionView[];
  counts: Record<SuggestionStatus, number>;
  /**
   * Why none are worked out for it now: c_level (never for a C-level vacancy), not_open (a draft, waiting, on hold, closed
   * or filled, or its closing date passed: those kept are shown); null: they are.
   */
  paused: 'c_level' | 'not_open' | null;
  /** Whether email can be sent (Invite to apply needs it). */
  emailReady: boolean;
  /** How far back CVs count, in months (Recruitment Settings). */
  recencyMonths: number;
  /** HR (or a Super Admin) adds, invites and dismisses; the CEO reads. */
  can: { decide: boolean; invite: boolean };
}

/** POST /recruitment/suggestions/:id/add: the application made. */
export interface SuggestionAdded {
  applicationId: string;
  number: string;
}
