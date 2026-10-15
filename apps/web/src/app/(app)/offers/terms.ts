import { grossToNet, monthlyFromHourly, netToGross, SALARY_RULES, type AllowanceTerms, type PayBasis, type SalaryBreakdown } from '@trendlix/shared';
import {
  formatAmount,
  formatEgp,
  formatPercent,
  insuredWageNote,
  MAX_HOURS_PER_WEEK,
  parseAmount,
  plainAmount,
  type BreakdownRow,
} from '../employees/[id]/contracts/salary';

// An offer's pay, as the offer form previews it while HR types (pure code, tested; relative imports for the tests).
// The pay basis (owner's request, 15 October 2026): a monthly salary, typed as the gross (the net is worked out) or as
// the net wanted (the gross is worked out, in whole pounds), or by the hour (part-time, e.g. two or three days a week),
// when the gross is the monthly estimate, hourly rate × hours a week × 52 ÷ 12 (monthlyFromHourly). Allowances are paid
// on top of the gross; the taxed ones are taxed with it, the insured ones insured with it, and all are in the net
// (grossToNet in @trendlix/shared). The API works the same amounts out again when it saves.

/** What HR types the monthly salary as: the gross, or the net wanted. */
export type SalaryStart = 'gross' | 'net';

/** The salary fields as typed (text), by the form's field names. */
export interface TermsTyped {
  payBasis: string;
  salaryBasis: string;
  grossSalary: string;
  wantedNet: string;
  hourlyRate: string;
  hoursPerWeek: string;
}

export type TermsField = 'grossSalary' | 'wantedNet' | 'hourlyRate' | 'hoursPerWeek';

export type TermsResult =
  | { kind: 'empty'; reason: string }
  | { kind: 'invalid'; field: TermsField; reason: string }
  /** `estimate`: by the hour, the monthly estimate (the gross); null for a monthly salary. */
  | { kind: 'ok'; breakdown: SalaryBreakdown; estimate: number | null };

export const payBasisFrom = (value: unknown): PayBasis => (value === 'hourly' ? 'hourly' : 'monthly');
export const salaryStartFrom = (value: unknown): SalaryStart => (value === 'net' ? 'net' : 'gross');

/** Hours a week as typed: "20", "22.5" (one decimal), in Arabic digits too. "" → null; anything else → NaN. */
export function parseHours(input: string): number | null {
  const s = input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();
  if (s === '') return null;
  return /^\d+(\.\d)?$/.test(s) ? Number(s) : NaN;
}

export const RATE_INVALID = 'Enter the hourly rate as an amount in EGP, e.g. 150.';
export const HOURS_INVALID = `Enter the hours a week as a number up to ${MAX_HOURS_PER_WEEK}, the legal working week, e.g. 20 or 22.5.`;
export const GROSS_INVALID = 'Enter the gross salary as an amount in EGP, e.g. 15,000.';
export const NET_INVALID = 'Enter the net salary as an amount in EGP, e.g. 13,000.';

/**
 * The month's breakdown for what is typed, in `year` (its insurable wage limits), with the allowances: by the hour, of
 * the monthly estimate; else of the gross typed, or of the lowest whole-pound gross whose net reaches the net typed.
 */
export function offerSalary(t: TermsTyped, year: number, allowances: readonly AllowanceTerms[] = []): TermsResult {
  if (payBasisFrom(t.payBasis) === 'hourly') {
    const rate = parseAmount(t.hourlyRate);
    const hours = parseHours(t.hoursPerWeek);
    if (rate !== null && (Number.isNaN(rate) || rate <= 0)) return { kind: 'invalid', field: 'hourlyRate', reason: RATE_INVALID };
    if (hours !== null && (Number.isNaN(hours) || hours <= 0 || hours > MAX_HOURS_PER_WEEK)) return { kind: 'invalid', field: 'hoursPerWeek', reason: HOURS_INVALID };
    if (rate === null || hours === null) return { kind: 'empty', reason: 'Enter the hourly rate and the hours a week to see the monthly estimate and the net.' };
    const estimate = monthlyFromHourly(rate, hours);
    return { kind: 'ok', breakdown: grossToNet(estimate, year, allowances), estimate };
  }
  const start = salaryStartFrom(t.salaryBasis);
  const n = parseAmount(start === 'net' ? t.wantedNet : t.grossSalary);
  if (n === null) return { kind: 'empty', reason: `Enter the ${start} salary to see the breakdown.` };
  if (Number.isNaN(n) || n <= 0) {
    return start === 'net' ? { kind: 'invalid', field: 'wantedNet', reason: NET_INVALID } : { kind: 'invalid', field: 'grossSalary', reason: GROSS_INVALID };
  }
  return { kind: 'ok', breakdown: start === 'net' ? netToGross(n, year, 1, allowances) : grossToNet(n, year, allowances), estimate: null };
}

/**
 * Switching between typing the gross and typing the net: the other field starts with what the current one gives, so
 * the salary stays the same. Left as it was when there is nothing to work from.
 */
export function switchStart(to: SalaryStart, typed: TermsTyped, year: number, allowances: readonly AllowanceTerms[] = []): TermsTyped {
  const from = offerSalary({ ...typed, payBasis: 'monthly', salaryBasis: to === 'net' ? 'gross' : 'net' }, year, allowances);
  if (from.kind !== 'ok') return { ...typed, salaryBasis: to };
  return to === 'net'
    ? { ...typed, salaryBasis: to, wantedNet: plainAmount(from.breakdown.net) }
    : { ...typed, salaryBasis: to, grossSalary: plainAmount(from.breakdown.gross) };
}

/** "EGP 150 × 20 hours a week × 52 ÷ 12 = EGP 13,000 a month", for the hourly fields' hint. */
export function estimateText(rate: number, hours: number, estimate: number): string {
  return `${formatEgp(rate)} × ${formatAmount(hours)} hours a week × 52 ÷ 12 = ${formatEgp(estimate)} a month, the monthly estimate.`;
}

/**
 * The month's breakdown as the offer form lists it: the gross, the allowances, what is deducted, the net and the
 * company's cost. `insuredAllowances`: the allowances counted in the insured wage, to say when the wage is capped at the
 * year's maximum or raised to its minimum.
 */
export function offerBreakdownRows(b: SalaryBreakdown, { hourly = false, insuredAllowances = 0 }: { hourly?: boolean; insuredAllowances?: number } = {}): BreakdownRow[] {
  const r = SALARY_RULES;
  return [
    { label: 'Gross salary', amount: b.gross, note: hourly ? 'the monthly estimate' : undefined, kind: 'amount' },
    ...(b.allowances > 0
      ? [
          {
            label: 'Allowances',
            amount: b.allowances,
            note: b.taxableAllowances > 0 ? `${formatAmount(b.taxableAllowances)} of it taxed` : 'not taxed',
            kind: 'amount' as const,
          },
        ]
      : []),
    { label: 'Insured wage', amount: b.insuredWage, note: insuredWageNote({ gross: b.gross + insuredAllowances, insuredWage: b.insuredWage }), kind: 'amount' },
    { label: `Employee social insurance (${formatPercent(r.employeeInsuranceRate)})`, amount: b.employeeInsurance, kind: 'deduction' },
    ...(b.healthInsurance > 0
      ? [{ label: `Health insurance (${formatPercent(r.healthInsuranceRate)})`, amount: b.healthInsurance, kind: 'deduction' as const }]
      : []),
    { label: 'Income tax', amount: b.monthlyTax, kind: 'deduction' },
    { label: `Martyrs' Fund (${formatPercent(r.martyrsRate)})`, amount: b.martyrsFund, kind: 'deduction' },
    { label: 'Net salary', amount: b.net, kind: 'total' },
    {
      label: 'Company cost',
      amount: b.companyCost,
      note: `gross and allowances, plus the company's ${formatPercent(r.employerInsuranceRate)} insurance, ${formatAmount(b.employerInsurance)}`,
      kind: 'company',
    },
  ];
}

/** The allowances counted in the insured wage, a month. */
export function insuredAllowancesOf(allowances: readonly AllowanceTerms[]): number {
  return Math.round(allowances.reduce((sum, a) => sum + (a.insured ? a.amount : 0), 0) * 100) / 100;
}

/** The gross and the allowances, a month: what the offer pays before deductions. */
export function totalPay(gross: number, allowancesTotal: number | null | undefined): number {
  return Math.round((gross + (allowancesTotal ?? 0)) * 100) / 100;
}
