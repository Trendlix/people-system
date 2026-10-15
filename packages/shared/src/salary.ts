// Gross to net salary in Egypt, as the Ministry of Finance's salary tax system works it out (owner, 15 October 2026,
// checked against its printout and the Tax Authority's payroll guides): social insurance on the insured wage, salary tax
// on the annual net income in Law 7/2024's tiers, and the Martyrs' Fund. Comprehensive health insurance doesn't apply in
// Cairo yet, and the salary stamp tax applies to public business-sector companies only. Allowances (owner's request,
// 15 October 2026) are paid on top of the gross: the taxable ones are taxed with it and the insured ones insured with
// it; every allowance is in the net.

import { insuredSalary, insuredWageOf, monthlyFromHourly, WEEKS_PER_MONTH, type AllowanceTerms } from './contracts.js';

export const SALARY_RULES = {
  /** The employee's and the company's shares of social insurance, on the insured wage (Law 148/2019). */
  employeeInsuranceRate: 0.11,
  employerInsuranceRate: 0.1875,
  /** The yearly personal exemption (Law 91/2005 Art. 13 as replaced by Law 7/2024). */
  personalExemption: 20_000,
  /** The Martyrs' and Victims' Families Fund, on the gross (Law 4/2021). */
  martyrsRate: 0.0005,
  /** Comprehensive health insurance, the employee's share: not applied in Cairo yet (Law 2/2018). */
  healthInsuranceRate: 0,
  /** The annual net income is rounded down to the nearest ten pounds before the tax (Law 91/2005 Art. 8). */
  roundIncomeDownTo: 10,
} as const;

/** A schedule: each band's upper limit (annual net income) and its rate. */
type Schedule = readonly (readonly [upTo: number, rate: number])[];

const NORMAL: Schedule = [
  [40_000, 0],
  [55_000, 0.1],
  [70_000, 0.15],
  [200_000, 0.2],
  [400_000, 0.225],
  [Infinity, 0.25],
];

/**
 * Law 7/2024 (Art. 8, in force for salaries from 1 March 2024): the tier is chosen by the whole annual net income, and
 * the whole income is taxed on that tier's schedule: above 600,000 the lowest bands are lost one by one, above
 * 1,200,000 everything up to it is at 25% and the rest at 27.5%. So the tax jumps at each tier's limit.
 */
const TIERS: readonly (readonly [upTo: number, schedule: Schedule])[] = [
  [600_000, NORMAL],
  [700_000, NORMAL.slice(1).map(([upTo, rate], i) => [upTo, i === 0 ? 0.1 : rate] as const)],
  [800_000, NORMAL.slice(2)],
  [900_000, NORMAL.slice(3)],
  [1_200_000, NORMAL.slice(4)],
  [
    Infinity,
    [
      [1_200_000, 0.25],
      [Infinity, 0.275],
    ],
  ],
];

/** The tier limits: where the tax jumps (annual net income). */
export const TAX_TIER_LIMITS: readonly number[] = TIERS.slice(0, -1).map(([upTo]) => upTo);

/** Half-up to the piaster. */
const piasters = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** The yearly salary tax on an annual net income (already after insurance, the exemption and rounding). */
export function annualSalaryTax(income: number): number {
  if (income <= 0) return 0;
  const schedule = TIERS.find(([upTo]) => income <= upTo)![1];
  let tax = 0;
  let from = 0;
  for (const [upTo, rate] of schedule) {
    if (income <= from) break;
    tax += (Math.min(income, upTo) - from) * rate;
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

/** The total of some allowances, to the piaster. */
const total = (allowances: readonly AllowanceTerms[], which: (a: AllowanceTerms) => boolean = () => true) =>
  piasters(allowances.reduce((sum, a) => sum + (which(a) ? Math.max(0, a.amount) : 0), 0));

/**
 * A monthly gross salary's net, step by step, for `year` (its insurable wage limits), with its allowances. With the
 * same salary all year the monthly tax is the annual tax ÷ 12, which is what the Ministry's system gives each month.
 */
export function grossToNet(gross: number, year = new Date().getFullYear(), allowances: readonly AllowanceTerms[] = []): SalaryBreakdown {
  const r = SALARY_RULES;
  const g = Math.max(0, piasters(gross));
  const all = total(allowances);
  const taxableAllowances = total(allowances, (a) => a.taxable);
  const insuredWage = g > 0 ? insuredWageOf(g, allowances, year) : 0;
  const employeeInsurance = piasters(insuredWage * r.employeeInsuranceRate);
  const taxedPay = piasters(g + taxableAllowances);
  const healthInsurance = piasters(taxedPay * r.healthInsuranceRate);
  const monthlyTaxable = piasters(taxedPay - employeeInsurance - healthInsurance);
  const yearly = monthlyTaxable * 12 - r.personalExemption;
  const annualNetIncome = yearly > 0 ? Math.floor(yearly / r.roundIncomeDownTo) * r.roundIncomeDownTo : 0;
  const annualTax = annualSalaryTax(annualNetIncome);
  const monthlyTax = piasters(annualTax / 12);
  const martyrsFund = piasters(taxedPay * r.martyrsRate);
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
export function netToGross(net: number, year = new Date().getFullYear(), step: 1 | 0.01 = 1, allowances: readonly AllowanceTerms[] = []): SalaryBreakdown {
  const target = piasters(net);
  if (target <= 0) return grossToNet(0, year, allowances);
  const r = SALARY_RULES;
  const maxInsurance = insuredSalary(Number.MAX_SAFE_INTEGER, year) * r.employeeInsuranceRate;
  // counted in units of `step`: the gross at which the annual net income reaches each tier's limit (all far above the
  // insurable cap) ends a stretch
  const per = Math.round(1 / step);
  const taxableAllowances = total(allowances, (a) => a.taxable);
  const limits = TAX_TIER_LIMITS.map((income) => Math.max(0, Math.floor(((income + r.personalExemption) / 12 + maxInsurance - taxableAllowances) * per)));
  const stretches: [number, number][] = [];
  let from = 0;
  for (const limit of [...limits, Math.max(Math.ceil(target * 3 * per), (limits.at(-1) ?? 0) * 2)]) {
    stretches.push([from, limit]);
    from = limit + 1;
  }
  const netAt = (u: number) => grossToNet(u / per, year, allowances).net;
  for (const [lo, hi] of stretches) {
    if (hi < lo || netAt(hi) < target) continue;
    let a = lo;
    let b = hi;
    while (a < b) {
      const mid = Math.floor((a + b) / 2);
      if (netAt(mid) >= target) b = mid;
      else a = mid + 1;
    }
    return grossToNet(a / per, year, allowances);
  }
  return grossToNet(stretches.at(-1)![1] / per, year, allowances);
}

/**
 * By the hour, from an agreed net rate (owner's request, 15 October 2026): the lowest gross hourly rate, to the
 * piaster, whose monthly estimate (rate × hours a week × 52 ÷ 12) gives at least the net of the net rate's month, with
 * its breakdown. The contract keeps the gross rate: tax and insurance are worked out from the gross. Rates rounded to
 * the piaster can't always give the net exactly; the breakdown says what this rate gives.
 */
export function hourlyRateFromNet(
  netHourly: number,
  hoursPerWeek: number,
  year = new Date().getFullYear(),
  allowances: readonly AllowanceTerms[] = [],
): { hourlyRate: number; breakdown: SalaryBreakdown } {
  if (!(netHourly > 0) || !(hoursPerWeek > 0)) return { hourlyRate: 0, breakdown: grossToNet(0, year, allowances) };
  const target = piasters(netHourly * hoursPerWeek * WEEKS_PER_MONTH);
  const monthly = netToGross(target, year, 0.01, allowances);
  // the rate whose monthly estimate is that gross, rounded up to the piaster, then up again while its net falls short
  let rate = Math.ceil(piasters((monthly.gross / (hoursPerWeek * WEEKS_PER_MONTH)) * 100)) / 100;
  let breakdown = grossToNet(monthlyFromHourly(rate, hoursPerWeek), year, allowances);
  for (let i = 0; i < 100 && breakdown.net < target; i++) {
    rate = piasters(rate + 0.01);
    breakdown = grossToNet(monthlyFromHourly(rate, hoursPerWeek), year, allowances);
  }
  return { hourlyRate: rate, breakdown };
}
