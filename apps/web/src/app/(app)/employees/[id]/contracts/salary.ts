import {
  grossToNet,
  hourlyRateFromNet,
  insurableWageLimits,
  insuredWageOf,
  monthlyFromHourly,
  netToGross,
  PAY_BASIS_LABELS,
  ratesOf,
  WEEKS_PER_MONTH,
  type AllowanceTerms,
  type LawRates,
  type LawRatesOrYear,
  type PayBasis,
  type SalaryBreakdown,
} from '@trendlix/shared';

// A contract's money, as the contract form previews it and the Contracts tab shows it: amounts in EGP, the basic and
// variable parts of the gross, the insured salary on the social insurance copy, and the net worked out from the gross
// (or the gross from a net) as the Ministry of Finance's salary tax system does (grossToNet / netToGross in
// @trendlix/shared). The Salary Calculator page uses the same helpers.
//
// The owner's requests of 15 October 2026: allowances are paid every month on top of the gross, each kind taxed or not
// and insured or not, and the net and the insured salary include them; and part-time pay can be by the hour, when the
// gross is the monthly estimate, rate × hours a week × 52 ÷ 12 (monthlyFromHourly in @trendlix/shared). By the hour,
// HR can also start from an agreed net rate, and the gross rate is worked out (hourlyRateFromNet); the contract keeps
// the gross rate.
//
// The rates set by law (owner's request, 16 October 2026: the Super Admin keeps them by year in Organization → Payroll):
// each helper takes the year's rates (`rates`, lawRatesFor in @trendlix/shared on the years the page loaded), or a year
// for the built-in ones, and the rows' rates (e.g. "Employee social insurance (11%)") are those rates'.

const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const piastres = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * An amount in EGP, always with two decimals (owner, 16 October 2026: "make all the wages with 2 decimal places"):
 * 16700 → "EGP 16,700.00", 2500.5 → "EGP 2,500.50".
 */
export function formatEgp(amount: number): string {
  return `EGP ${piastres.format(amount)}`;
}

/** An amount without "EGP", always with two decimals (as formatEgp): 16700 → "16,700.00", for limits, tiers and notes. */
export function formatMoney(amount: number): string {
  return piastres.format(amount);
}

/** A number that isn't money, e.g. hours: 22.5 → "22.5", 40 → "40". */
export function formatAmount(amount: number): string {
  return money.format(amount);
}

const latinDigits = (input: string) => input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/**
 * An amount as typed: "15000", "15,000", "15 000" or in Arabic digits, with up to 2 decimals. "" → null (left empty);
 * anything else that is not an amount → NaN.
 */
export function parseAmount(input: string): number | null {
  const s = latinDigits(input).replace(/[,\s]/g, '');
  if (s === '') return null;
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** The gross split by the basic percent (80% by default): the basic part, and the variable rest. */
export function splitSalary(gross: number, basicPercent: number): { basic: number; variable: number } {
  const basic = cents((gross * basicPercent) / 100);
  return { basic, variable: cents(gross - basic) };
}

/**
 * The insurable wage limits of the year's rates, and the year they are from (for a year, the built-in ones: the latest
 * known for a later year).
 */
export function insurableLimits(rates: LawRatesOrYear): { year: number; min: number; max: number } {
  return insurableWageLimits(rates);
}

/**
 * Which year's rates set by law a year uses, in a few words: "the rates set by law for 2026", or for a year without its
 * own "the rates set by law for 2027, those of 2026" (the latest earlier one, or the earliest for a year before them).
 */
export function ratesYearText(year: number, rates: LawRates): string {
  return `the rates set by law for ${year}${rates.year === year ? '' : `, those of ${rates.year}`}`;
}

/** Allowances added up, a month: all of them, the taxed ones and the insured ones. */
export function allowanceTotals(allowances: readonly AllowanceTerms[]): { total: number; taxable: number; insured: number } {
  const sum = (which: (a: AllowanceTerms) => boolean) => cents(allowances.reduce((t, a) => t + (which(a) ? a.amount : 0), 0));
  return { total: sum(() => true), taxable: sum((a) => a.taxable), insured: sum((a) => a.insured) };
}

/**
 * The insured salary for a gross and its allowances, and why it is that amount: "the 2026 maximum" when the gross and
 * the insured allowances are above the maximum insurable wage of the year's rates, "the 2026 minimum" when below its
 * minimum, else "the actual gross" (or "the gross and the insured allowances").
 */
export function insuredFor(gross: number, rates: LawRatesOrYear, allowances: readonly AllowanceTerms[] = []): { amount: number; why: string } {
  const insured = allowanceTotals(allowances).insured;
  const base = cents(gross + insured);
  const amount = insuredWageOf(gross, allowances, rates);
  // the year the rates are from: a year without its own uses the latest earlier one's
  const from = ratesOf(rates).year;
  if (amount < base) return { amount, why: `the ${from} maximum` };
  if (amount > base) return { amount, why: `the ${from} minimum` };
  return { amount, why: insured > 0 ? 'the gross and the insured allowances' : 'the actual gross' };
}

// ---------- gross and net ----------

/** What HR types: the gross (the net is worked out), or the net wanted (the gross is worked out). */
export type SalaryBasis = 'gross' | 'net';

export const SALARY_BASES: readonly SalaryBasis[] = ['gross', 'net'];
export const SALARY_BASIS_LABELS: Record<SalaryBasis, string> = { gross: 'Gross', net: 'Net' };

/** The Gross / Net switch as submitted or in the address: 'net', else the gross (the default). */
export function basisFrom(value: unknown): SalaryBasis {
  return value === 'net' ? 'net' : 'gross';
}

export type SalaryResult =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  /** A net the allowances alone already give (`net`): there is no gross to work out. */
  | { kind: 'belowAllowances'; net: number }
  | { kind: 'ok'; typed: number; breakdown: SalaryBreakdown };

/**
 * The breakdown for an amount as typed (see `parseAmount`): a gross's net, or for a net the lowest whole-pound gross
 * whose net reaches it, with the allowances on top (their net included), with the year's rates set by law (`rates`, or
 * a year for the built-in ones). Left empty → empty; not an amount, or 0 → invalid.
 */
export function salaryFor(basis: SalaryBasis, input: string, rates: LawRatesOrYear, allowances: readonly AllowanceTerms[] = []): SalaryResult {
  const n = parseAmount(input);
  if (n === null) return { kind: 'empty' };
  if (Number.isNaN(n) || n <= 0) return { kind: 'invalid' };
  if (basis === 'gross') return { kind: 'ok', typed: n, breakdown: grossToNet(n, rates, allowances) };
  // asked first: just above 0 the insured wage jumps to the year's minimum, so a tiny gross could seem to reach it
  const allowancesNet = allowances.length > 0 ? grossToNet(0, rates, allowances).net : 0;
  const b = netToGross(n, rates, 1, allowances);
  return allowancesNet < n && b.gross > 0 ? { kind: 'ok', typed: n, breakdown: b } : { kind: 'belowAllowances', net: allowancesNet };
}

/** Why there is no gross for a net (`hourly`: no gross rate for a net rate): the allowances alone give it, a month. */
export function belowAllowancesText(net: number, hourly = false): string {
  return hourly
    ? `The allowances alone give a net of ${formatEgp(net)} a month: enter a higher net rate, or fewer allowances.`
    : `The allowances alone give a net of ${formatEgp(net)}: enter a higher net, or fewer allowances.`;
}

/** An amount as the form sends it and the address holds it: 13069.65 → "13069.65", 16700 → "16700". */
export function plainAmount(amount: number): string {
  return String(cents(amount));
}

/**
 * Switching what HR starts from on the contract form: the other field starts with what the current one gives, so the
 * salary stays the same (a gross with piasters comes back in whole pounds). Left as it was when there is nothing to
 * work from.
 */
export function switchBasis(
  to: SalaryBasis,
  typed: { gross: string; net: string },
  rates: LawRatesOrYear,
  allowances: readonly AllowanceTerms[] = [],
): { gross: string; net: string } {
  const from = salaryFor(to === 'net' ? 'gross' : 'net', to === 'net' ? typed.gross : typed.net, rates, allowances);
  if (from.kind !== 'ok') return typed;
  return to === 'net' ? { ...typed, net: plainAmount(from.breakdown.net) } : { ...typed, gross: plainAmount(from.breakdown.gross) };
}

/** 0.11 → "11%", 0.0005 → "0.05%", 0.1875 → "18.75%". */
export function formatPercent(rate: number): string {
  return `${Number((rate * 100).toFixed(4))}%`;
}

/**
 * Why the insured wage isn't the gross (with the insured allowances): "capped at 16,700" above the year's maximum,
 * "raised to the minimum, 2,700" below its minimum, or "the gross and the insured allowances".
 */
export function insuredWageNote(b: Pick<SalaryBreakdown, 'gross' | 'insuredWage'>, insuredAllowances = 0): string | undefined {
  const base = cents(b.gross + insuredAllowances);
  if (b.insuredWage < base) return `capped at ${formatMoney(b.insuredWage)}`;
  if (b.insuredWage > base) return `raised to the minimum, ${formatMoney(b.insuredWage)}`;
  return insuredAllowances > 0 ? 'the gross and the insured allowances' : undefined;
}

/** How the allowances are treated, in a few words: "taxed, not insured", or "1,000 taxed, 500 insured" when they differ. */
export function allowancesNote(allowances: readonly AllowanceTerms[]): string {
  const t = allowanceTotals(allowances);
  const part = (amount: number, word: string) => (amount >= t.total ? word : amount <= 0 ? `not ${word}` : `${formatMoney(amount)} ${word}`);
  return `${part(t.taxable, 'taxed')}, ${part(t.insured, 'insured')}`;
}

/** For a net typed: the gross worked out (its net can be up to a pound more than asked, the gross being in whole pounds). */
export function workedOutGross(asked: number, b: SalaryBreakdown): string {
  return `${formatEgp(b.gross)} gross: the lowest whole-pound gross whose net reaches ${formatEgp(asked)}.`;
}

export interface BreakdownRow {
  label: string;
  amount: number;
  /** Shown after the label, e.g. "capped at 16,700". */
  note?: string;
  /**
   * addition: paid on top of the gross (allowances); deduction: taken off; total: what is left (or what it all comes
   * to); company: what the company pays, shown quieter.
   */
  kind: 'amount' | 'addition' | 'deduction' | 'total' | 'company';
}

const healthRow = (b: SalaryBreakdown, r: LawRates): BreakdownRow[] =>
  b.healthInsurance > 0 ? [{ label: `Health insurance (${formatPercent(r.healthInsuranceRate)})`, amount: b.healthInsurance, kind: 'deduction' }] : [];

/**
 * The contract form's breakdown, monthly: the gross, the allowances (`allowances`: those `b` was worked out with), the
 * insured wage, what is deducted, the net and the company's cost. `rates`: those `b` was worked out with (or a year for
 * the built-in ones), whose shares and rates the rows give.
 */
export function breakdownRows(b: SalaryBreakdown, rates: LawRatesOrYear, allowances: readonly AllowanceTerms[] = []): BreakdownRow[] {
  const r = ratesOf(rates);
  const withAllowances = b.allowances > 0;
  return [
    { label: 'Gross salary', amount: b.gross, kind: 'amount' },
    ...(withAllowances ? [{ label: 'Allowances', amount: b.allowances, note: allowancesNote(allowances), kind: 'addition' as const }] : []),
    { label: 'Insured wage', amount: b.insuredWage, note: insuredWageNote(b, allowanceTotals(allowances).insured), kind: 'amount' },
    { label: `Employee social insurance (${formatPercent(r.employeeInsuranceRate)})`, amount: b.employeeInsurance, kind: 'deduction' },
    ...healthRow(b, r),
    { label: 'Income tax', amount: b.monthlyTax, kind: 'deduction' },
    { label: `Martyrs' Fund (${formatPercent(r.martyrsRate)})`, amount: b.martyrsFund, kind: 'deduction' },
    // the allowances are in the net: say so, as the owner looked for them there (15 October 2026)
    { label: 'Net salary', amount: b.net, note: withAllowances ? 'allowances included' : undefined, kind: 'total' },
    {
      label: 'Company cost',
      amount: b.companyCost,
      note: `${withAllowances ? 'gross and allowances' : 'gross'} plus the company's ${formatPercent(r.employerInsuranceRate)} insurance, ${formatMoney(b.employerInsurance)}`,
      kind: 'company',
    },
  ];
}

/**
 * A saved contract whose net was typed by hand and differs from the calculated one (for the same gross): both, so the
 * form can say the calculated one is saved instead. Null when they agree, nothing was saved or the gross has changed.
 */
export function savedNetChange(saved: { gross: number | null; net: number | null }, b: SalaryBreakdown | null): { saved: number; calculated: number } | null {
  if (!b || saved.net === null || saved.gross !== b.gross) return null;
  return Math.abs(saved.net - b.net) >= 0.005 ? { saved: saved.net, calculated: b.net } : null;
}

// ---------- pay by the hour, working days, allowances ----------

/** The most hours a week by the hour: the legal working week (8 hours a day, 6 days). */
export const MAX_HOURS_PER_WEEK = 48;

/** Hours as typed: "20", "22.5" or in Arabic digits, with up to 1 decimal. "" → null (left empty); anything else → NaN. */
export function parseHours(input: string): number | null {
  const s = latinDigits(input).replace(/\s/g, '');
  if (s === '') return null;
  return /^\d+(\.\d)?$/.test(s) ? Number(s) : NaN;
}

export type HourlyResult = { kind: 'empty' } | { kind: 'invalid'; field: 'rate' | 'hours' } | { kind: 'ok'; rate: number; hours: number; gross: number };

/**
 * By the hour: the rate and the hours a week as typed, and the gross they give, the monthly estimate (rate × hours a
 * week × 52 ÷ 12). Either left empty → empty; a rate that is not an amount above 0, or hours not from above 0 to 48 →
 * invalid, naming the field.
 */
export function hourlyFor(rateInput: string, hoursInput: string): HourlyResult {
  const rate = parseAmount(rateInput);
  const hours = parseHours(hoursInput);
  if (rate !== null && (Number.isNaN(rate) || rate <= 0)) return { kind: 'invalid', field: 'rate' };
  if (hours !== null && (Number.isNaN(hours) || hours <= 0 || hours > MAX_HOURS_PER_WEEK)) return { kind: 'invalid', field: 'hours' };
  if (rate === null || hours === null) return { kind: 'empty' };
  return { kind: 'ok', rate, hours, gross: monthlyFromHourly(rate, hours) };
}

/** "20 hours a week", "22.5 hours a week", "1 hour a week". */
export function hoursLabel(hours: number): string {
  return `${money.format(hours)} ${hours === 1 ? 'hour' : 'hours'} a week`;
}

/** "EGP 150.00 an hour × 20 hours a week". */
export function hourlyLabel(rate: number, hours: number): string {
  return `${formatEgp(rate)} an hour × ${hoursLabel(hours)}`;
}

/** How the monthly estimate is worked out: "EGP 150.00 an hour × 20 hours a week × 52 ÷ 12 = EGP 13,000.00 a month". */
export function monthlyEstimateText(h: { rate: number; hours: number; gross: number }): string {
  return `${hourlyLabel(h.rate, h.hours)} × 52 ÷ 12 = ${formatEgp(h.gross)} a month`;
}

// ---------- by the hour, from the net rate ----------

/** By the hour, what HR types the rate as: the gross per hour, or the net per hour agreed (the gross rate is worked out). */
export const RATE_BASIS_LABELS: Record<SalaryBasis, string> = { gross: 'Gross per hour', net: 'Net per hour' };

/** A month's net as an hourly rate: the net ÷ (hours a week × 52 ÷ 12), to the piaster. */
export function netPerHour(net: number, hours: number): number {
  return cents(net / (hours * WEEKS_PER_MONTH));
}

/** "≈ EGP 120.00 net per hour", for a month's net and the hours a week. */
export function netPerHourText(net: number, hours: number): string {
  return `≈ ${formatEgp(netPerHour(net, hours))} net per hour`;
}

export type HourlyPayResult =
  | { kind: 'empty' }
  | { kind: 'invalid'; field: 'rate' | 'hours' }
  /** A net rate whose month the allowances alone already give (`net`, a month): there is no gross rate to work out. */
  | { kind: 'belowAllowances'; net: number }
  /** `rate`: the gross rate, as typed or worked out; `gross`: its monthly estimate. */
  | { kind: 'ok'; rate: number; hours: number; gross: number; breakdown: SalaryBreakdown };

/**
 * By the hour, the pay for the rate as typed (see `hourlyFor`), with the month's breakdown: from the gross rate, or
 * from the net rate agreed, when the gross rate is the lowest, to the piaster, whose monthly estimate's net (allowances
 * included) reaches the net rate's month (hourlyRateFromNet). `kept`: the gross rate typed before, kept while its net
 * per hour is the net rate, so switching from the gross and back changes nothing.
 */
export function hourlyPayFor(
  basis: SalaryBasis,
  rateInput: string,
  hoursInput: string,
  rates: LawRatesOrYear,
  allowances: readonly AllowanceTerms[] = [],
  kept = '',
): HourlyPayResult {
  const typed = hourlyFor(rateInput, hoursInput);
  if (typed.kind !== 'ok') return typed;
  const { rate, hours } = typed;
  if (basis === 'gross') return { ...typed, breakdown: grossToNet(typed.gross, rates, allowances) };
  const before = hourlyFor(kept, hoursInput);
  if (before.kind === 'ok') {
    const breakdown = grossToNet(before.gross, rates, allowances);
    if (netPerHour(breakdown.net, hours) === rate) return { ...before, breakdown };
  }
  // asked first: just above 0 the insured wage jumps to the year's minimum, so a tiny gross could seem to reach it
  // (typed.gross is the net rate's month here)
  const allowancesNet = allowances.length > 0 ? grossToNet(0, rates, allowances).net : 0;
  if (allowancesNet >= typed.gross) return { kind: 'belowAllowances', net: allowancesNet };
  const worked = hourlyRateFromNet(rate, hours, rates, allowances);
  if (!(worked.hourlyRate > 0)) return { kind: 'belowAllowances', net: allowancesNet };
  return { kind: 'ok', rate: worked.hourlyRate, hours, gross: worked.breakdown.gross, breakdown: worked.breakdown };
}

/** For a net rate typed: the gross rate worked out, and the net per hour it gives. */
export function workedOutRate(p: { rate: number; hours: number; breakdown: SalaryBreakdown }): string {
  return `${formatEgp(p.rate)} gross per hour, which gives ${netPerHourText(p.breakdown.net, p.hours)}.`;
}

/**
 * Switching what HR types the hourly rate as: the other field starts with what the current one gives, so the pay
 * stays the same (the net rate to the piaster; coming back, the gross rate typed before while it gives that net rate).
 * Left as it was when there is nothing to work from.
 */
export function switchRateBasis(
  to: SalaryBasis,
  typed: { rate: string; netRate: string; hours: string },
  rates: LawRatesOrYear,
  allowances: readonly AllowanceTerms[] = [],
): { rate: string; netRate: string } {
  const unchanged = { rate: typed.rate, netRate: typed.netRate };
  if (to === 'net') {
    const from = hourlyPayFor('gross', typed.rate, typed.hours, rates, allowances);
    return from.kind === 'ok' ? { ...unchanged, netRate: plainAmount(netPerHour(from.breakdown.net, from.hours)) } : unchanged;
  }
  const from = hourlyPayFor('net', typed.netRate, typed.hours, rates, allowances, typed.rate);
  return from.kind === 'ok' ? { ...unchanged, rate: plainAmount(from.rate) } : unchanged;
}

/** By the hour, a saved contract's or offer's net as a rate: "≈ EGP 120.00 net per hour". Null when hidden or not known. */
export function hourlyNetTerms(c: PayTerms & { netSalary: number | null }): string | null {
  if (c.payBasis !== 'hourly' || c.salaryHidden || c.netSalary === null || c.netSalary === undefined || !c.hoursPerWeek) return null;
  return netPerHourText(c.netSalary, c.hoursPerWeek);
}

/** "3 days a week", "1 day a week"; null (the shift's week) → null. */
export function daysLabel(days: number | null): string | null {
  return days ? `${days} ${days === 1 ? 'day' : 'days'} a week` : null;
}

/** A contract's allowances, each with its amount a month: "Transport EGP 1,000.00 · Mobile EGP 500.00". */
export function allowancesLabel(lines: readonly { nameEn: string; amount: number }[]): string {
  return lines.map((a) => `${a.nameEn} ${formatEgp(a.amount)}`).join(' · ');
}

/** A contract's (or offer's) pay terms as the API sends them; the amounts are null when the salary is hidden. */
export interface PayTerms {
  payBasis: PayBasis;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  daysPerWeek: number | null;
  salaryHidden?: boolean;
}

/** By the hour: "EGP 150.00 an hour × 20 hours a week", or "20 hours a week" when the salary is hidden. Null for a monthly salary. */
export function hourlyTerms(c: PayTerms): string | null {
  if (c.payBasis !== 'hourly' || c.hoursPerWeek === null || c.hoursPerWeek === undefined) return null;
  return !c.salaryHidden && c.hourlyRate !== null && c.hourlyRate !== undefined ? hourlyLabel(c.hourlyRate, c.hoursPerWeek) : hoursLabel(c.hoursPerWeek);
}

/** How the pay is set, in a few words: "Monthly salary", "By the hour: EGP 150.00 an hour × 20 hours a week · 3 days a week". */
export function payLabel(c: PayTerms): string {
  const basis = PAY_BASIS_LABELS[c.payBasis] ?? PAY_BASIS_LABELS.monthly;
  const hourly = hourlyTerms(c);
  return [hourly ? `${basis}: ${hourly}` : basis, daysLabel(c.daysPerWeek ?? null)].filter(Boolean).join(' · ');
}
