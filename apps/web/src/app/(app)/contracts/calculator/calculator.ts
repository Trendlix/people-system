import { grossToNet, INSURABLE_WAGE, SALARY_RULES, type AllowanceTerms, type PayBasis, type SalaryBreakdown } from '@trendlix/shared';
import {
  allowancesNote,
  allowanceTotals,
  basisFrom,
  formatAmount,
  formatPercent,
  insurableLimits,
  insuredWageNote,
  monthlyEstimateText,
  parseAmount,
  parseHours,
  plainAmount,
  type SalaryBasis,
} from '../../employees/[id]/contracts/salary';
import { treatmentText, type AllowanceRow } from '../../../../lib/allowances';
import type { AllowanceType } from '../../../../lib/types';

// Plain helpers for the Salary Calculator page (no server-only, so they are unit tested): what it reads from and
// writes to the address, the years it offers, the rows of its table and the tax brackets of its "How it's calculated"
// list. The calculation itself is grossToNet / netToGross in @trendlix/shared. Relative imports: the tests run without
// the "@/" alias. As on the contract form (owner's requests, 15 October 2026), the pay can be by the hour, when the
// gross is the monthly estimate (rate × hours a week × 52 ÷ 12), and allowances of HR's kinds come on top of the gross.

export interface CalculatorInput {
  /** A monthly salary, or by the hour (then there is no starting from the net). */
  pay: PayBasis;
  basis: SalaryBasis;
  /** The gross or the net, as typed (a monthly salary). */
  amount: string;
  /** By the hour: the rate and the hours a week, as typed. */
  rate: string;
  hours: string;
  year: number;
  /** The allowance rows: the kind's id and the amount a month as typed. */
  allowances: AllowanceRow[];
}

type Query = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const all = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** The most allowance rows read from the address. */
const MAX_ALLOWANCES = 20;

/** The years offered: those with known insurable wage limits (they differ by year), and this year. */
export function calculatorYears(thisYear: number): number[] {
  return [...new Set([...Object.keys(INSURABLE_WAGE).map(Number), thisYear])].sort((a, b) => a - b);
}

/**
 * ?gross=16700&year=2026 or ?net=13000: from the gross unless only a net is given; ?rate=150&hours=20: by the hour; a
 * year not offered → this year. Each ?allowance=<kind id>:<amount> is an allowance row.
 */
export function readCalculatorQuery(q: Query, thisYear: number): CalculatorInput {
  const gross = first(q.gross);
  const net = first(q.net);
  const rate = first(q.rate);
  const hours = first(q.hours);
  const pay: PayBasis = rate !== undefined || hours !== undefined ? 'hourly' : 'monthly';
  const basis = basisFrom(pay === 'monthly' && gross === undefined && net !== undefined ? 'net' : 'gross');
  const year = Number(first(q.year));
  return {
    pay,
    basis,
    amount: pay === 'hourly' ? '' : ((basis === 'net' ? net : gross) ?? ''),
    rate: rate ?? '',
    hours: hours ?? '',
    year: calculatorYears(thisYear).includes(year) ? year : thisYear,
    allowances: all(q.allowance)
      .slice(0, MAX_ALLOWANCES)
      .map((v) => {
        const at = v.lastIndexOf(':');
        return at < 0 ? { allowanceTypeId: v, amount: '' } : { allowanceTypeId: v.slice(0, at), amount: v.slice(at + 1) };
      }),
  };
}

/** An amount or hours as the address holds them: plainly when they are valid, else as typed. */
function plain(typed: string, parse: (s: string) => number | null): string {
  const n = parse(typed);
  return n !== null && !Number.isNaN(n) ? plainAmount(n) : typed.trim();
}

/**
 * The address's query for an input, so a result can be shared: "?gross=16700&year=2026", "?rate=150&hours=20&year=2026"
 * (amounts written plainly), then the allowances: "&allowance=<kind id>:1000".
 */
export function calculatorSearch({ pay, basis, amount, rate, hours, year, allowances }: CalculatorInput): string {
  const p = new URLSearchParams();
  if (pay === 'hourly') {
    // both kept, even empty, so the page still opens by the hour
    p.set('rate', plain(rate, parseAmount));
    p.set('hours', plain(hours, parseHours));
  } else {
    const value = plain(amount, parseAmount);
    // an empty net is kept, so the page still opens on the net
    if (value !== '' || basis === 'net') p.set(basis, value);
  }
  p.set('year', String(year));
  for (const a of allowances) {
    if (a.allowanceTypeId || a.amount.trim()) p.append('allowance', `${a.allowanceTypeId}:${plain(a.amount, parseAmount)}`);
  }
  return `?${p}`;
}

/** An allowance as the calculator lists it: its kind's name and treatment, and its amount a month. */
export interface NamedAllowance extends AllowanceTerms {
  name: string;
}

/** The rows ready to work out (a kind chosen and an amount above 0), with their kinds' names and treatment. */
export function namedAllowances(rows: readonly AllowanceRow[], types: readonly AllowanceType[]): NamedAllowance[] {
  return rows.flatMap((r) => {
    const t = types.find((k) => k.id === r.allowanceTypeId);
    const amount = parseAmount(r.amount);
    return t && amount !== null && !Number.isNaN(amount) && amount > 0 ? [{ name: t.nameEn, amount, taxable: t.taxable, insured: t.insured }] : [];
  });
}

/** What the allowances add to the net: the net with them less the net of the gross alone. */
export function allowancesEffect(b: SalaryBreakdown, year: number): number {
  return Math.round((b.net - grossToNet(b.gross, year).net) * 100) / 100;
}

export interface CalculatorRow {
  label: string;
  /** How it is worked out. */
  how: string;
  amount: number;
  /** Shown after the label, e.g. "capped at 16,700". */
  note?: string;
  /** deduction: taken off the gross; subtotal: a step on the way; total: the result. */
  kind: 'amount' | 'deduction' | 'subtotal' | 'total';
}

/**
 * The table: the employee's side (gross down to net, monthly unless the label says a year), then the company's.
 * `allowances`: those `b` was worked out with, each listed under the gross; `hourly`: the rate and hours a week the
 * gross was estimated from.
 */
export function calculatorRows(
  b: SalaryBreakdown,
  year: number,
  allowances: readonly NamedAllowance[] = [],
  hourly?: { rate: number; hours: number },
): { employee: CalculatorRow[]; company: CalculatorRow[] } {
  const r = SALARY_RULES;
  const limits = insurableLimits(year);
  const totals = allowanceTotals(allowances);
  const withAllowances = totals.total > 0;
  const taxed = totals.taxable > 0 ? 'the gross and the taxed allowances' : 'the gross';
  return {
    employee: [
      {
        label: 'Gross salary',
        how: hourly ? `The monthly estimate: ${monthlyEstimateText({ ...hourly, gross: b.gross })}` : 'The monthly gross, the variable part included',
        amount: b.gross,
        kind: 'amount',
      },
      ...allowances.map((a) => ({ label: a.name, how: `Allowance, a month on top of the gross: ${treatmentText(a).toLowerCase()}`, amount: a.amount, kind: 'amount' as const })),
      ...(allowances.length > 1
        ? [{ label: 'Allowances in total', how: `On top of the gross: ${allowancesNote(allowances)}`, amount: totals.total, kind: 'subtotal' as const }]
        : []),
      {
        label: 'Insured wage',
        how: `${totals.insured > 0 ? 'The gross and the insured allowances' : 'The gross'}, at most the ${limits.year} maximum insurable wage (${formatAmount(limits.max)}) and at least its minimum (${formatAmount(limits.min)})`,
        amount: b.insuredWage,
        note: insuredWageNote(b, totals.insured),
        kind: 'amount',
      },
      {
        label: 'Employee social insurance',
        how: `${formatPercent(r.employeeInsuranceRate)} of the insured wage`,
        amount: b.employeeInsurance,
        kind: 'deduction',
      },
      ...(b.healthInsurance > 0
        ? [{ label: 'Health insurance', how: `${formatPercent(r.healthInsuranceRate)} of ${taxed}`, amount: b.healthInsurance, kind: 'deduction' as const }]
        : []),
      { label: 'Monthly taxable', how: `${totals.taxable > 0 ? 'The gross and the taxed allowances' : 'The gross'} less social insurance`, amount: b.monthlyTaxable, kind: 'subtotal' },
      {
        label: 'Annual net income (a year)',
        how: `Monthly taxable × 12, less the ${formatAmount(r.personalExemption)} personal exemption, rounded down to ${r.roundIncomeDownTo} pounds`,
        amount: b.annualNetIncome,
        kind: 'amount',
      },
      { label: 'Annual tax (a year)', how: "Law 7/2024's brackets on the annual net income", amount: b.annualTax, kind: 'amount' },
      { label: 'Monthly tax', how: 'The annual tax ÷ 12', amount: b.monthlyTax, kind: 'deduction' },
      { label: "Martyrs' Fund", how: `${formatPercent(r.martyrsRate)} of ${taxed}`, amount: b.martyrsFund, kind: 'deduction' },
      { label: 'Total deductions', how: "Social insurance, tax and the Martyrs' Fund", amount: b.deductions, kind: 'subtotal' },
      { label: 'Net salary', how: withAllowances ? 'The gross and the allowances, less the deductions' : 'The gross less the deductions', amount: b.net, kind: 'total' },
    ],
    company: [
      {
        label: 'Company social insurance',
        how: `${formatPercent(r.employerInsuranceRate)} of the insured wage`,
        amount: b.employerInsurance,
        kind: 'amount',
      },
      {
        label: 'Company cost',
        how: withAllowances ? "The gross and the allowances, plus the company's social insurance" : "The gross plus the company's social insurance",
        amount: b.companyCost,
        kind: 'total',
      },
    ],
  };
}

// ---------- the tax, for the "How it's calculated" list ----------

/**
 * Law 7/2024's brackets of the annual net income (Law 91/2005 Art. 8), as the list shows them. The calculation is
 * annualSalaryTax in @trendlix/shared; the tests check these against it.
 */
export const TAX_BRACKETS: readonly { upTo: number; rate: number }[] = [
  { upTo: 40_000, rate: 0 },
  { upTo: 55_000, rate: 0.1 },
  { upTo: 70_000, rate: 0.15 },
  { upTo: 200_000, rate: 0.2 },
  { upTo: 400_000, rate: 0.225 },
  { upTo: Infinity, rate: 0.25 },
];

/**
 * Above 600,000 a year the whole income moves to a higher tier: the income up to `firstUpTo` is taxed at `rate`
 * instead of the lower brackets (the rest as before). Above 1,200,000: 25% up to it and 27.5% on the rest.
 */
export const TAX_TIERS: readonly { over: number; firstUpTo: number; rate: number }[] = [
  { over: 600_000, firstUpTo: 55_000, rate: 0.1 },
  { over: 700_000, firstUpTo: 70_000, rate: 0.15 },
  { over: 800_000, firstUpTo: 200_000, rate: 0.2 },
  { over: 900_000, firstUpTo: 400_000, rate: 0.225 },
];
export const TOP_TIER = { over: 1_200_000, rate: 0.275, below: 0.25 } as const;

/** "Up to 40,000: 0%", "40,000 to 55,000: 10%", …, "Above 400,000: 25%". */
export function bracketLabels(): string[] {
  return TAX_BRACKETS.map(({ upTo, rate }, i) => {
    const from = i === 0 ? 0 : TAX_BRACKETS[i - 1].upTo;
    const range = i === 0 ? `Up to ${formatAmount(upTo)}` : upTo === Infinity ? `Above ${formatAmount(from)}` : `${formatAmount(from)} to ${formatAmount(upTo)}`;
    return `${range}: ${formatPercent(rate)}`;
  });
}
