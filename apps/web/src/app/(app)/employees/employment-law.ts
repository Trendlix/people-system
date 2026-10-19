import {
  CASUAL_MAX_MONTHS,
  CONTRACT_FORM_LABELS,
  INTERN_DEFAULT_MONTHS,
  INTERN_MAX_MONTHS,
  LABELS,
  TRAINEE_MIN_AGE,
  TRAINEE_NOTICE_DAYS,
  TRAINING_AGAIN_AFTER_MONTHS,
  WORK_NATURE_LABELS,
  WORK_PATTERN_LABELS,
  workPatternOf,
  type ContractForm,
  type EmploymentType,
  type WorkNature,
} from '@trendlix/shared';
import { addDays, addMonths } from './[id]/contracts/dates';
import { formatEgp } from './[id]/contracts/salary';

// Employment types by Labour Law 14/2025 (owner, 18 October 2026: "can we update the employment types based on the labour
// law?"), in the screens' words: Sales became Full-time paid by commission, Internship became Trainee (the law's
// المتدرج, with a written training agreement, Arts. 28–30), Freelance stays, outside the labour law (Art. 1(1)); and the
// law's other dimensions the owner chose to record: the contract's length (Arts. 87, 88, 155), the nature of the work
// (Art. 1(6–8)) and remote work (Art. 96(1)), with HR's warnings when a fixed-term contract has become open-ended and when
// casual work has gone past its 6 months. The rules themselves are in @trendlix/shared (employment-types.ts); here the
// hints, the labels and the badges' words. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.
//
// Since 19 October 2026 (owner: "interns to be labeled trainees instead of probation and their contracts are never
// renewed", then "or can be only renewed 1 time, after that it should be converted to a full time contract. a new trainee
// contract can be issued after 6 months of the expiration of the last trainee contract"; and "in case of trainee, we are
// not paying them salary, its just transportation allowance"): a trainee's training agreement and an intern's internship
// agreement have no probation, are renewed once at most, then converted to a full-time contract or ended; and the
// unpaid internship is a type of its own, outside the labour law like freelance: no wage, only allowances.

/**
 * An employment type as a sentence names it, in small letters and without the label's note: "full-time", "trainee",
 * "freelance" (the label is "Freelance (outside the labour law)"), "unpaid internship".
 */
export function typeWord(type: EmploymentType | string): string {
  const label: string = LABELS.employmentType[type as EmploymentType] ?? type;
  return label.replace(/\s*\(.*\)$/, '').toLowerCase();
}

/** The same with its article: "a full-time", "a trainee", "an unpaid internship". */
export function aTypeWord(type: EmploymentType | string): string {
  const word = typeWord(type);
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

/** Why freelance is outside the labour law, and what follows from it. */
export const FREELANCE_NOTE =
  "Outside the labour law: a freelancer doesn't work under the company's management or supervision (Labour Law Art. 1(1): “تحت إدارته أو إشرافه”). No leave and no company social insurance; a service agreement rather than an employment contract.";

/** Why a freelance employment has no leave (the API refuses a request under one, and gives no annual leave). */
export const FREELANCE_NO_LEAVE =
  "No leave under a freelance employment: a freelancer works outside the labour law (Art. 1(1)), so the law's leave (Arts. 124–133) isn't theirs.";

/** The same in a few words, under the type on the profile. */
export const FREELANCE_SHORT = 'Outside the labour law (Art. 1(1)): no leave, no company social insurance, a service agreement';

/** How a training or internship agreement goes on (19 October 2026): renewed once, then full-time or ended; again after 6 months. */
export const TRAINING_RENEWAL_RULE = `No probation. Renewed once at most, then converted to a full-time contract or ended; a new one starts ${TRAINING_AGAIN_AFTER_MONTHS} months after the last one ended at the earliest.`;

/** A trainee: who it is, and the training agreement their contract is. */
export const TRAINEE_NOTE = `Learns a trade for pay (Labour Law Art. 1(2): “بقصد تعلم مهنة أو صنعة أو حرفة لقاء أجر”), at least ${TRAINEE_MIN_AGE} years old (Art. 28). The contract is the training agreement: its stages, each with its pay rising, the last at least the minimum wage (Art. 29); either side may end it with ${TRAINEE_NOTICE_DAYS} days' notice (Art. 30). ${TRAINING_RENEWAL_RULE}`;

/** An intern (19 October 2026: "we are not paying them salary, its just transportation allowance"): the unpaid internship. */
export const INTERN_NOTE = `Unpaid, outside the labour law: an internship agreement that pays no wage, only allowances such as transportation, for ${INTERN_DEFAULT_MONTHS} months unless you choose another (${INTERN_MAX_MONTHS} at most). No leave and no company social insurance. ${TRAINING_RENEWAL_RULE}`;

/** The same in a few words, under the type on the profile. */
export const INTERN_SHORT = 'Outside the labour law: no wage (allowances only), no probation, no leave, no company social insurance';

/** Why an intern has no leave (the API refuses a request under one, and gives no annual leave). */
export const INTERN_NO_LEAVE =
  "No leave under an unpaid internship: an intern works outside the labour law, so the law's leave (Arts. 124–133) isn't theirs.";

/** Why an employment outside the labour law has no leave: a freelancer's or an intern's (null for any other type). */
export function noLeaveText(type: EmploymentType | string): string | null {
  return type === 'freelance' ? FREELANCE_NO_LEAVE : type === 'intern' ? INTERN_NO_LEAVE : null;
}

/** The note under an employment type outside the labour law, on the profile and an offer: freelance's or the intern's. */
export function outsideLawShort(type: EmploymentType | string): string | undefined {
  return type === 'freelance' ? FREELANCE_SHORT : type === 'intern' ? INTERN_SHORT : undefined;
}

/**
 * Where the contract's terms are, from the form the type is chosen on: below it (hiring in one form), on the Employment
 * tab, or once an offer is accepted.
 */
export type TermsPlace = 'below' | 'tab' | 'offer';

const STAGES_PLACE: Record<TermsPlace, string> = {
  below: 'Its stages are set below.',
  tab: 'Its stages are set on the contract, on the Employment tab.',
  offer: 'Its stages are set on the contract once the offer is accepted.',
};

/**
 * The hint under the employment type, for the type chosen: where part-time pay is set (not on an offer, whose terms
 * have it), the trainee's training agreement and freelance outside the law. Null for full-time (paid by commission
 * has its own hint).
 */
export function employmentTypeHint(type: string, place: TermsPlace): string | null {
  // the pay terms belong to the contract, not the employment (owner, 15 October 2026)
  if (type === 'part_time') {
    if (place === 'offer') return null;
    return place === 'below'
      ? "Pay by the hour, hours a week and days a week are the contract's terms, below."
      : "Pay by the hour, hours a week and days a week are the contract's terms: a new version of it, on the Employment tab.";
  }
  if (type === 'trainee') return `${TRAINEE_NOTE} ${STAGES_PLACE[place]}`;
  if (type === 'intern') return INTERN_NOTE;
  if (type === 'freelance') return FREELANCE_NOTE;
  return null;
}

/** The hint under Paid by commission (full-time only). */
export const COMMISSION_HINT =
  'As Sales was: full-time, with a commission on what they sell (the law\'s wage includes “العمولة أو النسبة المئوية”, Labour Law Art. 1(4)). Its contract and job offer come from the "paid by commission" templates once they are published, else the full-time ones.';

/** What each nature of the work is, in the law's words (Art. 1(6–8)), under the field. */
export const WORK_NATURE_HINTS: Record<WorkNature, string> = {
  regular: "The company's ongoing work.",
  temporary: "Of the company's own kind, but needing a set time, or one job in itself that ends with it (Labour Law Art. 1(6)).",
  casual: `Not of the company's own kind, and done within ${CASUAL_MAX_MONTHS} months (Labour Law Art. 1(7)): HR is warned once it goes past them.`,
  seasonal: 'Done in recognised seasons that come back each year (Labour Law Art. 1(8)).',
};

/** The nature's label, regular for an API from before it. */
export const workNatureLabel = (nature: WorkNature | undefined) => WORK_NATURE_LABELS[nature ?? 'regular'] ?? WORK_NATURE_LABELS.regular;

/**
 * The work arrangement in the law's words, for a note under it: "Remote work (Labour Law Art. 96(1))" for Work from home,
 * "Partly remote work (Labour Law Art. 96(1))" for Hybrid; null on site (the office, the field).
 */
export function workPatternNote(workArrangement: string): string | null {
  const pattern = workPatternOf(workArrangement);
  return pattern === 'on_site' ? null : `${WORK_PATTERN_LABELS[pattern]} (Labour Law Art. 96(1))`;
}

/**
 * A contract's length in a few words: "Fixed-term · 12 months" (its months when known), "Open-ended", "For a specific
 * job: Building the new website", as the contract and the lists show it.
 */
export function contractLengthText(c: { form: ContractForm; durationMonths?: number | null; jobToDo?: string | null }): string {
  const label = CONTRACT_FORM_LABELS[c.form] ?? CONTRACT_FORM_LABELS.fixed;
  if (c.form === 'open_ended') return label;
  if (c.form === 'specific_job') return c.jobToDo ? `${label}: ${c.jobToDo}` : label;
  return c.durationMonths ? `${label} · ${c.durationMonths} ${c.durationMonths === 1 ? 'month' : 'months'}` : label;
}

/** What an open-ended contract means, under Contract length and on the contract. */
export const OPEN_ENDED_NOTE =
  "No end date and no renewal: either side ends it with 3 months' written notice (Labour Law Art. 156: “جاز لأى من طرفيه إنهاؤه بشرط أن يخطر الطرف الآخر كتابة قبل الإنهاء بثلاثة أشهر”).";

/** What a contract for a specific job means. */
export const SPECIFIC_JOB_NOTE =
  'It ends when the job is done (Labour Law Art. 155: “انتهى العقد بإنجاز هذا العمل”); renewed by an express agreement for another like it, and carried on after it, it counts as renewed.';

/** One of HR's warnings about an employment or its contract, as a badge: its words, and what it means. */
export interface LawWarning {
  key: 'became_open_ended' | 'casual_too_long' | 'training_ended';
  text: string;
  detail: string;
}

/** The warning that a fixed-term contract has become open-ended (Art. 88(3)). */
export const BECAME_OPEN_ENDED: LawWarning = {
  key: 'became_open_ended',
  text: 'Became open-ended — Art. 88',
  detail:
    'The fixed term ended and the work went on without a signed renewal, so the law counts the contract as open-ended (Labour Law Art. 88(3): “واستمر الطرفان فى تنفيذه بعد انتهاء هذه المدة دون اتفاق مكتوب بينهما”). Renew it in writing, or record how it ends.',
};

/** The warning that casual work has gone past its 6 months (Art. 1(7)). */
export const CASUAL_TOO_LONG: LawWarning = {
  key: 'casual_too_long',
  text: `Casual work past ${CASUAL_MAX_MONTHS} months`,
  detail: `Casual work takes no more than ${CASUAL_MAX_MONTHS} months (Labour Law Art. 1(7): “ولا يستغرق إنجازه أكثر من ستة أشهر”). Change the nature of the work, or end the employment.`,
};

/**
 * The warning that a trainee's or an intern's agreement has ended while the work goes on with nothing signed after it
 * (19 October 2026): never open-ended, it is renewed once, converted to full-time or ended.
 */
export const TRAINING_ENDED: LawWarning = {
  key: 'training_ended',
  text: 'Training ended',
  detail:
    'The training or internship agreement has ended, and the work goes on with nothing signed after it. Renew it, if it hasn’t been renewed yet; convert it to a full-time contract; or end the training with End employment, choosing Training completed.',
};

/** HR's warnings on an employment or a contract, as the API sends them (each left out by an older API). */
export function lawWarnings(x: { becameOpenEnded?: boolean; casualTooLong?: boolean }): LawWarning[] {
  return [x.becameOpenEnded && BECAME_OPEN_ENDED, x.casualTooLong && CASUAL_TOO_LONG].filter((w): w is LawWarning => !!w);
}

// ---------- a fixed term the company doesn't renew (Art. 154) ----------

/**
 * Art. 154's note, as the API words it on the ending (owner, 18 October 2026): "فإذا كان الإنهاء من جانب صاحب العمل استحق
 * العامل مكافأة تعادل أجر شهر عن كل سنة من سنوات الخدمة". Whether it applies to a term of five years or less is for the
 * company's lawyer, so it is information only: no money is moved.
 */
export const ART_154_NOTE = "Under Art. 154 the employee may be owed one month's wage for each year of service — check with your lawyer";

/** Whole months from one date to another (YYYY-MM-DD): 1 January to 31 December is 11, to 1 January next year 12. */
function fullMonths(from: string, to: string): number {
  let months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  if (addMonths(from, months) > to) months--;
  return Math.max(0, months);
}

/** Art. 154's estimate: the years of service (to two decimals) and, with the wage, the amount; as the ending's art154Estimate. */
export interface Art154Estimate {
  serviceYears: number;
  lastMonthlyWage: number | null;
  amount: number | null;
}

/**
 * Art. 154's estimate before the ending is saved, worked out as the API does: the service from the join date to the last
 * working day in whole months, as years to two decimals, × the last monthly wage (the gross and the allowances of the
 * contract in force; null when hidden with the salary).
 */
export function art154Estimate(joinDate: string, lastWorkingDay: string, monthlyWage: number | null): Art154Estimate {
  const months = fullMonths(joinDate, addDays(lastWorkingDay, 1));
  const wageCents = monthlyWage === null ? null : Math.round(monthlyWage * 100);
  return {
    serviceYears: Math.round((months / 12) * 100) / 100,
    lastMonthlyWage: wageCents === null ? null : wageCents / 100,
    amount: wageCents === null ? null : Math.round((wageCents * months) / 12) / 100,
  };
}

const yearsText = (years: number) => `${years} ${years === 1 ? 'year' : 'years'}`;

/**
 * The estimate in words: "2.5 years of service × EGP 15,000.00, the last monthly wage: about EGP 37,500.00.
 * Information only: no money is moved."; without the wage, the years alone.
 */
export function art154Text(e: Art154Estimate): string {
  const service = `${yearsText(e.serviceYears)} of service`;
  const sum =
    e.amount !== null && e.lastMonthlyWage !== null
      ? `${service} × ${formatEgp(e.lastMonthlyWage)}, the last monthly wage: about ${formatEgp(e.amount)}.`
      : `${service}.`;
  return `${sum} Information only: no money is moved.`;
}
