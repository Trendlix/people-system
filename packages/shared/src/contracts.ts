// Contracts and how an employment ends. The owner's decisions of 15 October 2026, checked against Labour Law No. 14 of
// 2025 (in force 1 September 2025): contracts are fixed-term for a year (since 18 October 2026 the default, open-ended
// and specific-job ones allowed too: CONTRACT_FORMS), the first three months are probation (once per employer, Art.
// 90), resignation needs three months' notice (Art. 156), and an ending is approved by HR, then the CEO.

import { isPerAccount } from './client-accounts.js';

/**
 * A contract's length (Labour Law 14/2025 Art. 87: "يبرم عقد العمل الفردى لمدة غير محددة، أو لمدة محددة إذا كانت طبيعة
 * العمل تقتضى ذلك"; Art. 155: "إذا أبرم عقد العمل لإنجاز عمل معين، انتهى العقد بإنجاز هذا العمل"). On 15 October 2026 the
 * owner had every contract fixed-term; on 18 October 2026 ("can we update the employment types based on the labour
 * law?") open-ended and specific-job contracts came back as choices, fixed-term for a year staying the default. An
 * open-ended contract has no end date, no duration and no renewal: it ends by notice (Art. 156: "إذا كان عقد العمل غير
 * محدد المدة، جاز لأى من طرفيه إنهاؤه بشرط أن يخطر الطرف الآخر كتابة قبل الإنهاء بثلاثة أشهر"); a specific-job one names
 * the job, its end date (when the job is expected to be done) optional.
 */
export const CONTRACT_FORMS = ['fixed', 'open_ended', 'specific_job'] as const;
export type ContractForm = (typeof CONTRACT_FORMS)[number];
export const CONTRACT_FORM_LABELS: Record<ContractForm, string> = { fixed: 'Fixed-term', open_ended: 'Open-ended', specific_job: 'For a specific job' };
export const CONTRACT_FORM_LABELS_AR: Record<ContractForm, string> = { fixed: 'محدد المدة', open_ended: 'غير محدد المدة', specific_job: 'لإنجاز عمل معين' };
export const isContractForm = (form: unknown): form is ContractForm => (CONTRACT_FORMS as readonly unknown[]).includes(form);

/**
 * How a contract's or an offer's pay is set (owner's request, 15 October 2026): a monthly salary, or by the hour
 * (part-time, e.g. two or three days a week), when the gross is the monthly estimate (see monthlyFromHourly).
 */
export const PAY_BASES = ['monthly', 'hourly'] as const;
export type PayBasis = (typeof PAY_BASES)[number];
export const PAY_BASIS_LABELS: Record<PayBasis, string> = { monthly: 'Monthly salary', hourly: 'By the hour' };
export const PAY_BASIS_LABELS_AR: Record<PayBasis, string> = { monthly: 'راتب شهري', hourly: 'بالساعة' };

/**
 * A salary of 0 (owner, 27 October 2026: "why isn't accepting a zero salary? this case for example is paid per account
 * only"): for someone paid per client account alone, a monthly salary of 0 with the per-account allowance, their pay the
 * accounts they hold (client-accounts.ts). Any other salary is more than 0; an unpaid intern's 0 is its own rule
 * (employment-types.ts INTERN_NO_WAGE_TEXT).
 */
export const ZERO_SALARY_MESSAGE = 'A salary of 0 is for someone paid per client account only: add a per-account allowance (e.g. Accounts allowance), or enter the salary.';

/** Why a gross can't be 0 (null: it isn't 0, or the allowances include one paid per client account). */
export function zeroSalaryProblem(grossSalary: number, allowances: readonly { basis?: string | null }[]): string | null {
  return Math.round(grossSalary * 100) === 0 && !allowances.some((a) => isPerAccount(a)) ? ZERO_SALARY_MESSAGE : null;
}

/** Weeks in a month on average: 52 ÷ 12. */
export const WEEKS_PER_MONTH = 52 / 12;

/** By the hour: the monthly estimate, rate × hours a week × 52 ÷ 12, to the piaster. */
export function monthlyFromHourly(hourlyRate: number, hoursPerWeek: number): number {
  return Math.round((hourlyRate * hoursPerWeek * WEEKS_PER_MONTH + Number.EPSILON) * 100) / 100;
}

/**
 * A minimum a month by the hour (owner, 27 October 2026: "can i add rate per hour with a minimum monthly payment?"; he
 * chose "On each contract" and "Prorated by days"): a contract or an offer paid by the hour may set the least paid a
 * month. Payroll pays the hours worked × the rate, or the minimum for the days paid if that is more (payroll.ts
 * hourlyMinimumFor), so a rate of 250 with a minimum of 12,000 pays 12,000 for 32 hours (8,000) in a whole month. A
 * monthly salary has none: sent with one, it is refused.
 */
export const HOURLY_MINIMUM_MESSAGE = 'A monthly salary has no minimum a month: that is for pay by the hour. Clear it, or choose pay by the hour.';

/**
 * The contract and offer templates' line for a minimum a month by the hour (the hourly_minimum_line tags): "A minimum of
 * 12,000.00 a month: paid when the hours worked come to less, prorated by days for a part month"; blank without one.
 * `money` writes an amount.
 */
export function hourlyMinimumLine(minimum: number | null | undefined, money: (n: number) => string, lang: 'en' | 'ar' = 'en'): string {
  if (!(typeof minimum === 'number' && minimum > 0)) return '';
  return lang === 'ar'
    ? `حد أدنى شهري قدره ${money(minimum)}، يُصرف إذا قلّ أجر ساعات العمل الفعلية عنه، ويُحتسب بنسبة الأيام عن الشهر غير الكامل`
    : `A minimum of ${money(minimum)} a month: paid when the hours worked come to less, prorated by days for a part month`;
}

/** A contract version's progress. Signed versions are never edited; a renewal or a change is a new version. */
export const CONTRACT_STATUSES = ['draft', 'active', 'ended', 'superseded'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Draft',
  active: 'Signed',
  ended: 'Ended',
  superseded: 'Replaced',
};

/** How a notice period is counted. Working days follow the employee's shift (Sun–Thu when there is none). */
export const NOTICE_UNITS = ['days', 'working_days', 'weeks', 'months'] as const;
export type NoticeUnit = (typeof NOTICE_UNITS)[number];
export const NOTICE_UNIT_LABELS: Record<NoticeUnit, string> = { days: 'days', working_days: 'working days', weeks: 'weeks', months: 'months' };

/** Who may start an ending. */
export const INITIATORS = ['employee', 'company', 'either', 'none'] as const;
export type Initiator = (typeof INITIATORS)[number];

/** The ways an employment can end, each a rule HR can tune in Settings (notice, pay in lieu, whether it is offered). */
export const ENDING_RULES = [
  'probation',
  'resignation',
  'non_renewal',
  'company_notice',
  'misconduct',
  'absence',
  'mutual_agreement',
  'family_reasons',
  'retirement',
  'death',
  'disability',
  // an intern's internship agreement ending with its term (owner, 19 October 2026:
  // "their contracts are never renewed", then "or can be only renewed 1 time, after that it should be converted to a full
  // time contract"): it is renewed once at most, and ends with its last day unless converted to a full-time contract
  'training_completed',
] as const;
export type EndingRuleKey = (typeof ENDING_RULES)[number];

/** Each rule as first seeded: what it is, who starts it, its notice, how it ends the employment, and its legal source. */
export const ENDING_RULE_DEFAULTS: Record<
  EndingRuleKey,
  { label: string; initiator: Initiator; noticeAmount: number; noticeUnit: NoticeUnit; payInLieu: boolean; endReason: EndReason; source: string }
> = {
  probation: { label: 'Ending during probation', initiator: 'either', noticeAmount: 2, noticeUnit: 'weeks', payInLieu: false, endReason: 'terminated', source: 'Contract clause 4' },
  resignation: { label: 'Resignation', initiator: 'employee', noticeAmount: 3, noticeUnit: 'months', payInLieu: false, endReason: 'resigned', source: 'Labour Law Arts. 156, 161, 167; Decree 187/2025' },
  non_renewal: { label: 'Fixed term not renewed', initiator: 'company', noticeAmount: 45, noticeUnit: 'working_days', payInLieu: false, endReason: 'contract_ended', source: 'Contract clause 2' },
  company_notice: { label: 'Ended by the company with notice', initiator: 'company', noticeAmount: 3, noticeUnit: 'months', payInLieu: true, endReason: 'terminated', source: 'Labour Law Arts. 156–164' },
  misconduct: { label: 'Dismissal for serious misconduct (Labour Court)', initiator: 'company', noticeAmount: 0, noticeUnit: 'days', payInLieu: false, endReason: 'terminated', source: 'Labour Law Arts. 141–148' },
  absence: { label: 'Absence (deemed resignation)', initiator: 'company', noticeAmount: 0, noticeUnit: 'days', payInLieu: false, endReason: 'resigned', source: 'Labour Law Art. 166' },
  mutual_agreement: { label: 'Mutual agreement', initiator: 'either', noticeAmount: 0, noticeUnit: 'days', payInLieu: false, endReason: 'mutual_agreement', source: 'Decree 187/2025 Art. 6' },
  family_reasons: { label: 'Marriage, pregnancy or childbirth (employee)', initiator: 'employee', noticeAmount: 0, noticeUnit: 'days', payInLieu: false, endReason: 'resigned', source: 'Labour Law Art. 58' },
  retirement: { label: 'Retirement at 60', initiator: 'company', noticeAmount: 0, noticeUnit: 'days', payInLieu: false, endReason: 'retired', source: 'Labour Law Art. 171' },
  death: { label: 'Death', initiator: 'none', noticeAmount: 0, noticeUnit: 'days', payInLieu: false, endReason: 'deceased', source: 'Labour Law Art. 169' },
  disability: { label: 'Total disability', initiator: 'none', noticeAmount: 0, noticeUnit: 'days', payInLieu: false, endReason: 'disability', source: 'Labour Law Art. 170' },
  // nobody's notice: it ends with the agreement's last day (the last working day), as its term runs out; the intern's
  // internship agreement alone since 25 October 2026, no longer the Labour Law's training agreement (Arts. 28–30)
  training_completed: {
    label: 'Training completed',
    initiator: 'none',
    noticeAmount: 0,
    noticeUnit: 'days',
    payInLieu: false,
    endReason: 'training_completed',
    source: 'The internship agreement',
  },
};

/** An ending's progress: HR records and approves it, then the CEO approves; it takes effect on the last working day. */
export const ENDING_STATUSES = ['pending_ceo', 'approved', 'rejected', 'withdrawn', 'completed'] as const;
export type EndingStatus = (typeof ENDING_STATUSES)[number];
export const ENDING_STATUS_LABELS: Record<EndingStatus, string> = {
  pending_ceo: 'Waiting for the CEO',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  completed: 'Completed',
};

/**
 * The insurable wage's limits in a year, and the year of the table they are from: the year's rates set by law
 * (law-rates.ts: the Super Admin keeps them by year in Organization → Payroll), or the built-in ones of a year. A year
 * without its own uses the latest one known before it (the earliest known for a year before them all).
 */
export function insurableWageLimits(rates: LawRatesOrYear): { year: number; min: number; max: number } {
  const r = ratesOf(rates);
  return { year: r.year, min: r.insurableWageMin, max: r.insurableWageMax };
}

/**
 * The salary on the social insurance copy: the actual gross, capped at the year's maximum insurable wage (owner's
 * decision) and never below its minimum, with the year's rates (or the built-in ones of a year). With allowances, pass
 * the gross and the insured allowances together (see insuredWageOf).
 */
export function insuredSalary(gross: number, rates: LawRatesOrYear): number {
  const limits = insurableWageLimits(rates);
  return Math.min(Math.max(gross, limits.min), limits.max);
}

/**
 * The insured wage social insurance Form 1 prints (أجر الاشتراك) and how it was worked out. Owner's decision, 16 October
 * 2026: "Apply the insurance wage cap rule from the comprehensive wage, and the insured wage field to be uneditable in
 * the Social Insurance tab": no longer the employee's own, but the comprehensive wage Form 1 prints kept within the
 * year's insurable limits.
 */
export interface InsuredWage {
  /** The comprehensive wage within the limits. */
  amount: number;
  /** The comprehensive wage it is worked out from. */
  comprehensive: number;
  /** `max`: capped at the year's maximum; `min`: raised to its minimum; null: the comprehensive wage as it is. */
  adjusted: 'max' | 'min' | null;
  /** The limits kept to, and the year of the table they are from (the latest known for a year not in it). */
  limits: { year: number; min: number; max: number };
}

/** The insured wage Form 1 prints for a comprehensive wage, with the year's rates (in Cairo): see InsuredWage. */
export function insuredWageFrom(comprehensive: number, rates: LawRatesOrYear): InsuredWage {
  const amount = insuredSalary(comprehensive, rates);
  return { amount, comprehensive, adjusted: amount < comprehensive ? 'max' : amount > comprehensive ? 'min' : null, limits: insurableWageLimits(rates) };
}

import type { EndReason } from './index.js';
import { ratesOf, type LawRatesOrYear } from './law-rates.js';

/** An allowance as the salary is worked out from it: its amount a month, and how it is treated. */
export interface AllowanceTerms {
  amount: number;
  taxable: boolean;
  insured: boolean;
}

/** The insured wage of a gross and its allowances: the gross and the insured allowances, within the year's limits. */
export function insuredWageOf(gross: number, allowances: readonly AllowanceTerms[], rates: LawRatesOrYear): number {
  const insured = allowances.reduce((sum, a) => sum + (a.insured ? a.amount : 0), 0);
  return insuredSalary(Math.round((gross + insured) * 100) / 100, rates);
}
