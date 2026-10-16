import {
  BUILT_IN_LAW_RATES,
  grossToNet,
  ratesOf,
  ROUND_INCOME_DOWN_TO,
  type AllowanceTerms,
  type LawRates,
  type LawRatesOrYear,
  type PayBasis,
  type SalaryBreakdown,
} from '@trendlix/shared';
import {
  allowancesNote,
  allowanceTotals,
  basisFrom,
  formatMoney,
  formatEgp,
  formatPercent,
  insurableLimits,
  insuredWageNote,
  monthlyEstimateText,
  netPerHourText,
  parseAmount,
  parseHours,
  plainAmount,
  type SalaryBasis,
} from '../../employees/[id]/contracts/salary';
import { treatmentText, type AllowanceRow } from '../../../../lib/allowances';
import type { AllowanceType } from '../../../../lib/types';

// Plain helpers for the Salary Calculator page (no server-only, so they are unit tested): what it reads from and
// writes to the address, the years it offers and the rows of its table. The calculation itself is grossToNet /
// netToGross in @trendlix/shared. Relative imports: the tests run without the "@/" alias. As on the contract form
// (owner's requests, 15 October 2026), the pay can be by the hour, when the gross is the monthly estimate (rate × hours a
// week × 52 ÷ 12) of the gross rate typed or worked out from a net rate, and allowances of HR's kinds come on top of the
// gross. The rates set by law (owner's request, 16 October 2026) are the chosen year's, as the Super Admin keeps them in
// Organization → Payroll (lawRatesFor on the years the page loaded): the rows' rates, limits and exemption are theirs.

export interface CalculatorInput {
  /** A monthly salary, or by the hour. */
  pay: PayBasis;
  /** A monthly salary: what it starts from, the gross or the net. */
  basis: SalaryBasis;
  /** The gross or the net, as typed (a monthly salary). */
  amount: string;
  /** By the hour: what it starts from, the gross rate or the net rate. */
  rateBasis: SalaryBasis;
  /** By the hour: the gross rate, the net rate and the hours a week, as typed. */
  rate: string;
  netRate: string;
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

/** The years offered: those with rates set by law of their own (`lawYears`: the years kept, else the built-in ones), and this year. */
export function calculatorYears(thisYear: number, lawYears: readonly LawRates[] = BUILT_IN_LAW_RATES): number[] {
  return [...new Set([...lawYears.map((r) => r.year), thisYear])].sort((a, b) => a - b);
}

/**
 * ?gross=16700&year=2026 or ?net=13000: from the gross unless only a net is given; ?rate=150&hours=20 or
 * ?netRate=120&hours=16: by the hour, from the gross rate unless only a net rate is given; a year not offered (see
 * calculatorYears) → this year. Each ?allowance=<kind id>:<amount> is an allowance row.
 */
export function readCalculatorQuery(q: Query, thisYear: number, lawYears: readonly LawRates[] = BUILT_IN_LAW_RATES): CalculatorInput {
  const gross = first(q.gross);
  const net = first(q.net);
  const rate = first(q.rate);
  const netRate = first(q.netRate);
  const hours = first(q.hours);
  const pay: PayBasis = rate !== undefined || netRate !== undefined || hours !== undefined ? 'hourly' : 'monthly';
  const basis = basisFrom(pay === 'monthly' && gross === undefined && net !== undefined ? 'net' : 'gross');
  const rateBasis = basisFrom(pay === 'hourly' && rate === undefined && netRate !== undefined ? 'net' : 'gross');
  const year = Number(first(q.year));
  return {
    pay,
    basis,
    amount: pay === 'hourly' ? '' : ((basis === 'net' ? net : gross) ?? ''),
    rateBasis,
    rate: rate ?? '',
    netRate: rateBasis === 'net' ? (netRate ?? '') : '',
    hours: hours ?? '',
    year: calculatorYears(thisYear, lawYears).includes(year) ? year : thisYear,
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
 * or "?netRate=120&hours=16&year=2026" (amounts written plainly), then the allowances: "&allowance=<kind id>:1000".
 */
export function calculatorSearch({ pay, basis, amount, rateBasis, rate, netRate, hours, year, allowances }: CalculatorInput): string {
  const p = new URLSearchParams();
  if (pay === 'hourly') {
    // both kept, even empty, so the page still opens by the hour, from the same rate
    if (rateBasis === 'net') p.set('netRate', plain(netRate, parseAmount));
    else p.set('rate', plain(rate, parseAmount));
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

/** What the allowances add to the net: the net with them less the net of the gross alone (with the same rates set by law). */
export function allowancesEffect(b: SalaryBreakdown, rates: LawRatesOrYear): number {
  return Math.round((b.net - grossToNet(b.gross, rates).net) * 100) / 100;
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
 * `rates`: the rates set by law `b` was worked out with (or a year for the built-in ones); `allowances`: those `b` was
 * worked out with, each listed under the gross; `hourly`: the gross rate and hours a week the gross was estimated from,
 * and the net rate typed when the gross rate was worked out from it.
 */
export function calculatorRows(
  b: SalaryBreakdown,
  rates: LawRatesOrYear,
  allowances: readonly NamedAllowance[] = [],
  hourly?: { rate: number; hours: number; netRate?: number },
): { employee: CalculatorRow[]; company: CalculatorRow[] } {
  const r = ratesOf(rates);
  const limits = insurableLimits(r);
  const totals = allowanceTotals(allowances);
  const withAllowances = totals.total > 0;
  const taxed = totals.taxable > 0 ? 'the gross and the taxed allowances' : 'the gross';
  return {
    employee: [
      {
        label: 'Gross salary',
        how: hourly
          ? `The monthly estimate: ${monthlyEstimateText({ ...hourly, gross: b.gross })}${hourly.netRate !== undefined ? `, the gross rate worked out from ${formatEgp(hourly.netRate)} net per hour` : ''}`
          : 'The monthly gross, the variable part included',
        amount: b.gross,
        kind: 'amount',
      },
      ...allowances.map((a) => ({ label: a.name, how: `Allowance, a month on top of the gross: ${treatmentText(a).toLowerCase()}`, amount: a.amount, kind: 'amount' as const })),
      ...(allowances.length > 1
        ? [{ label: 'Allowances in total', how: `On top of the gross: ${allowancesNote(allowances)}`, amount: totals.total, kind: 'subtotal' as const }]
        : []),
      {
        label: 'Insured wage',
        how: `${totals.insured > 0 ? 'The gross and the insured allowances' : 'The gross'}, at most the ${limits.year} maximum insurable wage (${formatMoney(limits.max)}) and at least its minimum (${formatMoney(limits.min)})`,
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
      {
        label: 'Monthly taxable',
        how: `${totals.taxable > 0 ? 'The gross and the taxed allowances' : 'The gross'} less social insurance${b.healthInsurance > 0 ? ' and health insurance' : ''}`,
        amount: b.monthlyTaxable,
        kind: 'subtotal',
      },
      {
        label: 'Annual net income (a year)',
        how: `Monthly taxable × 12, less the ${formatMoney(r.personalExemption)} personal exemption, rounded down to ${ROUND_INCOME_DOWN_TO} pounds`,
        amount: b.annualNetIncome,
        kind: 'amount',
      },
      { label: 'Annual tax (a year)', how: `The ${r.year} salary tax tiers on the annual net income`, amount: b.annualTax, kind: 'amount' },
      { label: 'Monthly tax', how: 'The annual tax ÷ 12', amount: b.monthlyTax, kind: 'deduction' },
      { label: "Martyrs' Fund", how: `${formatPercent(r.martyrsRate)} of ${taxed}`, amount: b.martyrsFund, kind: 'deduction' },
      {
        label: 'Total deductions',
        how: b.healthInsurance > 0 ? "Social insurance, health insurance, tax and the Martyrs' Fund" : "Social insurance, tax and the Martyrs' Fund",
        amount: b.deductions,
        kind: 'subtotal',
      },
      {
        label: 'Net salary',
        how: `${withAllowances ? 'The gross and the allowances, less the deductions' : 'The gross less the deductions'}${hourly ? `, ${netPerHourText(b.net, hourly.hours)}` : ''}`,
        amount: b.net,
        kind: 'total',
      },
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
