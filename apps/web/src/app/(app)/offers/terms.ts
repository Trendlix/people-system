import { grossToNet, netToGross, ratesOf, type AllowanceTerms, type LawRatesOrYear, type PayBasis, type SalaryBreakdown } from '@trendlix/shared';
import {
  belowAllowancesText,
  formatAmount,
  formatEgp,
  formatMoney,
  formatPercent,
  hourlyPayFor,
  insuredWageNote,
  MAX_HOURS_PER_WEEK,
  parseAmount,
  plainAmount,
  switchRateBasis,
  type BreakdownRow,
} from '../employees/[id]/contracts/salary';

// An offer's pay, as the offer form previews it while HR types (pure code, tested; relative imports for the tests).
// The pay basis (owner's request, 15 October 2026): a monthly salary, typed as the gross (the net is worked out) or as
// the net wanted (the gross is worked out, in whole pounds), or by the hour (part-time, e.g. two or three days a week),
// when the gross is the monthly estimate, hourly rate × hours a week × 52 ÷ 12 (monthlyFromHourly), the rate typed as
// the gross per hour or as the net per hour agreed (the gross rate is worked out, as on the contract form). Allowances
// are paid on top of the gross; the taxed ones are taxed with it, the insured ones insured with it, and all are in the
// net (grossToNet in @trendlix/shared). The API works the same amounts out again when it saves. The rates set by law
// (owner's request, 16 October 2026) are the join date's year's, as the Super Admin keeps them in Organization →
// Payroll: each helper takes them (`rates`), or a year for the built-in ones.

/** What HR types the monthly salary as, the gross or the net wanted; by the hour, the rate as the gross or the net per hour. */
export type SalaryStart = 'gross' | 'net';

/** The salary fields as typed (text), by the form's field names. */
export interface TermsTyped {
  payBasis: string;
  salaryBasis: string;
  grossSalary: string;
  wantedNet: string;
  /** By the hour: the rate typed as the gross per hour (hourlyRate) or the net per hour (netRate). */
  rateBasis: string;
  hourlyRate: string;
  netRate: string;
  hoursPerWeek: string;
}

export type TermsField = 'grossSalary' | 'wantedNet' | 'hourlyRate' | 'netRate' | 'hoursPerWeek';

export type TermsResult =
  | { kind: 'empty'; reason: string }
  | { kind: 'invalid'; field: TermsField; reason: string }
  /** `estimate`: by the hour, the monthly estimate (the gross), of `hourly`'s gross rate; null for a monthly salary. */
  | { kind: 'ok'; breakdown: SalaryBreakdown; estimate: number | null; hourly?: { rate: number; hours: number } };

export const payBasisFrom = (value: unknown): PayBasis => (value === 'hourly' ? 'hourly' : 'monthly');
export const salaryStartFrom = (value: unknown): SalaryStart => (value === 'net' ? 'net' : 'gross');

/** Hours a week as typed: "20", "22.5" (one decimal), in Arabic digits too. "" → null; anything else → NaN. */
export function parseHours(input: string): number | null {
  const s = input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();
  if (s === '') return null;
  return /^\d+(\.\d)?$/.test(s) ? Number(s) : NaN;
}

export const RATE_INVALID = 'Enter the hourly rate as an amount in EGP, e.g. 150.';
export const NET_RATE_INVALID = 'Enter the net per hour as an amount in EGP, e.g. 120.';
export const HOURS_INVALID = `Enter the hours a week as a number up to ${MAX_HOURS_PER_WEEK}, the legal working week, e.g. 20 or 22.5.`;
export const GROSS_INVALID = 'Enter the gross salary as an amount in EGP, e.g. 15,000.';
export const NET_INVALID = 'Enter the net salary as an amount in EGP, e.g. 13,000.';

/**
 * The month's breakdown for what is typed, with the year's rates set by law (`rates`) and the allowances: by the hour, of
 * the monthly estimate of the gross rate typed, or worked out from the net per hour typed (hourlyPayFor, which keeps
 * the gross rate typed before while it gives that net rate); else of the gross typed, or of the lowest whole-pound
 * gross whose net reaches the net typed.
 */
export function offerSalary(t: TermsTyped, rates: LawRatesOrYear, allowances: readonly AllowanceTerms[] = []): TermsResult {
  if (payBasisFrom(t.payBasis) === 'hourly') {
    const net = salaryStartFrom(t.rateBasis) === 'net';
    const pay = hourlyPayFor(net ? 'net' : 'gross', net ? t.netRate : t.hourlyRate, t.hoursPerWeek, rates, allowances, t.hourlyRate);
    if (pay.kind === 'invalid' && pay.field === 'hours') return { kind: 'invalid', field: 'hoursPerWeek', reason: HOURS_INVALID };
    if (pay.kind === 'invalid') return net ? { kind: 'invalid', field: 'netRate', reason: NET_RATE_INVALID } : { kind: 'invalid', field: 'hourlyRate', reason: RATE_INVALID };
    if (pay.kind === 'belowAllowances') return { kind: 'invalid', field: 'netRate', reason: belowAllowancesText(pay.net, true) };
    if (pay.kind === 'empty') {
      return { kind: 'empty', reason: `Enter the ${net ? 'net per hour' : 'hourly rate'} and the hours a week to see the monthly estimate and the net.` };
    }
    return { kind: 'ok', breakdown: pay.breakdown, estimate: pay.gross, hourly: { rate: pay.rate, hours: pay.hours } };
  }
  const start = salaryStartFrom(t.salaryBasis);
  const n = parseAmount(start === 'net' ? t.wantedNet : t.grossSalary);
  if (n === null) return { kind: 'empty', reason: `Enter the ${start} salary to see the breakdown.` };
  if (Number.isNaN(n) || n <= 0) {
    return start === 'net' ? { kind: 'invalid', field: 'wantedNet', reason: NET_INVALID } : { kind: 'invalid', field: 'grossSalary', reason: GROSS_INVALID };
  }
  return { kind: 'ok', breakdown: start === 'net' ? netToGross(n, rates, 1, allowances) : grossToNet(n, rates, allowances), estimate: null };
}

/**
 * Switching between typing the gross and typing the net: the other field starts with what the current one gives, so
 * the salary stays the same. Left as it was when there is nothing to work from.
 */
export function switchStart(to: SalaryStart, typed: TermsTyped, rates: LawRatesOrYear, allowances: readonly AllowanceTerms[] = []): TermsTyped {
  const from = offerSalary({ ...typed, payBasis: 'monthly', salaryBasis: to === 'net' ? 'gross' : 'net' }, rates, allowances);
  if (from.kind !== 'ok') return { ...typed, salaryBasis: to };
  return to === 'net'
    ? { ...typed, salaryBasis: to, wantedNet: plainAmount(from.breakdown.net) }
    : { ...typed, salaryBasis: to, grossSalary: plainAmount(from.breakdown.gross) };
}

/**
 * Switching between typing the gross per hour and the net per hour: the other rate starts with what the current one
 * gives, so the pay stays the same (see switchRateBasis). Left as it was when there is nothing to work from.
 */
export function switchRate(to: SalaryStart, typed: TermsTyped, rates: LawRatesOrYear, allowances: readonly AllowanceTerms[] = []): TermsTyped {
  const s = switchRateBasis(to, { rate: typed.hourlyRate, netRate: typed.netRate, hours: typed.hoursPerWeek }, rates, allowances);
  return { ...typed, rateBasis: to, hourlyRate: s.rate, netRate: s.netRate };
}

/** "EGP 150.00 × 20 hours a week × 52 ÷ 12 = EGP 13,000.00 a month", for the hourly fields' hint. */
export function estimateText(rate: number, hours: number, estimate: number): string {
  return `${formatEgp(rate)} × ${formatAmount(hours)} hours a week × 52 ÷ 12 = ${formatEgp(estimate)} a month, the monthly estimate.`;
}

/**
 * The month's breakdown as the offer form lists it: the gross, the allowances, what is deducted, the net and the
 * company's cost. `rates`: those `b` was worked out with (or a year for the built-in ones), whose shares and rates the
 * rows give. `insuredAllowances`: the allowances counted in the insured wage, to say when the wage is capped at the
 * year's maximum or raised to its minimum.
 */
export function offerBreakdownRows(
  b: SalaryBreakdown,
  rates: LawRatesOrYear,
  { hourly = false, insuredAllowances = 0 }: { hourly?: boolean; insuredAllowances?: number } = {},
): BreakdownRow[] {
  const r = ratesOf(rates);
  return [
    { label: 'Gross salary', amount: b.gross, note: hourly ? 'the monthly estimate' : undefined, kind: 'amount' },
    ...(b.allowances > 0
      ? [
          {
            label: 'Allowances',
            amount: b.allowances,
            note: b.taxableAllowances > 0 ? `${formatMoney(b.taxableAllowances)} of it taxed` : 'not taxed',
            kind: 'addition' as const,
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
    { label: 'Net salary', amount: b.net, note: b.allowances > 0 ? 'allowances included' : undefined, kind: 'total' },
    {
      label: 'Company cost',
      amount: b.companyCost,
      note: `gross and allowances, plus the company's ${formatPercent(r.employerInsuranceRate)} insurance, ${formatMoney(b.employerInsurance)}`,
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
