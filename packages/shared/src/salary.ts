// Gross to net salary in Egypt, as the Ministry of Finance's salary tax system works it out (owner, 15 October 2026,
// checked against its printout and the Tax Authority's payroll guides): social insurance on the insured wage, salary tax
// on the annual net income in Law 7/2024's tiers, and the Martyrs' Fund. Comprehensive health insurance doesn't apply in
// Cairo yet, and the salary stamp tax applies to public business-sector companies only.

import { insuredSalary } from './contracts.js';

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
  /** The wage social insurance is paid on: the gross, capped at the year's maximum insurable wage (and at least its minimum). */
  insuredWage: number;
  employeeInsurance: number;
  healthInsurance: number;
  /** Gross less what is deducted before the tax. */
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
  /** What the employee costs the company a month: gross and the company's insurance share. */
  companyCost: number;
}

/**
 * A monthly gross salary's net, step by step, for `year` (its insurable wage limits). With the same salary all year
 * the monthly tax is the annual tax ÷ 12, which is what the Ministry's system gives each month.
 */
export function grossToNet(gross: number, year = new Date().getFullYear()): SalaryBreakdown {
  const r = SALARY_RULES;
  const g = Math.max(0, piasters(gross));
  const insuredWage = g > 0 ? insuredSalary(g, year) : 0;
  const employeeInsurance = piasters(insuredWage * r.employeeInsuranceRate);
  const healthInsurance = piasters(g * r.healthInsuranceRate);
  const monthlyTaxable = piasters(g - employeeInsurance - healthInsurance);
  const yearly = monthlyTaxable * 12 - r.personalExemption;
  const annualNetIncome = yearly > 0 ? Math.floor(yearly / r.roundIncomeDownTo) * r.roundIncomeDownTo : 0;
  const annualTax = annualSalaryTax(annualNetIncome);
  const monthlyTax = piasters(annualTax / 12);
  const martyrsFund = piasters(g * r.martyrsRate);
  const deductions = piasters(employeeInsurance + healthInsurance + monthlyTax + martyrsFund);
  const employerInsurance = piasters(insuredWage * r.employerInsuranceRate);
  return {
    gross: g,
    insuredWage,
    employeeInsurance,
    healthInsurance,
    monthlyTaxable,
    annualNetIncome,
    annualTax,
    monthlyTax,
    martyrsFund,
    deductions,
    net: piasters(g - deductions),
    employerInsurance,
    companyCost: piasters(g + employerInsurance),
  };
}

/**
 * The lowest monthly gross whose net is at least `net`: grossing up. The net rises with the gross except where the
 * tax jumps at a tier's limit, so some nets can't be reached exactly; then the gross just past the gap is given and its
 * own net is in the breakdown. Searched within each stretch between the jumps, in whole pounds by default (`step`
 * 0.01 for piasters): with the income rounded down to ten pounds, several grosses a few piasters apart give one net.
 */
export function netToGross(net: number, year = new Date().getFullYear(), step: 1 | 0.01 = 1): SalaryBreakdown {
  const target = piasters(net);
  if (target <= 0) return grossToNet(0, year);
  const r = SALARY_RULES;
  const maxInsurance = insuredSalary(Number.MAX_SAFE_INTEGER, year) * r.employeeInsuranceRate;
  // counted in units of `step`: the gross at which the annual net income reaches each tier's limit (all far above the
  // insurable cap) ends a stretch
  const per = Math.round(1 / step);
  const limits = TAX_TIER_LIMITS.map((income) => Math.floor(((income + r.personalExemption) / 12 + maxInsurance) * per));
  const stretches: [number, number][] = [];
  let from = 0;
  for (const limit of [...limits, Math.max(Math.ceil(target * 3 * per), (limits.at(-1) ?? 0) * 2)]) {
    stretches.push([from, limit]);
    from = limit + 1;
  }
  const netAt = (u: number) => grossToNet(u / per, year).net;
  for (const [lo, hi] of stretches) {
    if (netAt(hi) < target) continue;
    let a = lo;
    let b = hi;
    while (a < b) {
      const mid = Math.floor((a + b) / 2);
      if (netAt(mid) >= target) b = mid;
      else a = mid + 1;
    }
    return grossToNet(a / per, year);
  }
  return grossToNet(stretches.at(-1)![1] / per, year);
}
