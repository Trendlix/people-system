import { insuredWageDate, insuredWageFrom, insuredWageVersion, type InsuredWage, type LawRates } from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * The insured wage social insurance Form 1 prints and payroll deducts insurance on (owner's decisions, 16 October 2026):
 * the comprehensive wage, the employee's own else the contract's gross and allowances, within the insurable limits of
 * the year's rates set by law (`rates`: LawRatesService's for the year). Null without either. The Social Insurance tab
 * shows it for this year, a payroll run uses the run's year.
 */
export function insuredWageOfEmployee(ownComprehensive: number | null, contractTotal: number | null, rates: LawRates): InsuredWage | null {
  const comprehensive = ownComprehensive ?? contractTotal;
  return comprehensive === null ? null : insuredWageFrom(comprehensive, rates);
}

/** A signed contract version as the insured wage reads it: its number, its gross and allowances a month, and, after a raise, from when the insured wage follows it. */
export interface InsuredVersion {
  version: number;
  total: number;
  insuredWageFrom: string | null;
  form2From: string | null;
}

/**
 * The contract pay the insured wage stands on a day (owner's decision, 16 October 2026: "From the next January unless
 * amended in Form 2"): the signed version's (`signed`: the employment's contract, the newest signed), or after a raise
 * the version before it until the raise's insured-wage date, and so back (shared insuredWageVersion), as payroll does.
 * `asBefore`: while it is the pay before a raise, until when, and whether Form 2 was filed for it. Null pay without a
 * signed version.
 */
export function insuredContractPay(
  signed: InsuredVersion | null,
  versions: readonly InsuredVersion[],
  day: string,
): { total: number | null; asBefore: { until: string; form2Filed: boolean } | null } {
  if (!signed) return { total: null, asBefore: null };
  const on = insuredWageVersion(signed, versions, day);
  return { total: on.total, asBefore: on === signed ? null : { until: signed.insuredWageFrom!, form2Filed: signed.form2From !== null } };
}

/** What a contract row needs for insuredVersionOf. */
export const INSURED_VERSION = {
  id: true,
  version: true,
  approval: true,
  startDate: true,
  form2From: true,
  grossSalary: true,
  allowances: { select: { amount: true } },
} satisfies Prisma.ContractSelect;

/** A contract row as the insured wage reads it: a version the CEO approved for new pay has its insured-wage date. */
export function insuredVersionOf(c: Prisma.ContractGetPayload<{ select: typeof INSURED_VERSION }>): InsuredVersion & { id: string } {
  const cents = Math.round(c.grossSalary.toNumber() * 100) + c.allowances.reduce((sum, a) => sum + Math.round(a.amount.toNumber() * 100), 0);
  const form2From = fromDateOnly(c.form2From);
  return {
    id: c.id,
    version: c.version,
    total: cents / 100,
    insuredWageFrom: c.approval === null ? null : insuredWageDate(fromDateOnly(c.startDate), form2From),
    form2From,
  };
}
