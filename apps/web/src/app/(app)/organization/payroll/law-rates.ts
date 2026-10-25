import { LAW_YEAR_MAX, lawRatesProblems, normalTaxTiers, type LawRates, type Role, type TaxBand, type TaxTier } from '@trendlix/shared';
import { formatDateTime } from '../../../../lib/format';
import { hasRole, isSuperAdmin } from '../../../../lib/roles';
import type { LawRatesView } from '../../../../lib/types';
import { formatMoney, formatPercent, parseAmount, plainAmount } from '../../employees/[id]/contracts/salary';

// Organization → Payroll, Rates Set by Law (owner's request, 16 October 2026: "creating a setup page for payroll to
// enter the variables that might affect the sheet"): by year, the social insurance shares and the insurable wage's
// limits, the personal exemption, the Martyrs' Fund, comprehensive health insurance and the salary tax's tiers and
// bands, "editable by superadmin, to modify it if the law changed"; since 18 October 2026 the minimum wage too, for
// reference (the paid trainee's last stage floor, Labour Law 14/2025 Art. 29, until the trainee went on 25 October 2026),
// left empty until the owner sets it; since
// 20 October 2026 (owner, on the employee's medical share: "Before Tax i think") the before-tax health insurance limit a
// year, which caps what the recurring deductions ticked "Deducted before tax" lower the taxable pay by (a twelfth a
// month), left empty for no limit, as the tax law's limit is the accountant's to give. Each
// year's values apply from that year: a year without its own uses the latest earlier one (the earliest for a year before
// them all). HR, Finance, the CEO and Admin read them; only the Super Admin changes them, and the API checks this again.
// Pure code, tested: who sees and changes them, the form as typed (rates as percents, amounts in EGP) into the rates PUT
// /payroll/law-rates/:year takes, the tier editor's rows, and the words the table and the Salary Calculator show them
// in. Relative imports: the tests run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };

/** HR, Finance, the CEO and Admin (a Super Admin too) read the rates set by law (GET /payroll/law-rates). */
export function seesLawRates(user: WithRoles): boolean {
  return hasRole(user, 'hr', 'finance', 'ceo', 'admin');
}

/** Only the Super Admin changes them (owner, 16 October 2026: "editable by superadmin"). */
export function changesLawRates(user: WithRoles): boolean {
  return isSuperAdmin(user);
}

// ---------- percents and amounts as typed ----------

const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.');

/** A rate as its field shows it, in percent to 4 decimals: 0.11 → "11", 0.1875 → "18.75", 0.0005 → "0.05". */
export function percentField(rate: number): string {
  return String(Number((rate * 100).toFixed(4)));
}

/**
 * A percent as typed, as the fraction the API keeps: "11" → 0.11, "18.75" → 0.1875, "0.05" → 0.0005; up to 4 decimals,
 * in Arabic digits too, a "%" after it allowed. Worked out from the digits, so it is the fraction as typed, without the
 * noise of binary fractions (18.75 ÷ 100 by floating point is not always 0.1875). "" → null; anything else → NaN.
 */
export function parsePercent(input: string): number | null {
  const s = latin(input).replace(/\s/g, '').replace(/%$/, '');
  if (s === '') return null;
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return NaN;
  // in millionths: the percent's ten-thousandths
  return (Number(m[1]) * 10_000 + Number((m[2] ?? '').padEnd(4, '0'))) / 1_000_000;
}

/** A rate as typed for the rates: the fraction, or NaN when left empty or not a percent (lawRatesProblems says so). */
const rateOf = (input: string) => parsePercent(input) ?? NaN;

/** An amount as typed for the rates (parseAmount: to the piaster, Arabic digits too), or NaN when left empty or not one. */
const amountOf = (input: string) => parseAmount(latin(input)) ?? NaN;

/** An amount that may be left empty (the minimum wage): null when empty, else as amountOf. */
const optionalAmountOf = (input: string) => (input.trim() === '' ? null : amountOf(input));

// ---------- the tier editor ----------

/** A band as the tier editor has it: its upper limit (the last band's is not used: no limit) and its rate in percent. */
export interface BandRow {
  key: string;
  upTo: string;
  rate: string;
}

/** A tier as the tier editor has it: its income limit (the last tier's is not used: no limit) and its bands. */
export interface TierRow {
  key: string;
  upTo: string;
  bands: BandRow[];
}

const limitField = (upTo: number | null) => (upTo === null ? '' : plainAmount(upTo));

/** A year's tiers as the editor's rows, to start from. Keys "t1", "t1b2" …: the editor's own rows get other keys. */
export function tierRowsOf(tiers: readonly TaxTier[]): TierRow[] {
  return tiers.map((t, i) => ({
    key: `t${i + 1}`,
    upTo: limitField(t.upTo),
    bands: t.bands.map((b, j) => ({ key: `t${i + 1}b${j + 1}`, upTo: limitField(b.upTo), rate: percentField(b.rate) })),
  }));
}

/**
 * The tiers the rows give: the last tier without an income limit and each tier's last band without an upper limit
 * (their fields are not shown), every other limit and rate as typed (NaN when left empty or wrong, which
 * taxTiersProblems names).
 */
export function taxTiersOf(rows: readonly TierRow[]): TaxTier[] {
  return rows.map((t, i) => ({
    upTo: i === rows.length - 1 ? null : amountOf(t.upTo),
    bands: t.bands.map((b, j): TaxBand => ({ upTo: j === t.bands.length - 1 ? null : amountOf(b.upTo), rate: rateOf(b.rate) })),
  }));
}

/**
 * Another tier at the end, with no income limit, starting with the bands of the tier before it (so the bands need only
 * changing); that tier, no longer the last, gets an income limit to fill in. `key`: the new tier's, unused so far.
 */
export function addTier(rows: readonly TierRow[], key: string): TierRow[] {
  const last = rows.at(-1);
  const bands = last ? last.bands.map((b, j) => ({ ...b, key: `${key}b${j + 1}` })) : [{ key: `${key}b1`, upTo: '', rate: '' }];
  return [...rows, { key, upTo: '', bands }];
}

/** The rows without tier `i` (one tier is always kept: the table needs one). */
export function removeTier(rows: readonly TierRow[], i: number): TierRow[] {
  return rows.length > 1 ? rows.filter((_, k) => k !== i) : [...rows];
}

/**
 * Another band at the end of tier `i`, with no upper limit and the rate of the band before it; that band, no longer the
 * last, gets an upper limit to fill in. `key`: the new band's, unused so far.
 */
export function addBand(rows: readonly TierRow[], i: number, key: string): TierRow[] {
  return rows.map((t, k) => (k === i ? { ...t, bands: [...t.bands, { key, upTo: '', rate: t.bands.at(-1)?.rate ?? '' }] } : t));
}

/** Tier `i` without band `j` (one band is always kept: a tier needs one). */
export function removeBand(rows: readonly TierRow[], i: number, j: number): TierRow[] {
  return rows.map((t, k) => (k === i && t.bands.length > 1 ? { ...t, bands: t.bands.filter((_, m) => m !== j) } : t));
}

/** Tier `i` with `change` made to its income limit, or to band `j`'s limit or rate. */
export function changeTier(rows: readonly TierRow[], i: number, change: { upTo: string } | { band: number; upTo?: string; rate?: string }): TierRow[] {
  return rows.map((t, k) => {
    if (k !== i) return t;
    if (!('band' in change)) return { ...t, upTo: change.upTo };
    const { band, ...field } = change;
    return { ...t, bands: t.bands.map((b, m) => (m === band ? { ...b, ...field } : b)) };
  });
}

// ---------- the form ----------

/** A year's rates as the form has them: the rates in percent, the amounts in EGP, the tiers as the editor's rows. */
export interface LawRatesTyped {
  year: string;
  employeeInsuranceRate: string;
  employerInsuranceRate: string;
  insurableWageMin: string;
  insurableWageMax: string;
  personalExemption: string;
  martyrsRate: string;
  healthInsuranceRate: string;
  /** Empty: not set (owner, 18 October 2026: the owner sets it, for reference; nothing is checked against it). */
  minimumWage: string;
  /** EGP a year; empty: no limit (owner, 20 October 2026: "Before Tax i think"). */
  beforeTaxHealthLimit: string;
  taxTiers: TierRow[];
}

/** A year's rates as the form starts with them, for `year` (theirs, or the year being added from them). */
export function typedOf(r: LawRates, year = r.year): LawRatesTyped {
  return {
    year: String(year),
    employeeInsuranceRate: percentField(r.employeeInsuranceRate),
    employerInsuranceRate: percentField(r.employerInsuranceRate),
    insurableWageMin: plainAmount(r.insurableWageMin),
    insurableWageMax: plainAmount(r.insurableWageMax),
    personalExemption: plainAmount(r.personalExemption),
    martyrsRate: percentField(r.martyrsRate),
    healthInsuranceRate: percentField(r.healthInsuranceRate),
    minimumWage: typeof r.minimumWage === 'number' ? plainAmount(r.minimumWage) : '',
    beforeTaxHealthLimit: typeof r.beforeTaxHealthLimit === 'number' ? plainAmount(r.beforeTaxHealthLimit) : '',
    taxTiers: tierRowsOf(r.taxTiers),
  };
}

/**
 * The rates the form gives, as PUT /payroll/law-rates/:year takes them (with the year); what can't be read is NaN. The
 * minimum wage and the before-tax health insurance limit only when typed, as normalLawRates keeps them.
 */
export function lawRatesOf(t: LawRatesTyped): LawRates {
  const year = latin(t.year).trim();
  const minimumWage = optionalAmountOf(t.minimumWage);
  // a form from before it came has none: no limit
  const beforeTaxHealthLimit = optionalAmountOf(t.beforeTaxHealthLimit ?? '');
  return {
    year: /^\d{4}$/.test(year) ? Number(year) : NaN,
    employeeInsuranceRate: rateOf(t.employeeInsuranceRate),
    employerInsuranceRate: rateOf(t.employerInsuranceRate),
    insurableWageMin: amountOf(t.insurableWageMin),
    insurableWageMax: amountOf(t.insurableWageMax),
    personalExemption: amountOf(t.personalExemption),
    martyrsRate: rateOf(t.martyrsRate),
    healthInsuranceRate: rateOf(t.healthInsuranceRate),
    ...(minimumWage !== null && { minimumWage }),
    ...(beforeTaxHealthLimit !== null && { beforeTaxHealthLimit }),
    taxTiers: taxTiersOf(t.taxTiers),
  };
}

/** Why a year being added is refused when it is kept already: saving would replace its rates. */
export const alreadyKept = (year: number) => `There are rates for ${year} already: change them with its Change button instead.`;

/**
 * What is wrong with the form, in plain words (none: it can be sent): lawRatesProblems on what it gives (as the API
 * checks), and, adding a year, one already kept, which would be replaced: it is changed with its own Change button.
 */
export function formProblems(t: LawRatesTyped, adding: { kept: readonly number[] } | null): string[] {
  const rates = lawRatesOf(t);
  const problems = lawRatesProblems(rates);
  if (adding && adding.kept.includes(rates.year)) problems.unshift(alreadyKept(rates.year));
  return problems;
}

/**
 * What PUT /payroll/law-rates/:year takes: every rate but the year, which is in the address (unknown fields are
 * refused); the minimum wage and the before-tax health insurance limit null when they aren't set.
 */
export function lawRatesBody(r: LawRates): Omit<LawRates, 'year'> {
  return {
    employeeInsuranceRate: r.employeeInsuranceRate,
    employerInsuranceRate: r.employerInsuranceRate,
    insurableWageMin: r.insurableWageMin,
    insurableWageMax: r.insurableWageMax,
    personalExemption: r.personalExemption,
    martyrsRate: r.martyrsRate,
    healthInsuranceRate: r.healthInsuranceRate,
    minimumWage: r.minimumWage ?? null,
    beforeTaxHealthLimit: r.beforeTaxHealthLimit ?? null,
    taxTiers: normalTaxTiers(r.taxTiers),
  };
}

/**
 * The before-tax health insurance limit in words (20 October 2026): "Before tax: up to 6,000.00 a year", or "Before tax:
 * no limit set".
 */
export const beforeTaxLimitText = (r: Pick<LawRates, 'beforeTaxHealthLimit'>) =>
  typeof r.beforeTaxHealthLimit === 'number' ? `Before tax: up to ${formatMoney(r.beforeTaxHealthLimit)} a year` : 'Before tax: no limit set';

// ---------- the table, and the Salary Calculator's list ----------

/** A limit's range from the one before: "Up to 40,000.00", "40,000.00 to 55,000.00", "Above 400,000.00"; one alone with no limit: "Any amount". */
function rangeText(from: number | null, upTo: number | null): string {
  if (from === null) return upTo === null ? 'Any amount' : `Up to ${formatMoney(upTo)}`;
  return upTo === null ? `Above ${formatMoney(from)}` : `${formatMoney(from)} to ${formatMoney(upTo)}`;
}

/** A tier's bands, each with its rate: "Up to 40,000.00: 0%", "40,000.00 to 55,000.00: 10%", …, "Above 400,000.00: 25%". */
export function bandLabels(bands: readonly TaxBand[]): string[] {
  return bands.map((b, j) => `${rangeText(j === 0 ? null : bands[j - 1].upTo, b.upTo)}: ${formatPercent(b.rate)}`);
}

/**
 * The tiers as the table and the Salary Calculator list them: each tier's range of the whole annual net income ("Up to
 * 600,000.00", "600,000.00 to 700,000.00", "Above 1,200,000.00"), and its bands (bandLabels), each taxed from 0.
 */
export function tierLabels(tiers: readonly TaxTier[]): { range: string; bands: string[] }[] {
  return tiers.map((t, i) => ({ range: rangeText(i === 0 ? null : tiers[i - 1].upTo, t.upTo), bands: bandLabels(t.bands) }));
}

/** The tax table in a few words: "6 tiers, 0% to 27.5%", "1 tier, 10%". */
export function tiersSummary(tiers: readonly TaxTier[]): string {
  const rates = tiers.flatMap((t) => t.bands.map((b) => b.rate));
  const low = Math.min(...rates);
  const high = Math.max(...rates);
  const count = `${tiers.length} ${tiers.length === 1 ? 'tier' : 'tiers'}`;
  if (rates.length === 0) return count;
  return `${count}, ${low === high ? formatPercent(low) : `${formatPercent(low)} to ${formatPercent(high)}`}`;
}

/** "2,700.00 to 16,700.00". */
export function limitsText(r: Pick<LawRates, 'insurableWageMin' | 'insurableWageMax'>): string {
  return `${formatMoney(r.insurableWageMin)} to ${formatMoney(r.insurableWageMax)}`;
}

/** Who changed a year's rates last, and when: "Hazem Magdy" and "16/10/2026, 5:42 PM"; the rows the migration added are "Built in". */
export function changedText(v: Pick<LawRatesView, 'updatedAt' | 'updatedBy'>): { who: string; when: string } {
  return { who: v.updatedBy?.name ?? 'Built in', when: formatDateTime(v.updatedAt) };
}

/** The year a new one starts as: the latest kept + 1 (at most 2100), else this year. */
export function nextYear(years: readonly number[], thisYear: number): number {
  return years.length ? Math.min(Math.max(...years) + 1, LAW_YEAR_MAX) : thisYear;
}

/** Whether a year's rates can be deleted: all but the earliest, whose rates the years before it use. */
export function deletable(years: readonly number[], year: number): boolean {
  return years.length > 1 && year !== Math.min(...years);
}

/** What deleting a year (not the earliest) asks first: the year then uses the latest earlier one's. */
export function deleteQuestion(years: readonly number[], year: number): string {
  const before = Math.max(...years.filter((y) => y < year));
  return `Delete the rates set by law for ${year}? ${year} then uses those of ${before}, as does each later year without its own. Approved payroll runs keep the rates they were worked out with.`;
}
