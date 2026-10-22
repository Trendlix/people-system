// Recruitment, the ATS (owner, 22 October 2026: "where will we include the ATS?"; the original plan's spec §12): Phase 1,
// vacancies, the public careers page and the applicants.
// - Vacancies: HR drafts one from a job title (its JD's purpose, duties and requirements as the public description), with
//   its hiring manager, headcount, employment type, arrangement, shift, contract length, closing date and an internal
//   salary range (HR, the CEO and a Super Admin only: never on the careers page). The CEO approves it before it is
//   published ("HR creates a vacancy and the CEO approves it"), or sends it back with a reason. Open, on hold, closed;
//   filled once its hires reach the headcount.
// - Screening questions, up to 10: yes or no, one choice, a number (years of experience …), short text; a must-have
//   (knockout) rule where it makes sense, and match points ("the match score uses rules from the screening questions").
//   The match % is the points earned ÷ the points possible; an applicant failing a must-have is filtered out, kept and
//   restorable, never deleted.
// - The careers page (owner: "i dont know how to decide it for now", so people.trendlix.com/careers, made so
//   careers.trendlix.com can point at it later): open vacancies, a job's page and its application form, with the CV
//   (PDF or Word, at most 5 MB). Each channel's link is the same with ?src= (LinkedIn, Facebook groups, job boards …).
// - Applicants: applied, shortlisted, interview, offer, hired, rejected. HR shortlists, rejects (with a reason) and
//   restores; Make offer opens the job offer form filled in from the applicant and the vacancy, and the offer's answer
//   moves the application on: accepted, hired (the vacancy filled at its headcount); declined or withdrawn, back to
//   shortlisted.
// Phase 2 (recruitment-hiring.ts, onboarding.ts): the pipeline board, interviews with their invitations, the hiring
// manager's and the interviewers' feedback, the rejection email, onboarding and recruitment analytics.
// Pure code: the API enforces these rules, the web shows them. Tested in apps/api/src/common/recruitment.spec.ts.

import type { EmploymentType, WorkArrangement } from './index.js';
import type { FeedbackView, InterviewView, RecruitmentViewer, SuggestionView } from './recruitment-hiring.js';

// ---------- the limits ----------

export const RECRUITMENT_LIMITS = {
  title: 120,
  headcount: 50,
  durationMonths: 60,
  questions: 10,
  questionText: 200,
  optionsMin: 2,
  options: 8,
  optionText: 80,
  points: 20,
  reason: 500,
  notes: 2000,
  name: 120,
  email: 254,
  mobile: 30,
  link: 300,
  notice: 60,
  textAnswer: 500,
  yearsExperience: 60,
  number: 1_000_000,
  salary: 10_000_000,
  /** The CV: a PDF or a Word file. */
  cvMb: 5,
  /** Applications from one address an hour, then refused. */
  applyPerHour: 5,
  /** Applications to one job an hour, then refused: a cap on a flood, whatever addresses it comes from. */
  applyPerVacancyHour: 100,
} as const;

/**
 * What the website's signature of an applicant's address is bound to (as a check-in's is to its session): the job applied
 * for, so a signed address can't be reused for another job or for anything else (apps/api attendance/signed-ip.ts).
 */
export const careersIpToken = (slug: string): string => `careers-apply:${slug}`;

/** The match % from which an applicant counts as a good match (the list's filter "Match ≥ 70%"). */
export const GOOD_MATCH_PERCENT = 70;

// ---------- vacancies ----------

export const VACANCY_STATUSES = ['draft', 'pending', 'open', 'on_hold', 'closed', 'filled'] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];

export const VACANCY_STATUS_LABELS: Record<VacancyStatus, string> = {
  draft: 'Draft',
  pending: 'Waiting for the CEO',
  open: 'Open',
  on_hold: 'On hold',
  closed: 'Closed',
  filled: 'Filled',
};

export const isVacancyStatus = (value: unknown): value is VacancyStatus => (VACANCY_STATUSES as readonly unknown[]).includes(value);

/**
 * What can be done to a vacancy, and from which statuses: HR sends a draft for approval, the CEO approves it (it is
 * published) or sends it back (a draft again, with the reason), HR puts an open one on hold and opens it again, and
 * closes it. Filled is set by the system when its hires reach the headcount.
 */
export const VACANCY_MOVES = {
  submit: ['draft'],
  approve: ['pending'],
  send_back: ['pending'],
  hold: ['open'],
  reopen: ['on_hold'],
  close: ['open', 'on_hold'],
} as const satisfies Record<string, readonly VacancyStatus[]>;
export type VacancyMove = keyof typeof VACANCY_MOVES;

export const VACANCY_MOVE_TO: Record<VacancyMove, VacancyStatus> = {
  submit: 'pending',
  approve: 'open',
  send_back: 'draft',
  hold: 'on_hold',
  reopen: 'open',
  close: 'closed',
};

export const canMoveVacancy = (move: VacancyMove, status: VacancyStatus): boolean => (VACANCY_MOVES[move] as readonly VacancyStatus[]).includes(status);

/**
 * What may be changed on a vacancy in its status: everything while a draft; nothing while the CEO decides ("ask them to
 * send it back") or once closed or filled; while open or on hold, all but the job title and the employment's terms,
 * and its questions only until someone has applied (the applicants' scores are worked out with them).
 */
export function vacancyEditable(status: VacancyStatus): 'all' | 'published' | 'none' {
  if (status === 'draft') return 'all';
  if (status === 'open' || status === 'on_hold') return 'published';
  return 'none';
}

/** Whether a vacancy takes applications on `today` (YYYY-MM-DD): open, and its closing date not passed. */
export const takesApplications = (v: { status: string; closingDate: string | null }, today: string): boolean =>
  v.status === 'open' && (v.closingDate === null || v.closingDate >= today);

/** What a vacancy's form sends (create, and change: every field optional then). */
export interface VacancyInput {
  jobTitleId: string;
  title: string;
  gradeId?: string | null;
  hiringManagerId?: string | null;
  headcount: number;
  employmentType: EmploymentType;
  workArrangement: WorkArrangement;
  shiftId?: string | null;
  durationMonths?: number | null;
  closingDate?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  about?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
  questions?: VacancyQuestion[];
}

/**
 * What is wrong with a vacancy's terms, each in words: its title, headcount (1 to 50), contract length (1 to 60
 * months), the salary range (whole or with piastres, the least not above the most) and the closing date (not before
 * `today`, YYYY-MM-DD, when it is being set).
 */
export function vacancyProblems(v: Partial<Pick<VacancyInput, 'title' | 'headcount' | 'durationMonths' | 'salaryMin' | 'salaryMax' | 'closingDate'>>, today: string): string[] {
  const L = RECRUITMENT_LIMITS;
  const problems: string[] = [];
  if (v.title !== undefined) {
    const title = typeof v.title === 'string' ? v.title.trim() : '';
    if (title.length < 2) problems.push('Give the vacancy a title.');
    else if (title.length > L.title) problems.push(`Keep the title to ${L.title} characters or fewer.`);
  }
  if (v.headcount !== undefined && !(Number.isInteger(v.headcount) && v.headcount >= 1 && v.headcount <= L.headcount)) {
    problems.push(`The headcount is how many people to hire: a whole number from 1 to ${L.headcount}.`);
  }
  if (v.durationMonths !== undefined && v.durationMonths !== null && !(Number.isInteger(v.durationMonths) && v.durationMonths >= 1 && v.durationMonths <= L.durationMonths)) {
    problems.push(`The contract length is in whole months, from 1 to ${L.durationMonths}.`);
  }
  const money = (n: number | null | undefined) => n === undefined || n === null || (Number.isFinite(n) && n >= 0 && n <= L.salary && Math.round(n * 100) === n * 100);
  if (!money(v.salaryMin)) problems.push('Give the least salary in EGP a month, or leave it empty.');
  if (!money(v.salaryMax)) problems.push('Give the most salary in EGP a month, or leave it empty.');
  if (typeof v.salaryMin === 'number' && typeof v.salaryMax === 'number' && v.salaryMin > v.salaryMax) problems.push('The least salary is more than the most: swap them.');
  if (v.closingDate !== undefined && v.closingDate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.closingDate)) problems.push('Give the closing date as a date.');
    else if (v.closingDate < today) problems.push('The closing date has passed: choose today or a later day.');
  }
  return problems;
}

/** A vacancy's number: VAC-<year>-<4 digits>. */
export const vacancyNumber = (year: number | string, n: number): string => `VAC-${year}-${String(n).padStart(4, '0')}`;

/** An application's reference: APP-<year>-<4 digits>. */
export const applicationNumber = (year: number | string, n: number): string => `APP-${year}-${String(n).padStart(4, '0')}`;

/**
 * A vacancy's address on the careers page: its title in lower case, letters and digits joined by dashes, then its
 * number ("Video Producer", VAC-2026-0003 → "video-producer-vac-2026-0003"). Titles in Arabic alone keep the number.
 */
export function vacancySlug(title: string, number: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const tail = number.toLowerCase();
  return words ? `${words}-${tail}` : tail;
}

/** Whether a text can be a vacancy's address on the careers page. */
export const isVacancySlug = (value: unknown): value is string => typeof value === 'string' && value.length <= 90 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

// ---------- the channels ----------

/** Where an applicant came from: the careers page itself, or a channel's link (?src=). */
export const APPLICATION_SOURCES = ['careers', 'linkedin', 'facebook', 'job_board', 'referral', 'other'] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

export const APPLICATION_SOURCE_LABELS: Record<ApplicationSource, string> = {
  careers: 'Careers page',
  linkedin: 'LinkedIn',
  facebook: 'Facebook groups',
  job_board: 'Job boards',
  referral: 'Referral',
  other: 'Other',
};

/** The source a link's ?src= names: one of the channels; none, the careers page; anything else, Other. */
export function sourceOf(value: unknown): ApplicationSource {
  if (value === undefined || value === null || value === '') return 'careers';
  return (APPLICATION_SOURCES as readonly unknown[]).includes(value) ? (value as ApplicationSource) : 'other';
}

/** The path of a vacancy's page for a channel: the careers page's own has no ?src=. */
export const careersPath = (slug: string, source: ApplicationSource = 'careers'): string =>
  source === 'careers' ? `/careers/${slug}` : `/careers/${slug}?src=${encodeURIComponent(source)}`;

// ---------- screening questions ----------

export const QUESTION_KINDS = ['yes_no', 'choice', 'number', 'text'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  yes_no: 'Yes or no',
  choice: 'One choice',
  number: 'A number',
  text: 'Short text',
};

/** A choice's option: its words, the points it gives, and whether it passes a must-have question. */
export interface QuestionOption {
  label: string;
  points: number;
  accepted: boolean;
}

/**
 * A screening question. `knockout`: a must-have, answered otherwise the applicant is filtered out (yes or no: the answer
 * wanted; a number: at least `atLeast`; a choice: one of the accepted options); a must-have question is always
 * required. Points: for the wanted answer (yes or no), for reaching `atLeast` (a number), each option's own (a choice);
 * short text gives none.
 */
export interface VacancyQuestion {
  /** Its id within the vacancy ("q1" …): answers are kept by it. */
  key: string;
  kind: QuestionKind;
  text: string;
  required: boolean;
  knockout: boolean;
  /** Yes or no: the answer wanted. */
  wanted?: 'yes' | 'no' | null;
  /** A number: the least wanted. */
  atLeast?: number | null;
  /** Yes or no, a number: the points for the wanted answer. */
  points?: number | null;
  /** A choice: its options, in order. */
  options?: QuestionOption[] | null;
}

const KEY = /^q[0-9a-z]{1,20}$/;
const isWhole = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/** The most points a question gives. */
export function questionMaxPoints(q: VacancyQuestion): number {
  if (q.kind === 'choice') return (q.options ?? []).reduce((top, o) => Math.max(top, o.points), 0);
  if (q.kind === 'text') return 0;
  return q.points ?? 0;
}

/** The questions as kept: each tidied (texts trimmed, a must-have required, what its kind doesn't use left out). */
export function tidyQuestions(questions: readonly VacancyQuestion[]): VacancyQuestion[] {
  return questions.map((q) => {
    const base = { key: q.key, kind: q.kind, text: textOf(q.text), required: q.required || q.knockout, knockout: q.kind === 'text' ? false : q.knockout };
    if (q.kind === 'yes_no') return { ...base, wanted: q.wanted ?? null, points: q.points ?? 0 };
    if (q.kind === 'number') return { ...base, atLeast: q.atLeast ?? null, points: q.points ?? 0 };
    if (q.kind === 'choice') return { ...base, options: (q.options ?? []).map((o) => ({ label: textOf(o.label), points: o.points ?? 0, accepted: o.accepted === true })) };
    return base;
  });
}

/**
 * What is wrong with a vacancy's screening questions, each in words: at most 10; each with a key of its own, a kind, its
 * words; yes or no and a number with points from 0 to 20 and, when they give points or are must-haves, the answer
 * wanted or the least number; a choice with 2 to 8 different options, each with points from 0 to 20, and, a must-have,
 * at least one accepted.
 */
export function vacancyQuestionsProblems(questions: unknown): string[] {
  const L = RECRUITMENT_LIMITS;
  if (!Array.isArray(questions)) return ['Send the questions as a list.'];
  const problems: string[] = [];
  if (questions.length > L.questions) problems.push(`A vacancy takes at most ${L.questions} questions.`);
  const keys = new Set<string>();
  questions.forEach((raw, i) => {
    const q = (raw ?? {}) as Partial<VacancyQuestion>;
    const text = textOf(q.text);
    const which = text ? `Question ${i + 1} (${text.length > 40 ? `${text.slice(0, 40)}…` : text})` : `Question ${i + 1}`;
    if (typeof q.key !== 'string' || !KEY.test(q.key)) problems.push(`${which}: its key is missing. Reload the page and try again.`);
    else if (keys.has(q.key)) problems.push(`${which}: another question has its key. Reload the page and try again.`);
    else keys.add(q.key);
    if (!(QUESTION_KINDS as readonly unknown[]).includes(q.kind)) return void problems.push(`${which}: choose what kind of answer it takes.`);
    if (!text) problems.push(`${which}: write the question.`);
    else if (text.length > L.questionText) problems.push(`${which}: keep it to ${L.questionText} characters or fewer.`);
    if (typeof q.required !== 'boolean' || typeof q.knockout !== 'boolean') problems.push(`${which}: say whether it is required and whether it is a must-have.`);
    const points = q.points ?? 0;
    if (q.kind === 'yes_no' || q.kind === 'number') {
      if (!isWhole(points, 0, L.points)) problems.push(`${which}: its points are a whole number from 0 to ${L.points}.`);
      const scored = q.knockout === true || (typeof points === 'number' && points > 0);
      if (q.kind === 'yes_no' && scored && q.wanted !== 'yes' && q.wanted !== 'no') problems.push(`${which}: choose the answer wanted, Yes or No.`);
      if (q.kind === 'number' && scored && !(typeof q.atLeast === 'number' && Number.isFinite(q.atLeast) && q.atLeast >= 0 && q.atLeast <= L.number)) {
        problems.push(`${which}: give the least number wanted.`);
      }
    }
    if (q.kind === 'choice') {
      const options = Array.isArray(q.options) ? q.options : [];
      if (options.length < L.optionsMin || options.length > L.options) problems.push(`${which}: give from ${L.optionsMin} to ${L.options} options.`);
      const labels = new Set<string>();
      options.forEach((o, j) => {
        const label = textOf(o?.label);
        if (!label) problems.push(`${which}: option ${j + 1} has no words.`);
        else if (label.length > L.optionText) problems.push(`${which}: option ${j + 1} can be at most ${L.optionText} characters.`);
        else if (labels.has(label.toLowerCase())) problems.push(`${which}: option ${j + 1} is there already.`);
        else labels.add(label.toLowerCase());
        if (!isWhole(o?.points ?? 0, 0, L.points)) problems.push(`${which}: option ${j + 1}'s points are a whole number from 0 to ${L.points}.`);
      });
      if (q.knockout === true && !options.some((o) => o?.accepted === true)) problems.push(`${which}: a must-have choice needs at least one accepted option.`);
    }
  });
  return problems;
}

// ---------- answers and the match ----------

/** An answer as kept: yes or no ("yes"/"no"), an option's words, a number, or text; null when not answered. */
export type AnswerValue = string | number | null;

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** The answers sent, kept for the vacancy's questions only, each in its kind's form (a number as a number). */
export function tidyAnswers(questions: readonly VacancyQuestion[], answers: Readonly<Record<string, unknown>> | null | undefined): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const q of questions) {
    const v = answers?.[q.key];
    if (isBlank(v)) out[q.key] = null;
    else if (q.kind === 'number') out[q.key] = typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, ''));
    else out[q.key] = textOf(v);
  }
  return out;
}

/** What is wrong with the answers, each in words: required ones answered, each in its kind's form. */
export function answerProblems(questions: readonly VacancyQuestion[], answers: Readonly<Record<string, AnswerValue>>): string[] {
  const L = RECRUITMENT_LIMITS;
  const problems: string[] = [];
  for (const q of questions) {
    const v = answers[q.key] ?? null;
    if (v === null) {
      if (q.required) problems.push(`Answer: ${q.text}`);
      continue;
    }
    if (q.kind === 'yes_no' && v !== 'yes' && v !== 'no') problems.push(`Answer Yes or No: ${q.text}`);
    if (q.kind === 'choice' && !(q.options ?? []).some((o) => o.label === v)) problems.push(`Choose one of the options: ${q.text}`);
    if (q.kind === 'number' && !(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= L.number)) problems.push(`Give a number: ${q.text}`);
    if (q.kind === 'text' && typeof v === 'string' && v.length > L.textAnswer) problems.push(`Keep the answer to ${L.textAnswer} characters or fewer: ${q.text}`);
  }
  return problems;
}

/** How one answer did: the points it earned of the most possible, and, for a must-have, whether it passed. */
export interface AnswerScore {
  key: string;
  points: number;
  maxPoints: number;
  /** A must-have's: passed or not; null for any other question. */
  passed: boolean | null;
}

export interface MatchResult {
  points: number;
  maxPoints: number;
  /** Points ÷ the most possible, rounded; null when no question gives points. */
  matchPercent: number | null;
  /** The keys of the must-haves not passed: any one filters the applicant out. */
  knockedOut: string[];
  answers: AnswerScore[];
}

/** The match of the answers to a vacancy's questions (owner, 22 October 2026: "rules from the screening questions"). */
export function scoreAnswers(questions: readonly VacancyQuestion[], answers: Readonly<Record<string, AnswerValue>>): MatchResult {
  let points = 0;
  let maxPoints = 0;
  const knockedOut: string[] = [];
  const scored: AnswerScore[] = questions.map((q) => {
    const v = answers[q.key] ?? null;
    const max = questionMaxPoints(q);
    let good = false;
    let earned = 0;
    if (q.kind === 'yes_no') {
      good = v !== null && v === q.wanted;
      earned = good ? (q.points ?? 0) : 0;
    } else if (q.kind === 'number') {
      good = typeof v === 'number' && typeof q.atLeast === 'number' && v >= q.atLeast;
      earned = good ? (q.points ?? 0) : 0;
    } else if (q.kind === 'choice') {
      const option = (q.options ?? []).find((o) => o.label === v);
      good = option?.accepted === true;
      earned = option?.points ?? 0;
    }
    points += earned;
    maxPoints += max;
    const passed = q.knockout && q.kind !== 'text' ? good : null;
    if (passed === false) knockedOut.push(q.key);
    return { key: q.key, points: earned, maxPoints: max, passed };
  });
  return { points, maxPoints, matchPercent: maxPoints > 0 ? Math.round((points / maxPoints) * 100) : null, knockedOut, answers: scored };
}

// ---------- applying ----------

/** What the careers page's form sends, besides the CV. */
export interface ApplyInput {
  fullName: string;
  email: string;
  mobile: string;
  linkedin?: string | null;
  portfolio?: string | null;
  yearsExperience?: number | null;
  noticePeriod?: string | null;
  expectedSalary?: number | null;
  answers: Record<string, unknown>;
  consent: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE = /^\+?[0-9 ()-]{7,30}$/;

/** Whether a text is a web link: http(s), a host with a dot, no spaces. */
export const isWebLink = (value: string): boolean => value.length <= RECRUITMENT_LIMITS.link && /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(value);

/**
 * A link as typed, made whole (22 October 2026: an applicant's "www.linkedin.com/in/…" was refused for wanting https://):
 * trimmed, and https:// put in front when it has no http(s):// of its own; empty as ''.
 */
export function webLinkOf(value: unknown): string {
  const t = typeof value === 'string' ? value.trim() : '';
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
}

/** An email as kept and compared: trimmed and in lower case. */
export const normalEmail = (value: string): string => value.trim().toLowerCase();

/** What is wrong with an application, each in words (the answers' problems too). */
export function applyProblems(input: Partial<ApplyInput>, questions: readonly VacancyQuestion[]): string[] {
  const L = RECRUITMENT_LIMITS;
  const problems: string[] = [];
  const name = textOf(input.fullName);
  if (name.length < 2) problems.push('Write your full name.');
  else if (name.length > L.name) problems.push(`Keep your name to ${L.name} characters or fewer.`);
  const email = typeof input.email === 'string' ? normalEmail(input.email) : '';
  if (!EMAIL.test(email) || email.length > L.email) problems.push('Write your email address, e.g. name@example.com.');
  const mobile = textOf(input.mobile);
  if (!MOBILE.test(mobile) || mobile.replace(/\D/g, '').length < 7) problems.push('Write your mobile number, e.g. +20 100 123 4567.');
  for (const [field, label] of [
    ['linkedin', 'LinkedIn'],
    ['portfolio', 'portfolio'],
  ] as const) {
    const link = webLinkOf(input[field]);
    if (link && !isWebLink(link)) problems.push(`Write your ${label} link, e.g. linkedin.com/in/your-name, or leave it empty.`);
  }
  const years = input.yearsExperience;
  if (years !== undefined && years !== null && !(Number.isFinite(years) && years >= 0 && years <= L.yearsExperience && Math.round(years * 2) === years * 2)) {
    problems.push(`Give your years of experience as a number from 0 to ${L.yearsExperience} (halves allowed).`);
  }
  if (textOf(input.noticePeriod).length > L.notice) problems.push(`Keep the notice period to ${L.notice} characters or fewer.`);
  const salary = input.expectedSalary;
  if (salary !== undefined && salary !== null && !(Number.isFinite(salary) && salary >= 0 && salary <= L.salary)) problems.push('Give your expected salary in EGP a month, or leave it empty.');
  problems.push(...answerProblems(questions, tidyAnswers(questions, input.answers ?? {})));
  if (input.consent !== true) problems.push('Tick that we may keep your application and CV to consider you for this job.');
  return problems;
}

/** The privacy words beside the consent tick on the careers page. */
export const APPLY_CONSENT_TEXT =
  'I agree that the company keeps my application, my answers and my CV to consider me for this job and similar ones. Only the people who hire see them. I can ask HR to delete them at any time.';

// ---------- applicants ----------

export const APPLICATION_STAGES = ['applied', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  applied: 'Applied',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
};

export const isApplicationStage = (value: unknown): value is ApplicationStage => (APPLICATION_STAGES as readonly unknown[]).includes(value);

/** The stages HR moves an applicant to by hand; the offer and hired follow the job offer, and restore undoes. */
export const HAND_STAGES = ['shortlisted', 'interview', 'rejected'] as const;
export type HandStage = (typeof HAND_STAGES)[number];

/**
 * Why an applicant can't be moved to `to` by hand, in words; null when they can. Shortlisted from applied (or back from
 * interview), never one filtered out (restore them first); interview from shortlisted; rejected from any stage before
 * hired, but not while a job offer to them is open (withdraw it first).
 */
export function stageMoveProblem(from: ApplicationStage, to: HandStage, state: { filteredOut: boolean; openOffer: boolean }): string | null {
  if (from === 'hired') return 'They were hired: their application stays as it is.';
  if (from === to) return `They are ${APPLICATION_STAGE_LABELS[to].toLowerCase()} already.`;
  if (to === 'rejected') {
    if (state.openOffer) return 'A job offer to them is open: withdraw it first.';
    return null;
  }
  if (from === 'rejected') return 'They were rejected: restore them first.';
  if (state.filteredOut) return 'They failed a must-have question and were filtered out: restore them first.';
  if (to === 'shortlisted') return from === 'applied' || from === 'interview' ? null : `They are at ${APPLICATION_STAGE_LABELS[from]}: they can't go back to shortlisted.`;
  return from === 'shortlisted' ? null : 'Shortlist them first.';
}

/** Whether an applicant can be restored: one filtered out, or one rejected. */
export const restorable = (a: { stage: ApplicationStage; filteredOut: boolean }): boolean => a.filteredOut || a.stage === 'rejected';

/** Whether a job offer can be made from an application: shortlisted, at interview, or back at the offer stage after one was declined. */
export const offerable = (a: { stage: ApplicationStage; filteredOut: boolean }): boolean => !a.filteredOut && (a.stage === 'shortlisted' || a.stage === 'interview' || a.stage === 'offer');

/** What happened to an application, as its history lists it. */
export const APPLICATION_EVENTS = ['applied', 'filtered_out', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'restored', 'offer_declined', 'offer_withdrawn'] as const;
export type ApplicationEvent = (typeof APPLICATION_EVENTS)[number];

export const APPLICATION_EVENT_LABELS: Record<ApplicationEvent, string> = {
  applied: 'Applied',
  filtered_out: 'Filtered out by a must-have question',
  shortlisted: 'Shortlisted',
  interview: 'Moved to interview',
  offer: 'Job offer drafted',
  hired: 'Hired',
  rejected: 'Rejected',
  restored: 'Restored',
  offer_declined: 'Job offer declined',
  offer_withdrawn: 'Job offer withdrawn',
};

// ---------- the API's answers ----------

export interface RecruitmentUserRef {
  email: string;
  name: string | null;
}

/** A vacancy on the list. */
export interface VacancyListItem {
  id: string;
  number: string;
  slug: string;
  title: string;
  status: VacancyStatus;
  jobTitle: { id: string; titleEn: string };
  department: { id: string; nameEn: string } | null;
  employmentType: EmploymentType;
  headcount: number;
  hired: number;
  /** Applicants in all, and those still at Applied (to review). */
  applicants: number;
  toReview: number;
  closingDate: string | null;
  publishedAt: string | null;
  createdAt: string;
  /** For a C-level grade or job title: the CEO's and a Super Admin's only. */
  confidential: boolean;
}

/** What the caller may do to a vacancy now. */
export interface VacancyCan {
  edit: boolean;
  editQuestions: boolean;
  submit: boolean;
  approve: boolean;
  sendBack: boolean;
  hold: boolean;
  reopen: boolean;
  close: boolean;
  delete: boolean;
}

/** GET /recruitment/vacancies/:id. */
export interface VacancyView extends VacancyListItem {
  grade: { id: string; code: string; levelEn: string } | null;
  hiringManager: { id: string; name: string } | null;
  workArrangement: WorkArrangement;
  shift: { id: string; code: string } | null;
  durationMonths: number | null;
  /** The internal salary range, EGP a month: HR, the CEO and a Super Admin only, never on the careers page. */
  salaryMin: number | null;
  salaryMax: number | null;
  /** The public description (cleaned HTML, as job descriptions are). */
  about: string | null;
  responsibilities: string | null;
  requirements: string | null;
  questions: VacancyQuestion[];
  stageCounts: Record<ApplicationStage, number>;
  filteredOut: number;
  submittedAt: string | null;
  submittedBy: RecruitmentUserRef | null;
  decidedAt: string | null;
  decidedBy: RecruitmentUserRef | null;
  /** Why the CEO sent it back, while it is a draft again. */
  sentBackReason: string | null;
  closedAt: string | null;
  closeReason: string | null;
  createdBy: RecruitmentUserRef | null;
  updatedAt: string;
  can: VacancyCan;
  /** How the caller sees it (Phase 2): a hiring manager without the salary range, the description or the questions' points. */
  viewer: RecruitmentViewer;
}

/** An applicant on a list. */
export interface ApplicationListItem {
  id: string;
  number: string;
  vacancy: { id: string; number: string; title: string };
  fullName: string;
  email: string;
  mobile: string;
  stage: ApplicationStage;
  filteredOut: boolean;
  matchPercent: number | null;
  points: number;
  maxPoints: number;
  yearsExperience: number | null;
  source: ApplicationSource;
  appliedAt: string;
}

/** An answer as the applicant's page shows it, with how it did. */
export interface ApplicationAnswerView {
  key: string;
  text: string;
  kind: QuestionKind;
  answer: AnswerValue;
  points: number;
  maxPoints: number;
  knockout: boolean;
  passed: boolean | null;
}

/** A step of an application's history. */
export interface ApplicationStepView {
  event: ApplicationEvent;
  stage: ApplicationStage;
  note: string | null;
  by: RecruitmentUserRef | null;
  at: string;
}

/** What the caller may do to an applicant now. */
export interface ApplicationCan {
  shortlist: boolean;
  interview: boolean;
  reject: boolean;
  restore: boolean;
  makeOffer: boolean;
  editNotes: boolean;
  /** Phase 2: schedule an interview (HR, a Super Admin). */
  scheduleInterview: boolean;
  /** Phase 2: suggest the next step or a rejection (the vacancy's hiring manager). */
  suggest: boolean;
  /** Phase 2: Reject may email the candidate (email is set up on the server). */
  emailOnReject: boolean;
}

/** GET /recruitment/applications/:id. */
export interface ApplicationView extends ApplicationListItem {
  linkedin: string | null;
  portfolio: string | null;
  noticePeriod: string | null;
  expectedSalary: number | null;
  answers: ApplicationAnswerView[];
  notes: string | null;
  rejectReason: string | null;
  consentAt: string;
  cv: { fileName: string; mimeType: string; sizeBytes: number } | null;
  history: ApplicationStepView[];
  offers: { id: string; number: string; status: string }[];
  /** The profile made when they were hired from a job offer. */
  employeeId: string | null;
  /** How the caller sees them (Phase 2): a hiring manager and an interviewer never see the expected salary nor HR's notes. */
  viewer: RecruitmentViewer;
  /** Their interviews, newest first (Phase 2). */
  interviews: InterviewView[];
  /** The scorecards the caller may see (Phase 2: an interviewer sees the others' once they gave theirs). */
  feedback: FeedbackView[];
  /** Scorecards given that the caller can't see yet (an interviewer, until they give theirs). */
  feedbackHidden: number;
  /** The hiring manager's suggestion, while HR hasn't acted on it. */
  suggestion: SuggestionView | null;
  /** What a job offer is filled in with (Make offer). */
  position: {
    jobTitleId: string;
    departmentId: string | null;
    gradeId: string | null;
    hiringManagerId: string | null;
    shiftId: string | null;
    employmentType: EmploymentType;
    workArrangement: WorkArrangement;
    durationMonths: number | null;
  };
  can: ApplicationCan;
}

/** A question as the careers page asks it: no points, no must-have rules, a choice's options by their words. */
export interface PublicQuestion {
  key: string;
  kind: QuestionKind;
  text: string;
  required: boolean;
  options: string[] | null;
}

export const publicQuestionOf = (q: VacancyQuestion): PublicQuestion => ({
  key: q.key,
  kind: q.kind,
  text: q.text,
  required: q.required,
  options: q.kind === 'choice' ? (q.options ?? []).map((o) => o.label) : null,
});

/** An open vacancy on the careers page. */
export interface PublicVacancySummary {
  slug: string;
  title: string;
  department: string | null;
  employmentType: EmploymentType;
  workArrangement: WorkArrangement;
  closingDate: string | null;
  publishedAt: string | null;
}

/** GET /public/careers/:slug: a job's page and what its form asks. */
export interface PublicVacancyView extends PublicVacancySummary {
  about: string | null;
  responsibilities: string | null;
  requirements: string | null;
  questions: PublicQuestion[];
}

/** GET /public/careers: the company and its open vacancies. */
export interface PublicCareers {
  company: { nameEn: string; nameAr: string | null };
  vacancies: PublicVacancySummary[];
}

/** POST /public/careers/:slug/apply: the application's reference. */
export interface ApplyResult {
  reference: string;
}
