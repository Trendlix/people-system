// Gross to net salary in Egypt, as the Ministry of Finance's salary tax system works it out (owner, 15 October 2026,
// checked against its printout and the Tax Authority's payroll guides): social insurance on the insured wage, salary tax
// on the annual net income in Law 7/2024's tiers, and the Martyrs' Fund. Comprehensive health insurance doesn't apply in
// Cairo yet, and the salary stamp tax applies to public business-sector companies only. Allowances (owner's request,
// 15 October 2026) are paid on top of the gross: the taxable ones are taxed with it and the insured ones insured with
// it; every allowance is in the net. The rates, the exemption, the insurable limits and the tax tiers are the year's
// rates set by law (law-rates.ts, owner's request, 16 October 2026): each function takes them, or a year for the
// built-in ones.

import { insuredSalary, insuredWageOf, monthlyFromHourly, WEEKS_PER_MONTH, type AllowanceTerms } from './contracts.js';
import { beforeTaxMonthlyLimit, LAW_7_2024_TAX_TIERS, limitOf, ratesOf, taxTierLimits, type LawRatesOrYear, type TaxTier } from './law-rates.js';

/** The annual net income is rounded down to the nearest ten pounds before the tax (Law 91/2005 Art. 8). */
export const ROUND_INCOME_DOWN_TO = 10;

/** Law 7/2024's tier limits: where the tax jumps (annual net income). */
export const TAX_TIER_LIMITS: readonly number[] = taxTierLimits(LAW_7_2024_TAX_TIERS);

/** Half-up to the piaster. */
const piasters = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * The yearly salary tax on an annual net income (already after insurance, the exemption and rounding), in `tiers`
 * (Law 7/2024's unless given): the tier is the first whose limit the whole income is within, and the whole income is
 * taxed on its bands, from 0.
 */
export function annualSalaryTax(income: number, tiers: readonly TaxTier[] = LAW_7_2024_TAX_TIERS): number {
  if (income <= 0) return 0;
  // a table checked by taxTiersProblems ends with a tier without a limit; the last tier is used past any other's
  const tier = tiers.find((t) => income <= limitOf(t.upTo)) ?? tiers.at(-1);
  if (!tier) return 0;
  let tax = 0;
  let from = 0;
  for (const band of tier.bands) {
    if (income <= from) break;
    const upTo = limitOf(band.upTo);
    tax += (Math.min(income, upTo) - from) * band.rate;
    from = upTo;
  }
  return piasters(tax);
}

export interface SalaryBreakdown {
  gross: number;
  /** All the allowances a month, on top of the gross. */
  allowances: number;
  /** The allowances taxed with the gross. */
  taxableAllowances: number;
  /** The wage social insurance is paid on: the gross and the insured allowances, capped at the year's maximum insurable wage (and at least its minimum). */
  insuredWage: number;
  employeeInsurance: number;
  healthInsurance: number;
  /** Gross and taxable allowances, less what is deducted before the tax. */
  monthlyTaxable: number;
  /** × 12, less the personal exemption, rounded down to ten pounds. */
  annualNetIncome: number;
  annualTax: number;
  monthlyTax: number;
  martyrsFund: number;
  /** All the employee's deductions. */
  deductions: number;
  net: number;
  employerInsurance: number;
  /** What the employee costs the company a month: gross, allowances and the company's insurance share. */
  companyCost: number;
}

/** A month's salary tax and Martyrs' Fund, step by step: see monthlySalaryTax. */
export interface MonthlySalaryTax {
  /** Comprehensive health insurance, the employee's share: deducted before the tax (0 while it doesn't apply in Cairo). */
  healthInsurance: number;
  /** The pay taxed, less what is deducted before the tax. */
  monthlyTaxable: number;
  /** × 12, less the personal exemption, rounded down to ten pounds. */
  annualNetIncome: number;
  annualTax: number;
  monthlyTax: number;
  martyrsFund: number;
  /**
   * What the month's deductions before tax lowered the taxable pay by (owner, 20 October 2026, on the employee's medical
   * share: "Before Tax i think"): as much as they are, but never below 0 and at most a twelfth of the year's before-tax
   * health insurance limit when one is set. Missing when none were given.
   */
  beforeTax?: number;
}

/**
 * The salary tax and the Martyrs' Fund on a month's taxed pay (the salary and the taxable allowances), after the
 * employee's social insurance: the month as if paid all year (× 12), less the personal exemption, rounded down to ten
 * pounds, taxed in the tiers and ÷ 12, with the year's rates (`rates`, or the built-in ones of a year: this year's
 * unless given). Used for a contract's salary (grossToNet) and for a month's actual pay (payroll.ts). Nothing is paid
 * to the Fund on pay below zero. The month's deductions before tax (`beforeTax`; owner, 20 October 2026: "Before Tax i
 * think"; payroll.ts) lower the taxable pay first, never below 0 and within the year's before-tax health insurance limit
 * (a twelfth of it a month) when set; the Fund stays on the taxed pay.
 */
export function monthlySalaryTax(
  { taxedPay, employeeInsurance, beforeTax }: { taxedPay: number; employeeInsurance: number; beforeTax?: number },
  rates: LawRatesOrYear = new Date().getFullYear(),
): MonthlySalaryTax {
  const r = ratesOf(rates);
  const healthInsurance = piasters(Math.max(0, taxedPay) * r.healthInsuranceRate);
  const taxable = piasters(taxedPay - employeeInsurance - healthInsurance);
  // the deductions before tax: what they come to, within the limit, never taking the taxable pay below 0
  const given = typeof beforeTax === 'number' && Number.isFinite(beforeTax) && beforeTax > 0;
  const lowered = given ? piasters(Math.min(piasters(beforeTax), beforeTaxMonthlyLimit(r) ?? Infinity, Math.max(0, taxable))) : 0;
  const monthlyTaxable = piasters(taxable - lowered);
  const yearly = monthlyTaxable * 12 - r.personalExemption;
  const annualNetIncome = yearly > 0 ? Math.floor(yearly / ROUND_INCOME_DOWN_TO) * ROUND_INCOME_DOWN_TO : 0;
  const annualTax = annualSalaryTax(annualNetIncome, r.taxTiers);
  return {
    healthInsurance,
    monthlyTaxable,
    annualNetIncome,
    annualTax,
    monthlyTax: piasters(annualTax / 12),
    martyrsFund: piasters(Math.max(0, taxedPay) * r.martyrsRate),
    ...(given && { beforeTax: lowered }),
  };
}

/** The total of some allowances, to the piaster. */
const total = (allowances: readonly AllowanceTerms[], which: (a: AllowanceTerms) => boolean = () => true) =>
  piasters(allowances.reduce((sum, a) => sum + (which(a) ? Math.max(0, a.amount) : 0), 0));

/**
 * A monthly gross salary's net, step by step, with the year's rates set by law (`rates`, or the built-in ones of a
 * year: this year's unless given) and its allowances. With the same salary all year the monthly tax is the annual tax
 * ÷ 12, which is what the Ministry's system gives each month.
 */
export function grossToNet(gross: number, rates: LawRatesOrYear = new Date().getFullYear(), allowances: readonly AllowanceTerms[] = []): SalaryBreakdown {
  const r = ratesOf(rates);
  const g = Math.max(0, piasters(gross));
  const all = total(allowances);
  const taxableAllowances = total(allowances, (a) => a.taxable);
  const insuredWage = g > 0 ? insuredWageOf(g, allowances, r) : 0;
  const employeeInsurance = piasters(insuredWage * r.employeeInsuranceRate);
  const taxedPay = piasters(g + taxableAllowances);
  const { healthInsurance, monthlyTaxable, annualNetIncome, annualTax, monthlyTax, martyrsFund } = monthlySalaryTax({ taxedPay, employeeInsurance }, r);
  const deductions = piasters(employeeInsurance + healthInsurance + monthlyTax + martyrsFund);
  const employerInsurance = piasters(insuredWage * r.employerInsuranceRate);
  return {
    gross: g,
    allowances: all,
    taxableAllowances,
    insuredWage,
    employeeInsurance,
    healthInsurance,
    monthlyTaxable,
    annualNetIncome,
    annualTax,
    monthlyTax,
    martyrsFund,
    deductions,
    net: piasters(g + all - deductions),
    employerInsurance,
    companyCost: piasters(g + all + employerInsurance),
  };
}

/**
 * The lowest monthly gross whose net (allowances included) is at least `net`: grossing up. The net rises with the
 * gross except where the tax jumps at a tier's limit, so some nets can't be reached exactly; then the gross just past
 * the gap is given and its own net is in the breakdown. Searched within each stretch between the jumps, in whole pounds
 * by default (`step` 0.01 for piasters): with the income rounded down to ten pounds, several grosses a few piasters
 * apart give one net.
 */
export function netToGross(
  net: number,
  rates: LawRatesOrYear = new Date().getFullYear(),
  step: 1 | 0.01 = 1,
  allowances: readonly AllowanceTerms[] = [],
): SalaryBreakdown {
  const r = ratesOf(rates);
  const target = piasters(net);
  if (target <= 0) return grossToNet(0, r, allowances);
  const maxInsurance = insuredSalary(Number.MAX_SAFE_INTEGER, r) * r.employeeInsuranceRate;
  // counted in units of `step`: the last gross whose annual net income is within a tier's limit ends a stretch (past it
  // the tax jumps). Found by halving, the income rising with the gross, from where it would be with the insurance at
  // its cap: any tier's limit, also one below the insurable cap a changed table may have.
  const per = Math.round(1 / step);
  const taxableAllowances = total(allowances, (a) => a.taxable);
  const incomeAt = (u: number) => grossToNet(u / per, r, allowances).annualNetIncome;
  const lastWithin = (income: number, from: number) => {
    let hi = Math.max(from + 1, Math.ceil(((income + r.personalExemption + ROUND_INCOME_DOWN_TO) / 12 + maxInsurance - taxableAllowances + 1) * per));
    for (let i = 0; i < 64 && incomeAt(hi) <= income; i++) hi = hi * 2 + per;
    let lo = from;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (incomeAt(mid) <= income) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const limits: number[] = [];
  for (const income of taxTierLimits(r.taxTiers)) limits.push(lastWithin(income, limits.at(-1) ?? 0));
  const stretches: [number, number][] = [];
  let from = 0;
  for (const limit of [...limits, Math.max(Math.ceil(target * 3 * per), (limits.at(-1) ?? 0) * 2)]) {
    stretches.push([from, limit]);
    from = limit + 1;
  }
  const netAt = (u: number) => grossToNet(u / per, r, allowances).net;
  for (const [lo, hi] of stretches) {
    if (hi < lo || netAt(hi) < target) continue;
    let a = lo;
    let b = hi;
    while (a < b) {
      const mid = Math.floor((a + b) / 2);
      if (netAt(mid) >= target) b = mid;
      else a = mid + 1;
    }
    return grossToNet(a / per, r, allowances);
  }
  return grossToNet(stretches.at(-1)![1] / per, r, allowances);
}

/**
 * By the hour, from an agreed net rate (owner's request, 15 October 2026): the lowest gross hourly rate, to the
 * piaster, whose monthly estimate (rate × hours a week × 52 ÷ 12) gives at least the net of the net rate's month, with
 * its breakdown. The contract keeps the gross rate: tax and insurance are worked out from the gross. Rates rounded to
 * the piaster can't always give the net exactly; the breakdown says what this rate gives. With the year's rates set by
 * law (`rates`, or the built-in ones of a year).
 */
export function hourlyRateFromNet(
  netHourly: number,
  hoursPerWeek: number,
  rates: LawRatesOrYear = new Date().getFullYear(),
  allowances: readonly AllowanceTerms[] = [],
): { hourlyRate: number; breakdown: SalaryBreakdown } {
  const r = ratesOf(rates);
  if (!(netHourly > 0) || !(hoursPerWeek > 0)) return { hourlyRate: 0, breakdown: grossToNet(0, r, allowances) };
  const target = piasters(netHourly * hoursPerWeek * WEEKS_PER_MONTH);
  const monthly = netToGross(target, r, 0.01, allowances);
  // the rate whose monthly estimate is that gross, rounded up to the piaster, then up again while its net falls short
  let rate = Math.ceil(piasters((monthly.gross / (hoursPerWeek * WEEKS_PER_MONTH)) * 100)) / 100;
  let breakdown = grossToNet(monthlyFromHourly(rate, hoursPerWeek), r, allowances);
  for (let i = 0; i < 100 && breakdown.net < target; i++) {
    rate = piasters(rate + 0.01);
    breakdown = grossToNet(monthlyFromHourly(rate, hoursPerWeek), r, allowances);
  }
  return { hourlyRate: rate, breakdown };
}
