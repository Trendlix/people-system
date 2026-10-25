// Employment types by Labour Law No. 14 of 2025 (owner, 18 October 2026: "can we update the employment types based on
// the labour law?"). The types themselves are EMPLOYMENT_TYPES (index.ts) and a contract's length CONTRACT_FORMS
// (contracts.ts); here the law's other dimensions the owner chose to record: the nature of the work (Art. 1(6–8)),
// remote work (Art. 96(1)) and the fixed-term contract that has become open-ended (Art. 88(3)); and since 19 October
// 2026 the unpaid internship and its internship agreement (no probation, renewed once, then full-time). The paid trainee
// and its training agreement went on 25 October 2026 (owner: "unpaid internship and training are the same thing .. keep
// the unpaid internship with its document and delete the trainee with its documents"). Dates: YYYY-MM-DD. Pure: the web
// shows these live and the API checks the same.

import type { WorkArrangement } from './index.js';

// ---------- the nature of the work (Art. 1(6–8)) ----------

/**
 * The nature of the work: regular (the default), or one of the law's three (Art. 1): temporary ("العمل المؤقت: العمل
 * الذى يدخل بطبيعته فيما يزاوله صاحب العمل من نشاط وتقتضى طبيعة إنجازه مدة محددة، أو ينصب على عمل بذاته، وينتهى
 * بانتهائه"), casual ("العمل العرضى: العمل الذى لا يدخل بطبيعته فيما يزاوله صاحب العمل من نشاط ولا يستغرق إنجازه أكثر من
 * ستة أشهر") and seasonal ("العمل الموسمى: العمل الذى يتم فى مواسم دورية متعارف عليها").
 */
export const WORK_NATURES = ['regular', 'temporary', 'casual', 'seasonal'] as const;
export type WorkNature = (typeof WORK_NATURES)[number];
export const WORK_NATURE_LABELS: Record<WorkNature, string> = { regular: 'Regular', temporary: 'Temporary', casual: 'Casual', seasonal: 'Seasonal' };
export const WORK_NATURE_LABELS_AR: Record<WorkNature, string> = { regular: 'عمل دائم', temporary: 'عمل مؤقت', casual: 'عمل عرضي', seasonal: 'عمل موسمي' };
export const isWorkNature = (nature: unknown): nature is WorkNature => (WORK_NATURES as readonly unknown[]).includes(nature);

/** Casual work takes no more than six months (Art. 1(7): "ولا يستغرق إنجازه أكثر من ستة أشهر"). */
export const CASUAL_MAX_MONTHS = 6;

/**
 * Whether casual work has gone on past the law's six months: on `today` (or the day the employment ended, when that is
 * earlier: pass it as `today`) six months or more have passed since the join date (joined 1 January: past them on 1
 * July). The caller checks that the work is casual. A warning for HR, nothing is refused.
 */
export function casualTooLong(joinDate: string, today: string): boolean {
  if (!isDate(joinDate) || !isDate(today)) return false;
  return today >= plusMonths(joinDate, CASUAL_MAX_MONTHS);
}

// ---------- remote work (Art. 96(1)) ----------

/**
 * Where the work is done, in the law's words: remote work is one of the new patterns of work (Art. 96(1): "العمل عن
 * بعد، وهو أداء العمل فى مكان يختلف عن المقر التقليدى للمنشأة، ويتم تنفيذه من خلال الوسائل التكنولوجية"). Worked out
 * from the work arrangement: Work from home is remote, Hybrid partly remote, the others on site (the office, the field).
 */
export const WORK_PATTERNS = ['on_site', 'partly_remote', 'remote'] as const;
export type WorkPattern = (typeof WORK_PATTERNS)[number];
export const WORK_PATTERN_LABELS: Record<WorkPattern, string> = { on_site: 'On site', partly_remote: 'Partly remote work', remote: 'Remote work' };
export const WORK_PATTERN_LABELS_AR: Record<WorkPattern, string> = { on_site: 'في موقع العمل', partly_remote: 'عمل عن بعد جزئيًا', remote: 'عمل عن بعد' };

/** The law's work pattern of a work arrangement (see WORK_PATTERNS). */
export function workPatternOf(workArrangement: WorkArrangement | string | null | undefined): WorkPattern {
  return workArrangement === 'wfh' ? 'remote' : workArrangement === 'hybrid' ? 'partly_remote' : 'on_site';
}

// ---------- the internship agreement: no probation, renewed once, then full-time (19 October 2026) ----------

/**
 * The employment types whose contract is an agreement to learn rather than an employment contract (owner, 19 October
 * 2026: "interns to be labeled trainees instead of probation and their contracts are never renewed", then "or can be only
 * renewed 1 time, after that it should be converted to a full time contract. a new trainee contract can be issued after
 * 6 months of the expiration of the last trainee contract"): the intern's internship agreement (the unpaid internship,
 * outside the labour law), the one such type since 25 October 2026 (owner: "unpaid internship and training are the same
 * thing"), so training and the internship are one. It has no probation (Art. 90's is an employment contract's); it is
 * renewed once at most, then converted to a full-time contract on the same employment (the service counting on), or
 * ended; and a new one for the same person starts 6 months after the last one ended at the earliest.
 */
export const TRAINING_TYPES = ['intern'] as const;
export type TrainingType = (typeof TRAINING_TYPES)[number];
export const isTrainingType = (type: unknown): type is TrainingType => type === 'intern';

/** The agreement, as a sentence names it. */
export const INTERNSHIP_AGREEMENT = 'internship agreement';

/** How many times an agreement is renewed: once ("or can be only renewed 1 time"). */
export const TRAINING_RENEWALS = 1;

/** The months after the last agreement ended before a new one may start ("after 6 months of the expiration"). */
export const TRAINING_AGAIN_AFTER_MONTHS = 6;

/** What follows an agreement when it ends: renewed once or converted, or (the renewal ending) converted or ended. */
export const TRAINING_NEXTS = ['renew_or_convert', 'convert_or_end'] as const;
export type TrainingNext = (typeof TRAINING_NEXTS)[number];

/** What follows an employment's `agreement`-th agreement (1: the first, 2: its renewal). */
export const trainingNext = (agreement: number): TrainingNext => (agreement <= TRAINING_RENEWALS ? 'renew_or_convert' : 'convert_or_end');

/**
 * The reminder for an agreement's end, never "due for renewal": "Internship ends on 31/03/2027: renew it once, or
 * convert to full-time." for the first; "…: convert to full-time, or end the internship." for the renewal; "ended" once
 * past.
 */
export function trainingEndsText(endDate: string, next: TrainingNext, today: string): string {
  const way = next === 'renew_or_convert' ? 'renew it once, or convert to full-time' : 'convert to full-time, or end the internship';
  return `Internship ${endDate < today ? 'ended' : 'ends'} on ${shown(endDate)}: ${way}.`;
}

/** Why an agreement isn't renewed a second time (409). */
export const RENEWED_ONCE_MESSAGE = 'An internship agreement is renewed once. Convert it to a full-time contract instead.';

/** Why an intern's agreement takes no probation (400). */
export const NO_PROBATION_MESSAGE =
  'An intern has no probation: an internship agreement isn’t an employment contract, and probation (Labour Law Art. 90) is an employment contract’s. Leave the probation at 0.';

/** The first day a new agreement may start after the last one ended: 6 months after the day after (ended 31 October: 1 May). */
export const trainingAgainFrom = (lastEnded: string): string => plusMonths(plusDays(lastEnded, 1), TRAINING_AGAIN_AFTER_MONTHS);

/** Whether an agreement starting on `startDate` is too soon after the last one ended (`lastEnded`, null for none). */
export const trainingTooSoon = (lastEnded: string | null, startDate: string): boolean => lastEnded !== null && isDate(lastEnded) && startDate < trainingAgainFrom(lastEnded);

/**
 * Why a new agreement can't start yet: "A new internship agreement for Sara Ali can start from 01/05/2027, six months
 * after their last one ended on 31/10/2026."
 */
export const trainingTooSoonMessage = (name: string, lastEnded: string): string =>
  `A new ${INTERNSHIP_AGREEMENT} for ${name} can start from ${shown(trainingAgainFrom(lastEnded))}, six months after their last one ended on ${shown(lastEnded)}.`;

/** An employment and its contract versions, as lastTrainingEnd reads them. Dates: YYYY-MM-DD. */
export interface TrainingHistory {
  employmentType: string;
  endDate: string | null;
  contracts: readonly {
    version: number;
    kind: string;
    status: string;
    startDate: string;
    endDate: string | null;
    /** The type a version converted the employment to (an intern's agreement converted to full-time); null for others. */
    convertsTo: string | null;
  }[];
}

/**
 * The last day of the person's last internship agreement, from their employments: null when they never had one. An
 * agreement is a signed whole contract (not a salary amendment) of an intern's employment, or of one converted to
 * full-time before the conversion. It ended on its end date, the day before the version that replaced it started, or the
 * day the employment ended, whichever came first; an intern's employment that ended without a signed agreement, on the
 * day it ended.
 */
export function lastTrainingEnd(employments: readonly TrainingHistory[]): string | null {
  let last: string | null = null;
  const later = (d: string | null) => {
    if (d && isDate(d) && (last === null || d > last)) last = d;
  };
  for (const e of employments) {
    const signed = e.contracts.filter((c) => c.status !== 'draft' && c.kind === 'contract').sort((a, b) => a.version - b.version);
    const conversion = signed.find((c) => c.convertsTo !== null);
    const agreements = signed.filter((c) => c.convertsTo === null && (isTrainingType(e.employmentType) || (conversion !== undefined && c.version < conversion.version)));
    const agreement = agreements.at(-1);
    if (!agreement) {
      if (isTrainingType(e.employmentType)) later(e.endDate);
      continue;
    }
    const next = signed.find((c) => c.version > agreement.version);
    const ends = [agreement.endDate, next ? plusDays(next.startDate, -1) : null, e.endDate].filter((d): d is string => d !== null && isDate(d)).sort();
    later(ends[0] ?? null);
  }
  return last;
}

// ---------- the unpaid internship (19 October 2026) ----------

/**
 * An intern's internship agreement (owner, 19 October 2026: "in case of trainee, we are not paying them salary, its just
 * transportation allowance"): no wage (the gross is 0), allowances paid on top (the transportation allowance), a short
 * fixed term, 3 months unless HR sets another and 12 at most, and no probation; outside the labour law, so no leave and
 * no company social insurance.
 */
export const INTERN_DEFAULT_MONTHS = 3;
export const INTERN_MAX_MONTHS = 12;

/** What the screens show for an intern's gross. */
export const INTERN_NO_WAGE_TEXT = 'No wage (unpaid internship)';

/** Why an intern's agreement takes no gross (400). */
export const INTERN_NO_WAGE_MESSAGE =
  'An intern is unpaid (an unpaid internship, outside the labour law): leave the gross salary out, it is 0. Allowances, such as transportation, are paid on top.';

/** Why an intern's agreement is no longer than 12 months (400). */
export const INTERN_TERM_MESSAGE = `An internship agreement is short: 1 to ${INTERN_MAX_MONTHS} months (${INTERN_DEFAULT_MONTHS} unless you choose another).`;

// ---------- the fixed-term contract that has become open-ended (Art. 88(3)) ----------

/**
 * Whether a fixed-term contract has become open-ended (Art. 88: "يعتبر عقد العمل غير محدد المدة منذ إبرامه فى الحالات
 * الآتية: … ٣- إذا كان مبرما لمدة محددة واستمر الطرفان فى تنفيذه بعد انتهاء هذه المدة دون اتفاق مكتوب بينهما"): fixed-
 * term, its end date passed, and the employment going on without a signed renewal (nor ended by then). A warning for HR:
 * the contract stays as it was signed.
 */
export function becameOpenEnded(c: { form: string; endDate: string | null; renewedOrEnded: boolean }, today: string): boolean {
  return c.form === 'fixed' && c.endDate !== null && isDate(c.endDate) && c.endDate < today && !c.renewedOrEnded;
}

// ---------- dates ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: string) => DATE.test(s);
const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
const plusDays = (date: string, n: number) => new Date((dayNumber(date) + n) * 86_400_000).toISOString().slice(0, 10);
/** The date `n` months after `date`, its day kept or the month's last day (31 August + 6 months: 28 or 29 February). */
function plusMonths(date: string, n: number): string {
  const index = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + n;
  const [y, m] = [Math.floor(index / 12), (index % 12) + 1];
  return `${y}-${pad(m)}-${pad(Math.min(Number(date.slice(8, 10)), daysInMonth(y, m)))}`;
}
/** A date as the screens and messages show it: DD/MM/YYYY. */
const shown = (date: string) => (isDate(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : date);
