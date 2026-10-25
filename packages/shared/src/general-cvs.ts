// General CVs and the applicants seen by posted job (owner, 22 October 2026: "i want a proper viweing, what came out of
// the posted jobs and what cam on randomly"; asked what "randomly" means: "Both"):
// - General CVs: people who send a CV without applying for a posted vacancy: "Send us your CV" on the careers page, and
//   the CVs HR adds that came by email, WhatsApp, LinkedIn, in person or by referral. Each has the person's details, the
//   position they would like (since 25 October 2026, grouped by team: cv-positions.ts; before, the area they would like
//   to work in), or Other in words, where it came from, and a reference in the applications' series (APP-2026-0007). New, reviewed, moved to a vacancy (an application made from it, at Applied or
//   Shortlisted, its source "General CV (Email)"), or archived (and restored).
// - The posted jobs: the applicants grouped by vacancy, each with its counts by stage and by source: the links posted
//   (LinkedIn, Facebook groups, job boards, referral) apart from the careers page reached directly, with no link.
// - Bulk upload (owner, 22 October 2026: "is there a way to easy apply from linkedin?", then a bulk upload of the CVs
//   LinkedIn's Easy Apply sends: "why not"): HR drops many CVs at once on a vacancy (or on General CVs); each is read for
//   the person's name, email and mobile (cvGuesses), HR checks them, then they are saved at Applied (or as general CVs),
//   the consent recorded as HR's.
// Pure code: the API enforces these rules, the web shows them. Tested in apps/api/src/common/general-cvs.spec.ts.

import type { CvListFacts, CvReadingView } from './cv-analysis.js';
import type { OpenPositionFit } from './cv-fit.js';
import { CV_POSITION_LIMITS, type CvPositionGroup } from './cv-positions.js';
import type { ScreeningVerdict } from './screening.js';
import type { EmailConfirmedBy } from './linkedin-signin.js';
import type { PortfolioAsk } from './portfolio.js';
import { APPLICATION_SOURCE_LABELS, applyProblems, normalEmail, RECRUITMENT_LIMITS, webLinkOf, type ApplicationSource, type ApplicationStage, type RecruitmentUserRef, type VacancyStatus } from './recruitment.js';

// ---------- sources and statuses ----------

/** Where a general CV came from: the careers page's own form, or how HR received it. */
export const GENERAL_CV_SOURCES = ['careers', 'email', 'whatsapp', 'linkedin', 'walk_in', 'referral', 'other'] as const;
export type GeneralCvSource = (typeof GENERAL_CV_SOURCES)[number];

export const GENERAL_CV_SOURCE_LABELS: Record<GeneralCvSource, string> = {
  careers: 'Careers page',
  email: 'Email',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
  walk_in: 'In person',
  referral: 'Referral',
  other: 'Other',
};

/** The sources HR adds a CV from (the careers page's is the person's own). */
export const HR_CV_SOURCES = ['email', 'whatsapp', 'linkedin', 'walk_in', 'referral', 'other'] as const satisfies readonly GeneralCvSource[];
export type HrCvSource = (typeof HR_CV_SOURCES)[number];

export const isGeneralCvSource = (v: unknown): v is GeneralCvSource => (GENERAL_CV_SOURCES as readonly unknown[]).includes(v);
export const isHrCvSource = (v: unknown): v is HrCvSource => (HR_CV_SOURCES as readonly unknown[]).includes(v);

/** A general CV: new; reviewed by HR; moved to a vacancy (an application made from it); or archived. */
export const GENERAL_CV_STATUSES = ['new', 'reviewed', 'moved', 'archived'] as const;
export type GeneralCvStatus = (typeof GENERAL_CV_STATUSES)[number];

export const GENERAL_CV_STATUS_LABELS: Record<GeneralCvStatus, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  moved: 'Moved to a vacancy',
  archived: 'Archived',
};

export const isGeneralCvStatus = (v: unknown): v is GeneralCvStatus => (GENERAL_CV_STATUSES as readonly unknown[]).includes(v);

/** The steps of a general CV's history (general_cv_events.event). */
export const GENERAL_CV_EVENT_LABELS: Record<string, string> = {
  received: 'Received',
  reviewed: 'Marked as reviewed',
  archived: 'Archived',
  restored: 'Restored',
  moved: 'Added to a vacancy',
};

/** The stages a general CV can be moved to a vacancy at. */
export const MOVE_STAGES = ['applied', 'shortlisted'] as const satisfies readonly ApplicationStage[];
export type MoveStage = (typeof MOVE_STAGES)[number];

export const GENERAL_CV_LIMITS = {
  /** One general CV from an email in this many days, then "You sent us your CV on … already". */
  perEmailDays: 30,
  /** General CVs from the careers page an hour in all: a cap on a flood. */
  perHour: 100,
  areaOther: 80,
  /** "Other (write it)" for the position (25 October 2026). */
  positionOther: CV_POSITION_LIMITS.other,
  referrer: 120,
} as const;

/**
 * What the website's signature of the person's address is bound to on the general form, as a job's is to its slug:
 * careersIpToken('general') in recruitment.ts, written out so this file needs nothing of it when it loads.
 */
export const GENERAL_CV_IP_TOKEN = 'careers-apply:general';

/** "General CV (Email)": how an application moved from a general CV shows where it came from. */
export const movedSourceText = (source: GeneralCvSource): string => `General CV (${GENERAL_CV_SOURCE_LABELS[source]})`;

/** An applicant's source in words: "General CV (Email)" for one moved from a general CV. */
export function applicationSourceText(a: { source: ApplicationSource; generalSource?: GeneralCvSource | null }): string {
  return a.source === 'general' && a.generalSource ? movedSourceText(a.generalSource) : APPLICATION_SOURCE_LABELS[a.source];
}

// ---------- the form ----------

/** What the general form sends (the careers page's, or HR's Add a CV), besides the CV. */
export interface GeneralCvInput {
  fullName: string;
  email: string;
  mobile: string;
  linkedin?: string | null;
  portfolio?: string | null;
  yearsExperience?: number | null;
  noticePeriod?: string | null;
  expectedSalary?: number | null;
  /**
   * The position they would like (owner, 25 October 2026: "Position, grouped by team"; cv-positions.ts): its key, or none
   * with `positionOther` in words ("Other (write it)").
   */
  positionKey?: string | null;
  positionOther?: string | null;
  /**
   * The area of interest of before: a team's id, or none with `areaOther` in words. Taken for one release from a page sent
   * before the positions (an old cached page), as its team with no position.
   */
  departmentId?: string | null;
  areaOther?: string | null;
  consent: boolean;
  /** HR's Add a CV: how it came (required there); the careers page's is its own. */
  source?: string | null;
  /** HR's, a referral: who referred them. */
  referrer?: string | null;
  notes?: string | null;
}

/** The consent words beside the tick on the careers page's general form. */
export const GENERAL_CV_CONSENT_TEXT =
  'I agree that the company keeps my details and my CV to consider me for jobs that fit them. Only the people who hire see them. I can ask HR to delete them at any time.';

/** HR's tick on Add a CV: the person agreed, kept as HR's consent with who and when. */
export const HR_CONSENT_TEXT = 'The person agreed to be considered for jobs here, and to their CV being kept for that.';

/**
 * What is wrong with a general CV, each in words: the person's details as an application's (applyProblems), the position
 * they would like (one of the list, or Other in words; 25 October 2026), or an older page's area (a team, or Other in
 * words), the consent; and, HR's (`byHr`), the source (a referral with who referred them) and the notes. Whether the
 * position is on the list is the API's to check (POSITION_NOT_LISTED).
 */
export function generalCvProblems(input: Partial<GeneralCvInput>, { byHr }: { byHr: boolean }): string[] {
  const G = GENERAL_CV_LIMITS;
  const problems = applyProblems({ ...input, answers: {}, consent: true, linkedin: webLinkOf(input.linkedin) || null, portfolio: webLinkOf(input.portfolio) || null }, []);
  const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const positionOther = trimmed(input.positionOther);
  const other = trimmed(input.areaOther);
  if (!trimmed(input.positionKey) && !positionOther && !input.departmentId && !other) {
    problems.push(byHr ? 'Choose the position they would like, or Other and write it.' : 'Choose the position you would like, or Other and write it.');
  }
  if (positionOther.length > G.positionOther) problems.push(`Keep the position to ${G.positionOther} characters or fewer.`);
  if (other.length > G.areaOther) problems.push(`Keep the area to ${G.areaOther} characters or fewer.`);
  if (byHr) {
    if (!isHrCvSource(input.source)) problems.push('Choose how the CV came: email, WhatsApp, LinkedIn, in person, referral or other.');
    const referrer = typeof input.referrer === 'string' ? input.referrer.trim() : '';
    if (input.source === 'referral' && !referrer) problems.push('Write who referred them.');
    if (referrer.length > G.referrer) problems.push(`Keep the referrer’s name to ${G.referrer} characters or fewer.`);
    if (typeof input.notes === 'string' && input.notes.trim().length > RECRUITMENT_LIMITS.notes) problems.push(`Keep the notes to ${RECRUITMENT_LIMITS.notes} characters or fewer.`);
    if (input.consent !== true) problems.push('Tick that the person agreed to be considered.');
  } else if (input.consent !== true) {
    problems.push('Tick that we may keep your details and CV to consider you for jobs.');
  }
  return problems;
}

/** Why a general CV can be moved to a vacancy or not, in words; null when it can: new or reviewed, not moved nor archived. */
export function moveProblem(status: GeneralCvStatus): string | null {
  if (status === 'moved') return 'It was moved to a vacancy already.';
  if (status === 'archived') return 'It is archived: restore it first.';
  return null;
}

/** The days since a moment, whole (Cairo days are not needed here: "within 30 days" counts from the moment). */
export const withinDays = (at: Date, days: number, now: Date = new Date()): boolean => now.getTime() - at.getTime() < days * 24 * 60 * 60 * 1000;

// ---------- reading a CV: the name, email and mobile ----------

const ARABIC_INDIC = /[٠-٩۰-۹]/g;
const latinDigits = (t: string) => t.replace(ARABIC_INDIC, (d) => String((d.charCodeAt(0) & 0xf) % 10));

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Words that head a CV rather than name its person. */
const HEADINGS = new Set([
  'curriculum vitae',
  'resume',
  'résumé',
  'cv',
  'profile',
  'summary',
  'contact',
  'contact information',
  'contact info',
  'personal information',
  'personal details',
  'personal data',
  'objective',
  'career objective',
  'about me',
  'education',
  'experience',
  'work experience',
  'skills',
  'السيرة الذاتية',
  'سيرة ذاتية',
  'البيانات الشخصية',
]);

/**
 * A mobile number in a CV's text, as kept (+20…, or + and the digits): each run of digits with the spaces, dots, dashes
 * and brackets people write between them, read without them. An Egyptian mobile (010, 011, 012, 015 and 8 digits; with
 * or without 0, 20, +20 or 0020 before) first; else one written with its country code (+ or 00), 8 to 15 digits.
 */
export function mobileIn(text: string): string | null {
  const runs = [...latinDigits(text).matchAll(/(?:\+|\b00)?\d[\d\s().-]{6,22}\d/g)].map((m) => ({ plus: /^(\+|00)/.test(m[0]), digits: m[0].replace(/\D/g, '') }));
  for (const r of runs) {
    const egypt = /^(?:0020|20)?0?(1[0125]\d{8})$/.exec(r.digits);
    if (egypt) return `+20${egypt[1]}`;
  }
  for (const r of runs) {
    const digits = r.digits.replace(/^00/, '');
    if (r.plus && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  }
  return null;
}

/** An email address in a CV's text, in lower case. */
export function emailIn(text: string): string | null {
  const m = EMAIL_IN_TEXT.exec(text);
  return m ? normalEmail(m[0].replace(/^[._%+-]+|[._-]+$/g, '')) : null;
}

/** Whether a line can be a person's name: 2 to 5 words of letters (Latin or Arabic), no digits, no @, not a heading. */
export function looksLikeName(line: string): boolean {
  const t = line.trim().replace(/\s+/g, ' ');
  if (t.length < 4 || t.length > 60) return false;
  if (HEADINGS.has(t.toLowerCase().replace(/[:\-–|]+$/g, '').trim())) return false;
  if (/[\d@/\\|:,;]/.test(t)) return false;
  const words = t.split(' ');
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => /^[\p{L}][\p{L}.'’-]*$/u.test(w));
}

/** "mona_adel-CV (1).pdf" → "Mona Adel": a file's name as a person's, when the CV's text gives none. */
export function nameFromFile(fileName: string): string | null {
  const base = fileName
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_.\-()[\]+]+/g, ' ')
    .replace(/\b(cv|resume|résumé|curriculum|vitae|updated|final|new|copy|linkedin|profile)\b/gi, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base || base.split(' ').length > 5 || !/\p{L}/u.test(base)) return null;
  return base
    .split(' ')
    .map((w) => (/^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** What a CV's text tells of its person, each null when it can't be told. */
export interface CvGuess {
  fullName: string | null;
  email: string | null;
  mobile: string | null;
}

/**
 * A CV's person, guessed from its text (its lines in order): the name, the first of its first 15 lines that looks like
 * a name, else the file's name; the email and mobile, the first found. A scanned CV (no text) gives the file's name only,
 * for HR to fill in the rest.
 */
export function cvGuesses(text: string, fileName: string): CvGuess {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const name = lines.slice(0, 15).find(looksLikeName) ?? null;
  return { fullName: name ?? nameFromFile(fileName), email: emailIn(text), mobile: mobileIn(text) };
}

// ---------- bulk upload ----------

/** At most this many CVs waiting in one person's batch. */
export const CV_BATCH_LIMIT = 50;

/** Where a bulk upload's CVs go: a vacancy's applicants, or the general CVs. */
export type CvBatchTarget = { kind: 'vacancy'; vacancyId: string } | { kind: 'general' };

/** A CV uploaded in a batch, waiting for HR to check its row and save it. */
export interface CvUploadView {
  id: string;
  fileName: string;
  sizeBytes: number;
  /** Whether its text could be read (a scanned PDF has none: the row is HR's to fill in). */
  textFound: boolean;
  /** A scanned CV still being read by the OCR service (22 October 2026): its row fills in once read. */
  reading: boolean;
  guess: CvGuess;
  /** One with the guessed email on the vacancy already (or a general CV in the last 30 days), or earlier in the batch. */
  duplicate: { reference: string | null; inBatch: boolean; date: string | null } | null;
  uploadedAt: string;
}

/** POST /recruitment/cv-uploads/save: each row as HR checked it. */
export interface CvSaveRow {
  id: string;
  fullName: string;
  email: string;
  mobile: string;
  source: string;
  /** A general CV's position (25 October 2026: its key from HR's list, hidden ones too), or Other in words. */
  positionKey?: string | null;
  positionOther?: string | null;
  /** A general CV's area of interest, from a page sent before the positions (one release): a team's id, or Other in words. */
  departmentId?: string | null;
  areaOther?: string | null;
  /** A general CV from a referral: who referred them. */
  referrer?: string | null;
  /** Save it although it looks like a duplicate (general CVs only: a vacancy takes one application an email). */
  keep?: boolean;
  /** Leave it out of the save (it stays in the batch until discarded). */
  skip?: boolean;
}

/** What a save did: the references made, and the rows left (with why). */
export interface CvSaveResult {
  saved: { id: string; reference: string; fullName: string }[];
  skipped: { id: string; fileName: string; reason: string }[];
}

// ---------- the API's answers ----------

/** A general CV on the list. */
export interface GeneralCvListItem {
  id: string;
  number: string;
  fullName: string;
  email: string;
  mobile: string;
  yearsExperience: number | null;
  /**
   * The area of interest in words: its team's name as HR's lists name it ("Video · Production"), or what they wrote for
   * Other on an older CV, or "Other".
   */
  area: string;
  /** Its team (or department): the position's, or an older CV's area; null when none is known. */
  departmentId: string | null;
  /** Its team in words, "Video · Production"; null when none is known (Other). From 25 October 2026. */
  team?: string | null;
  /**
   * The position chosen (25 October 2026; cv-positions.ts): its key and its name as shown when chosen; null for Other
   * (`positionOther`, in words) and for an older CV, sent for an area.
   */
  positionKey?: string | null;
  positionName?: string | null;
  positionOther?: string | null;
  source: GeneralCvSource;
  referrer: string | null;
  status: GeneralCvStatus;
  receivedAt: string;
  /** Added by HR (null: sent on the careers page). */
  addedBy: RecruitmentUserRef | null;
  /** The application it was moved to. */
  movedTo: { applicationId: string; reference: string; vacancyId: string; vacancyTitle: string } | null;
  /** Its CV's reading, as an application's on the lists (24 October 2026); null without a CV or from an API before it. */
  fromCv?: CvListFacts | null;
  /** Its latest screening verdict (24 October 2026; screening.ts): the newest of its own comments with one; null: none yet. */
  verdict?: ScreeningVerdict | null;
  /**
   * The "Best open position" column (owner, 25 October 2026: "and if it recomended to another position based on the CV"):
   * the open vacancy its CV fits best, at 50% or more; null: none.
   */
  bestPosition?: { vacancy: { id: string; number: string; title: string }; percent: number } | null;
}

/** What the caller may do to a general CV now. */
export interface GeneralCvCan {
  review: boolean;
  archive: boolean;
  restore: boolean;
  move: boolean;
  editNotes: boolean;
}

/** GET /recruitment/general-cvs/:id. */
export interface GeneralCvView extends GeneralCvListItem {
  /** Other Open Positions (25 October 2026): the top 3 open vacancies its CV fits at 50% or more. */
  openPositions?: OpenPositionFit[];
  linkedin: string | null;
  /** Every portfolio link, the PDF case study and "Confirmed by LinkedIn", as an application's (25 October 2026). */
  portfolioLinks?: string[];
  portfolioFile?: { fileName: string; sizeBytes: number } | null;
  /** The section title its position's portfolio goes under, as set now ("Your case studies"; 26 October 2026; portfolio.ts). */
  portfolioTitle?: string;
  emailConfirmedBy?: EmailConfirmedBy | null;
  portfolio: string | null;
  noticePeriod: string | null;
  expectedSalary: number | null;
  areaOther: string | null;
  notes: string | null;
  consentAt: string;
  /** HR who ticked the person's agreement (Add a CV, a bulk upload); null: the person on the careers page. */
  consentBy: RecruitmentUserRef | null;
  consentNote: string | null;
  cv: { fileName: string; mimeType: string; sizeBytes: number } | null;
  /** The CV read and what the rules found in it (22 October 2026); no key skills here. */
  cvReading: CvReadingView | null;
  history: { event: string; note: string | null; by: RecruitmentUserRef | null; at: string }[];
  can: GeneralCvCan;
}

/**
 * The careers page's general form: the positions to choose from, grouped by team (25 October 2026; cv-positions.ts), and
 * the areas of before (generalAreas), kept for one release for a page that still asks for one.
 */
export interface PublicGeneralForm {
  company: { nameEn: string; nameAr: string | null };
  /** None from an API before the positions. */
  positions?: CvPositionGroup[];
  areas: GeneralArea[];
  /**
   * The portfolio each position asks for, by its key (25 October 2026: "Portfolio per position"; portfolio.ts: the
   * strictest of its job titles'), and Other's; a position left out asks for none. Left out by an API from before it.
   * Each with its section title, the portfolio part's heading (`title`, since 26 October 2026).
   */
  portfolios?: Record<string, PortfolioAsk>;
  otherPortfolio?: PortfolioAsk;
  /** "Fill in with LinkedIn" is on (25 October 2026; linkedin-signin.ts). */
  linkedinSignIn?: boolean;
}

/** An area a general CV may be for: a team (or a department without teams), its id the one a CV is saved with. */
export interface GeneralArea {
  id: string;
  /** As the careers page's list shows it: "Video"; "Content (Marketing)" when another team is called Content too. */
  name: string;
  /** As HR's lists show it: "Video · Production". */
  hrName: string;
}

/** A department as the areas are made from it: whether it is C-level (all its job titles, its teams' too, confidential), and its teams. */
export interface AreaDepartment {
  id: string;
  name: string;
  cLevel: boolean;
  teams: readonly { id: string; name: string; cLevel: boolean }[];
}

/**
 * The areas a CV may be for, from the departments in the organisation's order (owner, 22 October 2026: "from my POV, it
 * should be related to teams not departments"; "C Level isn't an option for any user or even HR, how will someone apply
 * for a c-level"; then "remove the department from the dropdown menu, area you would like to work in"): each team, named
 * by itself ("Video"); a department only when it has no teams (else nobody could choose it), by its own name. Two
 * options with the same name are told apart by the team's department in brackets ("Content (Marketing)"). Never a
 * C-level one: such a department is left out with its teams, and so is such a team. HR's lists name a team with its
 * department (hrName: "Video · Production").
 */
export function generalAreas(departments: readonly AreaDepartment[]): GeneralArea[] {
  const made = departments.flatMap((d) => {
    const department = d.name.trim();
    if (d.cLevel) return [];
    if (!d.teams.length) return [{ id: d.id, name: department, hrName: department, department: null as string | null }];
    return d.teams.filter((t) => !t.cLevel).map((t) => ({ id: t.id, name: t.name.trim(), hrName: `${t.name.trim()} · ${department}`, department: department as string | null }));
  });
  const key = (name: string) => name.toLowerCase();
  const count = new Map<string, number>();
  for (const a of made) count.set(key(a.name), (count.get(key(a.name)) ?? 0) + 1);
  return made.map(({ department, ...a }) => (department !== null && (count.get(key(a.name)) ?? 0) > 1 ? { ...a, name: `${a.name} (${department})` } : a));
}

/** GET /recruitment/applicants/summary: the two tabs' counts, and each vacancy's applicants by stage and by source. */
export interface ApplicantsSummary {
  /** Applicants to posted jobs (not those filtered out). */
  posted: number;
  /** General CVs not archived, and those still new. */
  general: number;
  generalNew: number;
  vacancies: VacancyApplicantsGroup[];
}

/** A vacancy's applicants in counts: by stage (not those filtered out), filtered out apart, and by source. */
export interface VacancyApplicantsGroup {
  vacancy: { id: string; number: string; title: string; status: VacancyStatus };
  total: number;
  byStage: Record<ApplicationStage, number>;
  filteredOut: number;
  bySource: Record<string, number>;
}
