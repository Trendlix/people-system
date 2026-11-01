import {
  CASUAL_MAX_MONTHS,
  CONTRACT_FORM_LABELS,
  LABELS,
  WORK_NATURE_LABELS,
  type ContractForm,
  type EmploymentType,
  type WorkNature,
} from '@trendlix/shared';
import { addDays, addMonths } from './[id]/contracts/dates';
import { formatEgp } from './[id]/contracts/salary';

// Employment types by Labour Law 14/2025 (owner, 18 October 2026: "can we update the employment types based on the labour
// law?"), in the screens' words: Sales became Full-time paid by commission, Freelance stays, outside the labour law (Art.
// 1(1)); and the law's other dimensions the owner chose to record: the contract's length (Arts. 87, 88, 155), the nature of the work
// (Art. 1(6–8)) and remote work (Art. 96(1)), with HR's warnings when a fixed-term contract has become open-ended and when
// casual work has gone past its 6 months. The rules themselves are in @trendlix/shared (employment-types.ts); here the
// hints, the labels and the badges' words. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.
//
// Since 19 October 2026 (owner: "interns to be labeled trainees instead of probation and their contracts are never
// renewed", then "or can be only renewed 1 time, after that it should be converted to a full time contract. a new trainee
// contract can be issued after 6 months of the expiration of the last trainee contract"; and "in case of trainee, we are
// not paying them salary, its just transportation allowance"): an intern's internship agreement has no probation, is
// renewed once at most, then converted to a full-time contract or ended; and the unpaid internship is a type of its own,
// outside the labour law like freelance: no wage, only allowances. It is the one internship since 25 October 2026 (owner:
// "unpaid internship and training are the same thing .. keep the unpaid internship with its document and delete the
// trainee with its documents"): the paid trainee and its training agreement went.

/**
 * An employment type as a sentence names it, in small letters and without the label's note: "full-time", "freelance"
 * (the label is "Freelance (outside the labour law)"), "unpaid internship".
 */
export function typeWord(type: EmploymentType | string): string {
  const label: string = LABELS.employmentType[type as EmploymentType] ?? type;
  return label.replace(/\s*\(.*\)$/, '').toLowerCase();
}

/** Why a freelance employment has no leave (the API refuses a request under one, and gives no annual leave). */
export const FREELANCE_NO_LEAVE =
  "No leave under a freelance employment: a freelancer works outside the labour law (Art. 1(1)), so the law's leave (Arts. 124–133) isn't theirs.";

/** The same in a few words, under the type on the profile. */
export const FREELANCE_SHORT = 'Outside the labour law (Art. 1(1)): no leave, no company social insurance, a service agreement';

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

/** The nature's label, regular for an API from before it. */
export const workNatureLabel = (nature: WorkNature | undefined) => WORK_NATURE_LABELS[nature ?? 'regular'] ?? WORK_NATURE_LABELS.regular;

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
  detail: 'The term ended without a signed renewal: renew it in writing, or record how it ends.',
};

/** The warning that casual work has gone past its 6 months (Art. 1(7)). */
export const CASUAL_TOO_LONG: LawWarning = {
  key: 'casual_too_long',
  text: `Casual work past ${CASUAL_MAX_MONTHS} months`,
  detail: 'Change the nature of the work, or end the employment.',
};

/**
 * The warning that an intern's agreement has ended while the work goes on with nothing signed after it (19 October
 * 2026): never open-ended, it is renewed once, converted to full-time or ended.
 */
export const TRAINING_ENDED: LawWarning = {
  key: 'training_ended',
  text: 'Internship ended',
  detail: 'Renew it, convert it to a full-time contract, or end it with End employment.',
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
