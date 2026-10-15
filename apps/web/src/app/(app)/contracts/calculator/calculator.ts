import { INSURABLE_WAGE, SALARY_RULES, type SalaryBreakdown } from '@trendlix/shared';
import { basisFrom, formatAmount, formatPercent, insurableLimits, insuredWageNote, parseAmount, plainAmount, type SalaryBasis } from '../../employees/[id]/contracts/salary';

// Plain helpers for the Salary Calculator page (no server-only, so they are unit tested): what it reads from and
// writes to the address, the years it offers, the rows of its table and the tax brackets of its "How it's calculated"
// list. The calculation itself is grossToNet / netToGross in @trendlix/shared. Relative imports: the tests run without
// the "@/" alias.

export interface CalculatorInput {
  basis: SalaryBasis;
  /** As typed. */
  amount: string;
  year: number;
}

type Query = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The years offered: those with known insurable wage limits (they differ by year), and this year. */
export function calculatorYears(thisYear: number): number[] {
  return [...new Set([...Object.keys(INSURABLE_WAGE).map(Number), thisYear])].sort((a, b) => a - b);
}

/** ?gross=16700&year=2026 or ?net=13000: from the gross unless only a net is given; a year not offered → this year. */
export function readCalculatorQuery(q: Query, thisYear: number): CalculatorInput {
  const gross = first(q.gross);
  const net = first(q.net);
  const basis = basisFrom(gross === undefined && net !== undefined ? 'net' : 'gross');
  const year = Number(first(q.year));
  return {
    basis,
    amount: (basis === 'net' ? net : gross) ?? '',
    year: calculatorYears(thisYear).includes(year) ? year : thisYear,
  };
}

/** The address's query for an input, so a result can be shared: "?gross=16700&year=2026" (an amount written plainly). */
export function calculatorSearch({ basis, amount, year }: CalculatorInput): string {
  const p = new URLSearchParams();
  const n = parseAmount(amount);
  const value = n !== null && !Number.isNaN(n) ? plainAmount(n) : amount.trim();
  // an empty net is kept, so the page still opens on the net
  if (value !== '' || basis === 'net') p.set(basis, value);
  p.set('year', String(year));
  return `?${p}`;
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

/** The table: the employee's side (gross down to net, monthly unless the label says a year), then the company's. */
export function calculatorRows(b: SalaryBreakdown, year: number): { employee: CalculatorRow[]; company: CalculatorRow[] } {
  const r = SALARY_RULES;
  const limits = insurableLimits(year);
  return {
    employee: [
      { label: 'Gross salary', how: 'The monthly gross, the variable part included', amount: b.gross, kind: 'amount' },
      {
        label: 'Insured wage',
        how: `The gross, at most the ${limits.year} maximum insurable wage (${formatAmount(limits.max)}) and at least its minimum (${formatAmount(limits.min)})`,
        amount: b.insuredWage,
        note: insuredWageNote(b),
        kind: 'amount',
      },
      {
        label: 'Employee social insurance',
        how: `${formatPercent(r.employeeInsuranceRate)} of the insured wage`,
        amount: b.employeeInsurance,
        kind: 'deduction',
      },
      ...(b.healthInsurance > 0
        ? [{ label: 'Health insurance', how: `${formatPercent(r.healthInsuranceRate)} of the gross`, amount: b.healthInsurance, kind: 'deduction' as const }]
        : []),
      { label: 'Monthly taxable', how: 'The gross less social insurance', amount: b.monthlyTaxable, kind: 'subtotal' },
      {
        label: 'Annual net income (a year)',
        how: `Monthly taxable × 12, less the ${formatAmount(r.personalExemption)} personal exemption, rounded down to ${r.roundIncomeDownTo} pounds`,
        amount: b.annualNetIncome,
        kind: 'amount',
      },
      { label: 'Annual tax (a year)', how: "Law 7/2024's brackets on the annual net income", amount: b.annualTax, kind: 'amount' },
      { label: 'Monthly tax', how: 'The annual tax ÷ 12', amount: b.monthlyTax, kind: 'deduction' },
      { label: "Martyrs' Fund", how: `${formatPercent(r.martyrsRate)} of the gross`, amount: b.martyrsFund, kind: 'deduction' },
      { label: 'Total deductions', how: "Social insurance, tax and the Martyrs' Fund", amount: b.deductions, kind: 'subtotal' },
      { label: 'Net salary', how: 'The gross less the deductions', amount: b.net, kind: 'total' },
    ],
    company: [
      {
        label: 'Company social insurance',
        how: `${formatPercent(r.employerInsuranceRate)} of the insured wage`,
        amount: b.employerInsurance,
        kind: 'amount',
      },
      { label: 'Company cost', how: "The gross plus the company's social insurance", amount: b.companyCost, kind: 'total' },
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
