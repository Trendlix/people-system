import { grossToNet, INSURABLE_WAGE, insuredSalary, netToGross, SALARY_RULES, type SalaryBreakdown } from '@trendlix/shared';

// A contract's money, as the contract form previews it and the Contracts tab shows it: amounts in EGP, the basic and
// variable parts of the gross, the insured salary on the social insurance copy, and the net worked out from the gross
// (or the gross from a net) as the Ministry of Finance's salary tax system does (grossToNet / netToGross in
// @trendlix/shared). The Salary Calculator page uses the same helpers.

const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** 16700 → "EGP 16,700". */
export function formatEgp(amount: number): string {
  return `EGP ${money.format(amount)}`;
}

/** 16700 → "16,700". */
export function formatAmount(amount: number): string {
  return money.format(amount);
}

/**
 * An amount as typed: "15000", "15,000", "15 000" or in Arabic digits, with up to 2 decimals. "" → null (left empty);
 * anything else that is not an amount → NaN.
 */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,\s]/g, '');
  if (s === '') return null;
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** The gross split by the basic percent (80% by default): the basic part, and the variable rest. */
export function splitSalary(gross: number, basicPercent: number): { basic: number; variable: number } {
  const basic = cents((gross * basicPercent) / 100);
  return { basic, variable: cents(gross - basic) };
}

/** The year whose insurable wage limits apply: the year itself, or the latest one known before it. */
function limitsYear(year: number): number {
  const known = Object.keys(INSURABLE_WAGE)
    .map(Number)
    .sort((a, b) => a - b);
  return INSURABLE_WAGE[year] ? year : (known.filter((y) => y <= year).at(-1) ?? known[0]);
}

/** The insurable wage limits that apply in `year`, and the year they are from (the latest known for a later year). */
export function insurableLimits(year: number): { year: number; min: number; max: number } {
  const from = limitsYear(year);
  return { year: from, ...INSURABLE_WAGE[from] };
}

/**
 * The insured salary for a gross, and why it is that amount: "the 2026 maximum" when the gross is above the year's
 * maximum insurable wage, "the 2026 minimum" when below its minimum, else "the actual gross".
 */
export function insuredFor(gross: number, year: number): { amount: number; why: string } {
  const amount = insuredSalary(gross, year);
  const limits = limitsYear(year);
  if (amount < gross) return { amount, why: `the ${limits} maximum` };
  if (amount > gross) return { amount, why: `the ${limits} minimum` };
  return { amount, why: 'the actual gross' };
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

export type SalaryResult = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'ok'; typed: number; breakdown: SalaryBreakdown };

/**
 * The breakdown for an amount as typed (see `parseAmount`): a gross's net, or for a net the lowest whole-pound gross
 * whose net reaches it. `year` sets the insurable wage limits. Left empty → empty; not an amount, or 0 → invalid.
 */
export function salaryFor(basis: SalaryBasis, input: string, year: number): SalaryResult {
  const n = parseAmount(input);
  if (n === null) return { kind: 'empty' };
  if (Number.isNaN(n) || n <= 0) return { kind: 'invalid' };
  return { kind: 'ok', typed: n, breakdown: basis === 'net' ? netToGross(n, year) : grossToNet(n, year) };
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
export function switchBasis(to: SalaryBasis, typed: { gross: string; net: string }, year: number): { gross: string; net: string } {
  const from = salaryFor(to === 'net' ? 'gross' : 'net', to === 'net' ? typed.gross : typed.net, year);
  if (from.kind !== 'ok') return typed;
  return to === 'net' ? { ...typed, net: plainAmount(from.breakdown.net) } : { ...typed, gross: plainAmount(from.breakdown.gross) };
}

/** 0.11 → "11%", 0.0005 → "0.05%", 0.1875 → "18.75%". */
export function formatPercent(rate: number): string {
  return `${Number((rate * 100).toFixed(4))}%`;
}

/** Why the insured wage isn't the gross: "capped at 16,700" above the year's maximum, "raised to the minimum, 2,700" below its minimum. */
export function insuredWageNote(b: Pick<SalaryBreakdown, 'gross' | 'insuredWage'>): string | undefined {
  if (b.insuredWage < b.gross) return `capped at ${formatAmount(b.insuredWage)}`;
  if (b.insuredWage > b.gross) return `raised to the minimum, ${formatAmount(b.insuredWage)}`;
  return undefined;
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
  /** deduction: taken off the gross; total: what is left (or what it all comes to); company: what the company pays, shown quieter. */
  kind: 'amount' | 'deduction' | 'total' | 'company';
}

const healthRow = (b: SalaryBreakdown): BreakdownRow[] =>
  b.healthInsurance > 0
    ? [{ label: `Health insurance (${formatPercent(SALARY_RULES.healthInsuranceRate)})`, amount: b.healthInsurance, kind: 'deduction' }]
    : [];

/** The contract form's breakdown, monthly: the gross, the insured wage, what is deducted, the net and the company's cost. */
export function breakdownRows(b: SalaryBreakdown): BreakdownRow[] {
  const r = SALARY_RULES;
  return [
    { label: 'Gross salary', amount: b.gross, kind: 'amount' },
    { label: 'Insured wage', amount: b.insuredWage, note: insuredWageNote(b), kind: 'amount' },
    { label: `Employee social insurance (${formatPercent(r.employeeInsuranceRate)})`, amount: b.employeeInsurance, kind: 'deduction' },
    ...healthRow(b),
    { label: 'Income tax', amount: b.monthlyTax, kind: 'deduction' },
    { label: `Martyrs' Fund (${formatPercent(r.martyrsRate)})`, amount: b.martyrsFund, kind: 'deduction' },
    { label: 'Net salary', amount: b.net, kind: 'total' },
    {
      label: 'Company cost',
      amount: b.companyCost,
      note: `gross plus the company's ${formatPercent(r.employerInsuranceRate)} insurance, ${formatAmount(b.employerInsurance)}`,
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
