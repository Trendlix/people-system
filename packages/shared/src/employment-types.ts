// Employment types by Labour Law No. 14 of 2025 (owner, 18 October 2026: "can we update the employment types based on
// the labour law?"). The types themselves are EMPLOYMENT_TYPES (index.ts) and a contract's length CONTRACT_FORMS
// (contracts.ts); here the law's other dimensions the owner chose to record: the nature of the work (Art. 1(6–8)),
// remote work (Art. 96(1)), the trainee's training agreement (Arts. 28–30), and the fixed-term contract that has become
// open-ended (Art. 88(3)); and since 19 October 2026 the trainee's and the intern's agreements (no probation, renewed once,
// then full-time) and the unpaid internship. Dates: YYYY-MM-DD. Pure: the web shows these live and the API checks the same.

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

// ---------- the trainee's training agreement (Arts. 28–30) ----------

/**
 * A stage of a trainee's training (Art. 29: "يجب أن يكون اتفاق التدرج مكتوبا، وتحدد فيه على الأخص مدة تعلم المهنة أو
 * الصنعة أو الحرفة، ومراحلها المتتابعة والمكافأة التى يحصل عليها المتدرج فى كل مرحلة بصورة تصاعدية، على ألا تقل فى
 * المرحلة الأخيرة عن الحد الأدنى للأجر المحدد لفئة العمال فى المهنة، أو الصنعة أو الحرفة التى يتدرج فيها"): its name,
 * its whole months, and its pay a month (EGP).
 */
export interface TraineeStage {
  name: string;
  months: number;
  pay: number;
}

/** A trainee is at least 14 years old (Art. 28: "يشترط فى المتدرج ألا يقل سنه عن أربعة عشر عاما"). */
export const TRAINEE_MIN_AGE = 14;

/** The training's whole length, at most a contract's longest term (60 months, as a fixed term). */
export const TRAINEE_MAX_MONTHS = 60;

/**
 * Either side ends a training agreement with three days' notice at least (Art. 30: "ويشترط أن يخطر الطرف الراغب فى
 * إنهاء الاتفاق الطرف الآخر بذلك قبل الإنهاء بثلاثة أيام على الأقل"); the employer when the trainee proves unfit or
 * unwilling to learn the trade well, the trainee at will.
 */
export const TRAINEE_NOTICE_DAYS = 3;

/** What a training agreement is checked with. */
export interface TraineeInput {
  stages: readonly TraineeStage[];
  /** The minimum wage a month for the year (Payroll Setup's rates set by law); null when not set. */
  minimumWage: number | null;
  /** The trainee's date of birth; null when not recorded. */
  dateOfBirth: string | null;
  /** The training's first day. */
  startDate: string;
}

/** The training's whole length in months: its stages' months added up. */
export const traineeMonths = (stages: readonly TraineeStage[]): number => stages.reduce((sum, s) => sum + (Number.isFinite(s.months) ? s.months : 0), 0);

/**
 * What stops a training agreement (Arts. 28 and 29), in plain words: at least one stage; each named, of whole months, 1
 * or more, the whole training no longer than 60 months; the pay more than 0 and each stage's more than the one before's
 * ("بصورة تصاعدية"); the last stage's at least the minimum wage, when it is set; the trainee at least 14 on the start
 * date, when the date of birth is known. Empty when it may be signed. What can't be checked: traineeNotes.
 */
export function traineeProblems(input: TraineeInput): string[] {
  const { stages } = input;
  if (!stages.length) return ['Add at least one training stage: a training agreement sets the training’s stages and the pay of each (Labour Law Art. 29).'];
  const problems: string[] = [];
  stages.forEach((s, i) => {
    const n = i + 1;
    if (!s.name?.trim()) problems.push(`Training stage ${n} needs a name.`);
    if (!Number.isInteger(s.months) || s.months < 1) problems.push(`Training stage ${n}’s length must be a whole number of months, 1 or more.`);
    if (!Number.isFinite(s.pay) || s.pay <= 0) problems.push(`Training stage ${n}’s pay must be more than 0.`);
    else if (i > 0 && Number.isFinite(stages[i - 1].pay) && cents(s.pay) <= cents(stages[i - 1].pay)) {
      problems.push(`Training stage ${n}’s pay must be more than stage ${i}’s (${money(stages[i - 1].pay)}): the pay rises from stage to stage (Labour Law Art. 29).`);
    }
  });
  const total = traineeMonths(stages);
  if (stages.every((s) => Number.isInteger(s.months) && s.months >= 1) && total > TRAINEE_MAX_MONTHS) {
    problems.push(`The training runs for ${total} months: make it ${TRAINEE_MAX_MONTHS} months or less.`);
  }
  const last = stages[stages.length - 1];
  if (input.minimumWage !== null && input.minimumWage > 0 && Number.isFinite(last.pay) && last.pay > 0 && cents(last.pay) < cents(input.minimumWage)) {
    problems.push(`The last training stage’s pay (${money(last.pay)}) must be at least the minimum wage, ${money(input.minimumWage)} (Labour Law Art. 29).`);
  }
  if (input.dateOfBirth && isDate(input.dateOfBirth) && isDate(input.startDate)) {
    const age = fullYears(input.dateOfBirth, input.startDate);
    if (age < TRAINEE_MIN_AGE) problems.push(`A trainee must be at least ${TRAINEE_MIN_AGE} years old on the start date (Labour Law Art. 28): this one would be ${age}.`);
  }
  return problems;
}

/**
 * What can't be checked on a training agreement, for HR to see without stopping it: the minimum wage not set in Payroll
 * Setup (so the last stage's pay isn't checked against it), the date of birth not recorded (so the age isn't).
 */
export function traineeNotes(input: Pick<TraineeInput, 'minimumWage' | 'dateOfBirth'>): string[] {
  const notes: string[] = [];
  if (input.minimumWage === null || !(input.minimumWage > 0)) {
    notes.push('The minimum wage isn’t set in Payroll Setup’s rates set by law, so the last stage’s pay can’t be checked against it (Labour Law Art. 29).');
  }
  if (!input.dateOfBirth) notes.push('The date of birth isn’t on the profile, so the trainee’s age (at least 14, Labour Law Art. 28) can’t be checked.');
  return notes;
}

/** A stage with its days: the first and last, from the training's start. */
export interface TraineeStagePeriod extends TraineeStage {
  /** 0 for the first stage. */
  index: number;
  from: string;
  to: string;
}

/** The stages one after the other from the start date, each its months long (start 15 March, 3 months: to 14 June). */
export function traineeStagePeriods(stages: readonly TraineeStage[], startDate: string): TraineeStagePeriod[] {
  if (!isDate(startDate)) return [];
  const periods: TraineeStagePeriod[] = [];
  let months = 0;
  stages.forEach((s, index) => {
    const from = plusMonths(startDate, months);
    months += Number.isInteger(s.months) && s.months > 0 ? s.months : 0;
    periods.push({ ...s, index, from, to: plusDays(plusMonths(startDate, months), -1) });
  });
  return periods;
}

/**
 * The stage in force on a date, and its pay: null before the start (or without stages); after the last stage ends, the
 * last one (its pay never drops back).
 */
export function traineeStageOn(stages: readonly TraineeStage[], startDate: string, date: string): { index: number; name: string; pay: number } | null {
  const periods = traineeStagePeriods(stages, startDate);
  if (!periods.length || !isDate(date) || date < startDate) return null;
  const p = periods.find((x) => x.from <= date && date <= x.to) ?? periods[periods.length - 1];
  return { index: p.index, name: p.name, pay: p.pay };
}

// ---------- training and internship agreements: no probation, renewed once, then full-time (19 October 2026) ----------

/**
 * The employment types whose contract is an agreement to learn rather than an employment contract (owner, 19 October
 * 2026: "interns to be labeled trainees instead of probation and their contracts are never renewed", then "or can be only
 * renewed 1 time, after that it should be converted to a full time contract. a new trainee contract can be issued after
 * 6 months of the expiration of the last trainee contract"): the trainee's training agreement (Labour Law Arts. 28–30)
 * and the intern's internship agreement (the unpaid internship, outside the labour law). Neither has probation (Art.
 * 90's is an employment contract's); each is renewed once at most, then converted to a full-time contract on the same
 * employment (the service counting on), or ended; and a new one for the same person starts 6 months after the last one
 * ended at the earliest.
 */
export const TRAINING_TYPES = ['trainee', 'intern'] as const;
export type TrainingType = (typeof TRAINING_TYPES)[number];
export const isTrainingType = (type: unknown): type is TrainingType => type === 'trainee' || type === 'intern';

/** "training agreement" or "internship agreement", as a sentence names it. */
export const agreementName = (type: string): string => (type === 'intern' ? 'internship agreement' : 'training agreement');

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
 * The reminder for an agreement's end, never "due for renewal": "Training ends on 31/03/2027: renew it once, or convert
 * to full-time." for the first; "…: convert to full-time, or end the training." for the renewal; "ended" once past.
 */
export function trainingEndsText(endDate: string, next: TrainingNext, today: string): string {
  const way = next === 'renew_or_convert' ? 'renew it once, or convert to full-time' : 'convert to full-time, or end the training';
  return `Training ${endDate < today ? 'ended' : 'ends'} on ${shown(endDate)}: ${way}.`;
}

/** Why an agreement isn't renewed a second time (409). */
export const renewedOnceMessage = (type: string): string =>
  `${type === 'intern' ? 'An internship' : 'A training'} agreement is renewed once. Convert it to a full-time contract instead.`;

/** Why a trainee's or an intern's agreement takes no probation (400). */
export const noProbationMessage = (type: string): string =>
  type === 'intern'
    ? 'An intern has no probation: an internship agreement isn’t an employment contract, and probation (Labour Law Art. 90) is an employment contract’s. Leave the probation at 0.'
    : 'A trainee has no probation: a training agreement isn’t an employment contract, and probation (Labour Law Art. 90) is an employment contract’s. Leave the probation at 0.';

/** The first day a new agreement may start after the last one ended: 6 months after the day after (ended 31 October: 1 May). */
export const trainingAgainFrom = (lastEnded: string): string => plusMonths(plusDays(lastEnded, 1), TRAINING_AGAIN_AFTER_MONTHS);

/** Whether an agreement starting on `startDate` is too soon after the last one ended (`lastEnded`, null for none). */
export const trainingTooSoon = (lastEnded: string | null, startDate: string): boolean => lastEnded !== null && isDate(lastEnded) && startDate < trainingAgainFrom(lastEnded);

/**
 * Why a new agreement can't start yet: "A new training agreement for Sara Ali can start from 01/05/2027, six months after
 * their last one ended on 31/10/2026." (an internship agreement for an intern).
 */
export const trainingTooSoonMessage = (name: string, type: string, lastEnded: string): string =>
  `A new ${agreementName(type)} for ${name} can start from ${shown(trainingAgainFrom(lastEnded))}, six months after their last one ended on ${shown(lastEnded)}.`;

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
    /** The type a version converted the employment to (a trainee's or intern's converted to full-time); null for others. */
    convertsTo: string | null;
    /** Whether it has training stages (a trainee's training agreement). */
    hasStages: boolean;
  }[];
}

/**
 * The last day of the person's last training or internship agreement, from their employments: null when they never had
 * one. An agreement is a signed whole contract (not a salary amendment) of a trainee's or an intern's employment, or of
 * one converted to full-time before the conversion, or one with training stages. It ended on its end date, the day
 * before the version that replaced it started, or the day the employment ended, whichever came first; a trainee's or
 * intern's employment that ended without a signed agreement, on the day it ended.
 */
export function lastTrainingEnd(employments: readonly TrainingHistory[]): string | null {
  let last: string | null = null;
  const later = (d: string | null) => {
    if (d && isDate(d) && (last === null || d > last)) last = d;
  };
  for (const e of employments) {
    const signed = e.contracts.filter((c) => c.status !== 'draft' && c.kind === 'contract').sort((a, b) => a.version - b.version);
    const conversion = signed.find((c) => c.convertsTo !== null);
    const agreements = signed.filter((c) =>
      c.convertsTo === null && (isTrainingType(e.employmentType) || (conversion ? c.version < conversion.version : c.hasStages)),
    );
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
 * fixed term, 3 months unless HR sets another and 12 at most, no probation and no training stages; outside the labour
 * law, so no leave and no company social insurance.
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

// ---------- dates and money ----------

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
/** Whole years from one date to another: a birthday counts on its day (29 February on 28 February in other years). */
function fullYears(from: string, to: string): number {
  let years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  if (plusMonths(from, years * 12) > to) years--;
  return years;
}
/** A date as the screens and messages show it: DD/MM/YYYY. */
const shown = (date: string) => (isDate(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : date);
const cents = (n: number) => Math.round(n * 100);
/** An amount as messages show it: 7,000 EGP, 7,000.50 EGP. */
const money = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} EGP`;
