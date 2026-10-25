// Candidate profiles (owner, 22 October 2026: "how to make like a profile for each candidate to store history and prevent
// duplication? even if the same candidate applied for 2 jobs"; asked, "Email or mobile" and "Link and show rehire"; then
// "and their is a possible match from other fields, HR decides from suggested match"). One profile, CAN-0001 in its own
// series, holds every application, general CV, CV, interview and offer of one person:
// - the same email, or else the same mobile (as the system keeps phones: +201012345678), joins the profile by itself;
//   the email wins: an email of one profile and a mobile of another join the email's, and the pair is kept for HR as a
//   possible duplicate, never merged by itself;
// - every other sign (the same LinkedIn, portfolio, CV file, name, a nearly identical email, the mobile with another
//   country code, a contact read from the CV) is only a suggestion, each with its reason, which HR confirms (merge) or
//   dismisses ("Not the same person"; a dismissed pair never comes back);
// - a former or current employee is linked by their emails and mobile, showing when and why they left and whether they
//   may be hired again (offboarding's rehire eligibility); a C-level person's only as "Linked to an employee record" to
//   anyone who doesn't see C-level people.
// Pure code: the API matches and stores (apps/api/src/recruitment/candidate-links.ts), the web shows. Tested in
// apps/api/src/common/candidates.spec.ts.

import { emailHint, normalEmail, keptMobile, type ApplicationSource, type ApplicationStage, type VacancyStatus } from './recruitment.js';
import { phoneOk } from './phone.js';
import type { EndReason } from './index.js';
import type { RehireEligibility } from './offboarding.js';
import type { GeneralCvSource, GeneralCvStatus } from './general-cvs.js';
import type { CvListFacts } from './cv-analysis.js';
import type { CvFit, OpenPositionFit } from './cv-fit.js';
import type { FeedbackView, InterviewView } from './recruitment-hiring.js';
import type { ScreeningVerdict } from './screening.js';

// ---------- the code ----------

/** A candidate's code, CAN-0001: its own series, never by year. */
export const candidateCode = (n: number): string => `CAN-${String(n).padStart(4, '0')}`;

/** Whether a text is a candidate's code. */
export const isCandidateCode = (value: unknown): value is string => typeof value === 'string' && /^CAN-\d{4,}$/.test(value);

export const CANDIDATE_LIMITS = {
  /** The Candidates list's rows at most. */
  list: 500,
  /** The possible matches listed at most. */
  matches: 500,
} as const;

// ---------- normalizing what people type ----------

/** An email as a profile keeps it (trimmed, lower case); '' for one that isn't an email. */
export function candidateEmail(value: unknown): string {
  const e = typeof value === 'string' ? normalEmail(value) : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

/**
 * A mobile as a profile keeps it: the system's phone rule (+201012345678, an Egyptian 01… taken as +20…); null for one
 * that can't be dialled (an old row typed in words, too short), which then matches nobody.
 */
export function candidateMobile(value: unknown): string | null {
  const m = keptMobile(value);
  return m && phoneOk(m) ? m : null;
}

/**
 * A LinkedIn profile's link as it is compared: "linkedin.com/in/<slug>", in lower case, whatever its subdomain
 * (eg.linkedin.com), protocol, query or trailing slash; null for one that isn't a profile's.
 */
export function linkedinKey(value: unknown): string | null {
  const t = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const m = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([^/?#\s]+)/.exec(t);
  if (!m) return null;
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // kept as typed
  }
  slug = slug.trim();
  return slug ? `linkedin.com/in/${slug}` : null;
}

/** Hosts whose bare address says nothing about a person (a portfolio there needs its own path). */
const GENERIC_HOSTS = new Set([
  'behance.net',
  'dribbble.com',
  'github.com',
  'vimeo.com',
  'youtube.com',
  'youtu.be',
  'instagram.com',
  'facebook.com',
  'linkedin.com',
  'drive.google.com',
  'google.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'artstation.com',
  'wixsite.com',
  'notion.site',
]);

/**
 * A portfolio's link as it is compared: its host without "www." and its path without the trailing slash, in lower
 * case, no protocol, query or anchor ("https://www.Behance.net/Mona/?tab=1" → "behance.net/mona"); null for none, or a
 * site's bare address that names nobody (behance.net).
 */
export function portfolioKey(value: unknown): string | null {
  const t = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!t) return null;
  const m = /^(?:https?:\/\/)?(?:www\.)?([^/?#\s]+)([^?#\s]*)/.exec(t);
  if (!m || !m[1].includes('.')) return null;
  const host = m[1];
  const path = m[2].replace(/\/+$/, '');
  if (!path && GENERIC_HOSTS.has(host)) return null;
  return `${host}${path}`;
}

/**
 * A name as it is compared (the owner's "the same full name"): lower case, single spaces, no diacritics (Arabic
 * tashkeel and Latin accents), the Arabic letter forms that are written either way made one (أ إ آ ٱ → ا, ة → ه,
 * ى → ي), the tatweel dropped, and anything but letters and digits a space. '' for none.
 */
export function candidateNameKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٰٟۖ-ۭ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A name worth suggesting a match on: two words at least (a single "Ahmed" names too many people). */
const fullNameKey = (value: unknown): string | null => {
  const k = candidateNameKey(value);
  return k.split(' ').length >= 2 ? k : null;
};

/**
 * An email as it would be with its common typo put right, for "differs only in a common typo": the misspelled Gmail,
 * Hotmail, Yahoo, Outlook or iCloud fixed (emailHint: "mona@gmial.com" → "mona@gmail.com"), and a Gmail address's dots
 * and +tag dropped (Gmail delivers mona.ali@ and monaali@ to one mailbox). '' for one that isn't an email.
 */
export function emailFixed(value: unknown): string {
  const e = candidateEmail(value);
  if (!e) return '';
  const fixed = emailHint(e) ?? e;
  const at = fixed.lastIndexOf('@');
  let local = fixed.slice(0, at);
  let domain = fixed.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\+.*$/, '').replace(/\./g, '');
  return `${local}@${domain}`;
}

/** Local parts too common to say two addresses are one person's (info@, hr@ …). */
const GENERIC_LOCAL = new Set(['info', 'contact', 'hello', 'admin', 'mail', 'email', 'careers', 'career', 'jobs', 'job', 'hr', 'cv', 'resume', 'test', 'office', 'support', 'sales']);

/** An email's local part, for "the same local part on another domain" (ahmed.ali@gmail.com, ahmed.ali@yahoo.com); null when too short or common. */
export function emailLocal(value: unknown): string | null {
  const e = candidateEmail(value);
  if (!e) return null;
  const local = e.slice(0, e.lastIndexOf('@'));
  return local.length >= 5 && /\p{L}/u.test(local) && !GENERIC_LOCAL.has(local) ? local : null;
}

/** A mobile's last 9 digits, for "the same number with another country code"; null for a shorter one. */
export function mobileTail(value: unknown): string | null {
  const m = candidateMobile(value);
  const digits = m ? m.replace(/\D/g, '') : '';
  return digits.length >= 9 ? digits.slice(-9) : null;
}

// The same person applying for the same job again, by their email or their mobile (the public side: no candidate signs
// in), updates their application while it is open, and is refused once it is closed (owner, 25 October 2026: "Update
// their application"; reapply.ts APPLICATION_CLOSED). HR's own paths name the application there instead.

// ---------- joining a profile ----------

/** What an application or a general CV joins: the email's profile, else the mobile's, else a new one. */
export interface CandidateDecision {
  /** The profile it joins; null: a new one. */
  join: string | null;
  /** The email's and the mobile's profiles differ: the mobile's, kept as a possible duplicate (never merged by itself). */
  possibleDuplicateOf: string | null;
}

/**
 * The owner's "Email or mobile" (22 October 2026): the profile holding the email, else the one holding the mobile, else
 * a new one. Both found and different: the email's, with the mobile's as a possible duplicate for HR.
 */
export function candidateDecision(found: { byEmail: string | null; byMobile: string | null }): CandidateDecision {
  if (found.byEmail) return { join: found.byEmail, possibleDuplicateOf: found.byMobile && found.byMobile !== found.byEmail ? found.byMobile : null };
  return { join: found.byMobile, possibleDuplicateOf: null };
}

// ---------- what a profile is matched by ----------

/** What a profile is compared by: its own (email, mobile …) and what is derived from them for the suggestions. */
export const CANDIDATE_KEY_KINDS = ['email', 'mobile', 'email_fixed', 'email_local', 'mobile_tail', 'linkedin', 'portfolio', 'cv', 'name', 'cv_email', 'cv_phone'] as const;
export type CandidateKeyKind = (typeof CANDIDATE_KEY_KINDS)[number];

/** Everything a profile's applications, general CVs and CV readings say about the person. */
export interface CandidateFacts {
  emails: readonly (string | null | undefined)[];
  mobiles: readonly (string | null | undefined)[];
  linkedins: readonly (string | null | undefined)[];
  portfolios: readonly (string | null | undefined)[];
  names: readonly (string | null | undefined)[];
  /** Each CV file's SHA-256. */
  cvHashes: readonly (string | null | undefined)[];
  /** The emails and phones the CV readings found in the CVs' text. */
  cvEmails: readonly (string | null | undefined)[];
  cvPhones: readonly (string | null | undefined)[];
}

export interface CandidateKey {
  kind: CandidateKeyKind;
  value: string;
}

/** A profile's keys, normalized, each once. */
export function candidateKeys(f: CandidateFacts): CandidateKey[] {
  const out = new Map<string, CandidateKey>();
  const add = (kind: CandidateKeyKind, value: string | null | undefined) => {
    if (value) out.set(`${kind}\u0000${value}`, { kind, value });
  };
  for (const e of f.emails) {
    const email = candidateEmail(e);
    if (!email) continue;
    add('email', email);
    add('email_fixed', emailFixed(email));
    add('email_local', emailLocal(email));
  }
  for (const m of f.mobiles) {
    const mobile = candidateMobile(m);
    add('mobile', mobile);
    add('mobile_tail', mobileTail(mobile));
  }
  for (const l of f.linkedins) add('linkedin', linkedinKey(l));
  for (const p of f.portfolios) add('portfolio', portfolioKey(p));
  for (const n of f.names) add('name', fullNameKey(n));
  for (const h of f.cvHashes) add('cv', typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : null);
  for (const e of f.cvEmails) add('cv_email', candidateEmail(e) || null);
  for (const p of f.cvPhones) add('cv_phone', candidateMobile(p));
  return [...out.values()];
}

/** A profile's keys by kind. */
export type CandidateKeySet = ReadonlyMap<CandidateKeyKind, ReadonlySet<string>>;

export function keySetOf(keys: readonly CandidateKey[]): CandidateKeySet {
  const out = new Map<CandidateKeyKind, Set<string>>();
  for (const k of keys) {
    if (!out.has(k.kind)) out.set(k.kind, new Set());
    out.get(k.kind)!.add(k.value);
  }
  return out;
}

// ---------- possible matches ----------

/**
 * Why two profiles may be one person, strongest first. The same email or mobile on both (one application's mobile on
 * another profile, a profile split): a possible duplicate. The rest (owner, 22 October 2026: "their is a possible match
 * from other fields, HR decides from suggested match"): suggestions.
 */
export const MATCH_SIGNALS = ['same_email', 'same_mobile', 'same_linkedin', 'same_cv', 'cv_contact', 'same_portfolio', 'email_typo', 'mobile_country', 'email_domain', 'same_name'] as const;
export type MatchSignal = (typeof MATCH_SIGNALS)[number];

export const MATCH_SIGNAL_LABELS: Record<MatchSignal, string> = {
  same_email: 'Same email',
  same_mobile: 'Same mobile',
  same_linkedin: 'Same LinkedIn',
  same_cv: 'Same CV file',
  cv_contact: 'Contact found in a CV',
  same_portfolio: 'Same portfolio',
  email_typo: 'Nearly the same email',
  mobile_country: 'Same mobile, another country code',
  email_domain: 'Same email name, another domain',
  same_name: 'Same name',
};

/** Each sign's weight: the score is their sum (100 at most). A name alone is the weakest. */
export const MATCH_SIGNAL_WEIGHTS: Record<MatchSignal, number> = {
  same_email: 100,
  same_mobile: 90,
  same_linkedin: 80,
  same_cv: 80,
  cv_contact: 60,
  same_portfolio: 50,
  email_typo: 45,
  mobile_country: 35,
  email_domain: 30,
  same_name: 15,
};

/** The signs that make a pair a possible duplicate rather than a suggestion. */
const DUPLICATE_SIGNALS: readonly MatchSignal[] = ['same_email', 'same_mobile'];

export const CANDIDATE_MATCH_KINDS = ['duplicate', 'suggested'] as const;
export type CandidateMatchKind = (typeof CANDIDATE_MATCH_KINDS)[number];

export const CANDIDATE_MATCH_KIND_LABELS: Record<CandidateMatchKind, string> = { duplicate: 'Possible duplicate', suggested: 'Suggested match' };

export const CANDIDATE_MATCH_STATUSES = ['open', 'dismissed', 'merged'] as const;
export type CandidateMatchStatus = (typeof CANDIDATE_MATCH_STATUSES)[number];

const shares = (a: CandidateKeySet, ak: CandidateKeyKind, b: CandidateKeySet, bk: CandidateKeyKind): boolean => {
  const x = a.get(ak);
  const y = b.get(bk);
  if (!x || !y) return false;
  for (const v of x) if (y.has(v)) return true;
  return false;
};

/** The signs two profiles share, strongest first (the same both ways round). */
export function matchSignals(a: CandidateKeySet, b: CandidateKeySet): MatchSignal[] {
  const out = new Set<MatchSignal>();
  if (shares(a, 'email', b, 'email')) out.add('same_email');
  if (shares(a, 'mobile', b, 'mobile')) out.add('same_mobile');
  if (shares(a, 'linkedin', b, 'linkedin')) out.add('same_linkedin');
  if (shares(a, 'cv', b, 'cv')) out.add('same_cv');
  if (shares(a, 'cv_email', b, 'email') || shares(b, 'cv_email', a, 'email') || shares(a, 'cv_phone', b, 'mobile') || shares(b, 'cv_phone', a, 'mobile')) out.add('cv_contact');
  if (shares(a, 'portfolio', b, 'portfolio')) out.add('same_portfolio');
  // a nearly identical email: the same once its typo is put right, but not the same address
  const typo = !out.has('same_email') && shares(a, 'email_fixed', b, 'email_fixed');
  if (typo) out.add('email_typo');
  if (!out.has('same_mobile') && shares(a, 'mobile_tail', b, 'mobile_tail')) out.add('mobile_country');
  if (!out.has('same_email') && !typo && shares(a, 'email_local', b, 'email_local')) out.add('email_domain');
  if (shares(a, 'name', b, 'name')) out.add('same_name');
  return MATCH_SIGNALS.filter((s) => out.has(s));
}

/** The signs' score, 0 to 100. */
export const matchScore = (signals: readonly MatchSignal[]): number => Math.min(100, signals.reduce((n, s) => n + MATCH_SIGNAL_WEIGHTS[s], 0));

/** A pair's kind: a possible duplicate when they share an email or a mobile, else a suggestion. */
export const matchKindOf = (signals: readonly MatchSignal[]): CandidateMatchKind => (signals.some((s) => DUPLICATE_SIGNALS.includes(s)) ? 'duplicate' : 'suggested');

/** A name alone: shown, but ranked last. */
export const isWeakMatch = (signals: readonly MatchSignal[]): boolean => signals.length === 1 && signals[0] === 'same_name';

/** The reasons as HR reads them, strongest first: "Same LinkedIn · Same name". */
export const matchReasons = (signals: readonly MatchSignal[]): string =>
  MATCH_SIGNALS.filter((s) => signals.includes(s))
    .map((s) => MATCH_SIGNAL_LABELS[s])
    .join(' · ');

/** Possible matches in order: strongest first, a name alone last, then the newest. */
export function rankMatches<T extends { signals: readonly MatchSignal[]; score: number; updatedAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((x, y) => Number(isWeakMatch(x.signals)) - Number(isWeakMatch(y.signals)) || y.score - x.score || y.updatedAt.localeCompare(x.updatedAt));
}

// ---------- the lists' badges ----------

/**
 * An applicant's badge on the lists and the board: "2 applications" (every application of theirs the caller sees, this
 * one too), "Applied before" (this is their only application, but they sent a general CV too); null for a first time.
 */
export function applicationsBadge(c: { applications: number; generalCvs: number }): string | null {
  if (c.applications >= 2) return `${c.applications} applications`;
  if (c.applications + c.generalCvs >= 2) return 'Applied before';
  return null;
}

// ---------- the linked employee ----------

/** How a profile's employee is: working here now, left, or a profile with no employment yet. */
export const CANDIDATE_EMPLOYEE_STATES = ['current', 'former', 'record'] as const;
export type CandidateEmployeeState = (typeof CANDIDATE_EMPLOYEE_STATES)[number];

/** Rehire eligibility, short, as the candidate's card says it. */
export const REHIRE_SHORT_LABELS: Record<RehireEligibility, string> = { eligible: 'Yes', not_eligible: 'No', conditional: 'With conditions' };

/** The employee a profile is linked to, as the caller may see them. */
export interface CandidateEmployeeLink {
  /** A C-level person, for those who don't see C-level people: nothing but "Linked to an employee record". */
  restricted: boolean;
  employee: { id: string; employeeCode: string; fullNameEn: string } | null;
  state: CandidateEmployeeState | null;
  /** Their last day, when they left. */
  leftOn: string | null;
  endReason: EndReason | null;
  /** The end reason in words ("Resigned"), as the API names it. */
  endReasonLabel: string | null;
  rehire: RehireEligibility | null;
  rehireReason: string | null;
}

/**
 * The card's line: "Former employee EMP-0182: left 2025-03 (Resigned) · Rehire: Yes"; "Current employee EMP-0182";
 * "Linked to an employee record" for a C-level person to those who don't see them.
 */
export function candidateEmployeeText(link: CandidateEmployeeLink): string {
  if (link.restricted || !link.employee) return 'Linked to an employee record';
  const code = link.employee.employeeCode;
  if (link.state === 'current') return `Current employee ${code}`;
  if (link.state === 'former') {
    const left = link.leftOn ? `left ${link.leftOn.slice(0, 7)}${link.endReasonLabel ? ` (${link.endReasonLabel})` : ''}` : 'left';
    return `Former employee ${code}: ${left} · Rehire: ${link.rehire ? REHIRE_SHORT_LABELS[link.rehire] : 'Not decided'}`;
  }
  return `Employee record ${code}`;
}

/** The lists' badge of a linked employee: "Former employee", "Employee", "Employee record"; null for none. */
export function employeeBadge(state: CandidateEmployeeState | 'restricted' | null): string | null {
  if (state === 'former') return 'Former employee';
  if (state === 'current') return 'Employee';
  if (state === 'record' || state === 'restricted') return 'Employee record';
  return null;
}

// ---------- what the API answers ----------

/** A profile named: its code and the latest name. */
export interface CandidateRef {
  id: string;
  code: string;
  fullName: string;
}

/** On an applicant, for HR, the CEO and a Super Admin: their profile, in short (null for anyone else). */
export interface CandidateBadge {
  id: string;
  code: string;
  /** Their applications the caller sees, this one too. */
  applications: number;
  /** Their general CVs not moved to an application. */
  generalCvs: number;
  /** "Former employee" and so on; 'restricted' a C-level person's to those who don't see them. */
  employee: CandidateEmployeeState | 'restricted' | null;
}

/** A possible match: the two profiles, why, how strong. */
export interface PossibleMatchView {
  id: string;
  kind: CandidateMatchKind;
  signals: MatchSignal[];
  /** Why, in words: "Same LinkedIn · Same name". */
  why: string;
  score: number;
  /** A name alone. */
  weak: boolean;
  candidates: [CandidateSummary, CandidateSummary];
  updatedAt: string;
}

/** A profile on a possible match, or on the list. */
export interface CandidateSummary extends CandidateRef {
  applications: number;
  generalCvs: number;
  lastAppliedAt: string | null;
}

/** GET /recruitment/candidates: a profile on the list. */
export interface CandidateListItem extends CandidateSummary {
  /** Their latest application (or general CV): what for, where it stands. */
  latest: {
    kind: 'application' | 'general_cv';
    id: string;
    reference: string;
    /** The vacancy's title; "General CV" for one. */
    title: string;
    stage: ApplicationStage | null;
    filteredOut: boolean;
    generalStatus: GeneralCvStatus | null;
    /** Where it came from, in words ("LinkedIn", "General CV (Email)"). */
    source: string;
    at: string;
  } | null;
  employee: CandidateEmployeeState | 'restricted' | null;
  /** Possible matches HR hasn't decided. */
  openMatches: number;
  /**
   * The Experience column (24 October 2026: "why isn't the experience pulled off the CV?"): of their applications and
   * general CVs, the one with the most years (the years typed, else its CV's estimate), else the latest; its years typed
   * and its CV's reading. Left out by an API from before it.
   */
  yearsExperience?: number | null;
  fromCv?: CvListFacts | null;
  /**
   * Their latest screening verdict (owner, 24 October 2026: "Yes: Good fit / Maybe / Not a fit"; screening.ts): the newest
   * comment with one of all those the caller may see about them; null: none yet.
   */
  verdict?: ScreeningVerdict | null;
}

/** An application on a profile. */
export interface CandidateApplication {
  id: string;
  number: string;
  vacancy: { id: string; number: string; title: string; status: VacancyStatus };
  appliedAt: string;
  stage: ApplicationStage;
  filteredOut: boolean;
  rejectReason: string | null;
  matchPercent: number | null;
  cvMatchPercent: number | null;
  /** The CV fit's parts (25 October 2026), for the breakdown on hover. */
  cvFit?: CvFit | null;
  source: ApplicationSource;
  /** Where it came from, in words. */
  sourceText: string;
  employeeId: string | null;
}

/** A general CV on a profile. */
export interface CandidateGeneralCv {
  id: string;
  number: string;
  status: GeneralCvStatus;
  /** Its team, or an older CV's area, in words (general-cvs.ts GeneralCvListItem's). */
  area: string;
  /** Its team in words, and the position chosen (or written for Other), from 25 October 2026 (cv-positions.ts). */
  team?: string | null;
  positionName?: string | null;
  positionOther?: string | null;
  source: GeneralCvSource;
  receivedAt: string;
  movedTo: { applicationId: string; reference: string } | null;
}

/** A CV a candidate sent: an application's or a general CV's, to open or download. */
export interface CandidateCv {
  kind: 'application' | 'general_cv';
  /** The application's or the general CV's id (its CV is at …/applications/:id/cv or …/general-cvs/:id/cv). */
  id: string;
  reference: string;
  /** What it was sent for: the vacancy's title, or "General CV". */
  title: string;
  /** The file's name (hidden from a developer: it often carries the person's name). */
  cvFileName: string;
  mimeType: string;
  sizeBytes: number;
  sentAt: string;
  /** The portfolio links sent with it (25 October 2026: "Portfolio per position"), for the CV window; hidden from a developer. */
  portfolioLinks?: string[];
  /**
   * The section title they went under, as set now (26 October 2026: "Your showreel"; portfolio.ts): an application's
   * vacancy's, a general CV's position's. Left out without links, or by an API from before it.
   */
  portfolioTitle?: string;
}

/** A job offer made to them. */
export interface CandidateOffer {
  id: string;
  number: string;
  status: string;
  /** An earlier offer, entered after it was given (25 October 2026); left out by an API from before. */
  recordedEarlier?: boolean;
  applicationId: string | null;
  vacancyTitle: string | null;
  createdAt: string;
}

/** An interview of theirs, with the application it was for. */
export interface CandidateInterview extends InterviewView {
  vacancyTitle: string;
  feedback: FeedbackView[];
}

/** A merge into this profile: who was merged, when, by whom; a Super Admin may undo it. */
export interface CandidateMergeView {
  id: string;
  merged: CandidateRef;
  at: string;
  by: string | null;
  undoneAt: string | null;
  moved: { applications: number; generalCvs: number; contacts: number };
  canUndo: boolean;
}

/** One line of a profile's timeline (a screening comment's since 24 October 2026). */
export interface CandidateTimelineItem {
  at: string;
  kind: 'application' | 'general_cv' | 'interview' | 'offer' | 'merge' | 'comment';
  text: string;
  /** The record's page on the site; null when none. */
  href: string | null;
}

/** GET /recruitment/candidates/:id: the profile. */
export interface CandidateView extends CandidateRef {
  linkedin: string | null;
  portfolio: string | null;
  /** Every portfolio link of their applications and general CVs, the newest first, each once (25 October 2026). */
  portfolioLinks?: string[];
  createdAt: string;
  lastAppliedAt: string | null;
  /** Merged into another profile: that one (the web opens it). */
  mergedInto: CandidateRef | null;
  /** Every email and mobile, the newest first (not "emails": each is an object, masked for a developer field by field). */
  emailContacts: { email: string; firstSeenAt: string; lastSeenAt: string }[];
  mobileContacts: { mobile: string; firstSeenAt: string; lastSeenAt: string }[];
  cvs: CandidateCv[];
  applications: CandidateApplication[];
  generalCvs: CandidateGeneralCv[];
  interviews: CandidateInterview[];
  offers: CandidateOffer[];
  employee: CandidateEmployeeLink | null;
  matches: PossibleMatchView[];
  merges: CandidateMergeView[];
  timeline: CandidateTimelineItem[];
  /** Their latest screening verdict across every comment the caller may see (24 October 2026); null: none yet. */
  verdict?: ScreeningVerdict | null;
  /**
   * Other Open Positions (owner, 25 October 2026: "and if it recomended to another position based on the CV"): the top 3
   * open vacancies their CVs fit at 50% or more, the best of their CVs for each.
   */
  openPositions?: OpenPositionFit[];
  can: { merge: boolean; dismiss: boolean; split: boolean; undoMerge: boolean };
}

/** On the applicant's page, for HR, the CEO and a Super Admin: their profile, other applications, employee and possible matches. */
export interface ApplicationCandidate extends CandidateRef {
  otherApplications: CandidateApplication[];
  generalCvs: CandidateGeneralCv[];
  employee: CandidateEmployeeLink | null;
  matches: PossibleMatchView[];
  /** "Move to a new candidate": HR (or a Super Admin), when the profile holds something else too. */
  canSplit: boolean;
}

/** GET /recruitment/candidates/matches: the possible matches HR hasn't decided. */
export interface PossibleMatches {
  duplicates: PossibleMatchView[];
  suggested: PossibleMatchView[];
}

/** What the backfill did (once on deploy; then a sweep for anything left without a profile). */
export interface CandidateBackfillResult {
  applications: number;
  generalCvs: number;
  created: number;
  joined: number;
  employeesLinked: number;
}
