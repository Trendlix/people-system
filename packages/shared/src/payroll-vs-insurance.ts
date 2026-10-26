// The Payroll vs Social Insurance report (owner, 26 October 2026: "i want a comparison report between the actual payroll
// run and the social insurance data, and the differences in the social insurance and taxes between the 2 runs"; asked
// which two figures: "actual gross and the whole cycle vs the social insurance gross with the whole cycle"). Per
// employee and month, two complete payroll cycles side by side:
// - A, the actual run: the stored payroll line as paid (the contract gross, the pay earned after the cuts, the insured
//   wage the run used, both social insurance shares, the taxable pay, the salary tax, the Martyrs' Fund, the deductions,
//   the net and the company cost), read from the run's stored result, never worked out again;
// - B, the social insurance cycle: the same month worked out by the SAME engine (payroll.ts payrollLine, with the run's
//   own copied rules and rates set by law) with the gross = the social insurance gross: the registered insured wage the
//   run took from the Social Insurance tab (PayrollTerms.insuredWage), the same basic percent, no allowances, the same
//   days paid, the same attendance, no-show and leave inputs, the same days-based additions and deductions (bonus and
//   penalty days) and the same deductions, and NO amount-based additions;
// - the differences, B − A, for the employee's and the company's insurance, the tax, the Fund, the net and the company cost.
// Everyone on the run appears: a person not registered with social insurance has no B ("Not registered"; while the
// Payroll Setup switch Social insurance for everyone is on, A already has the shares on the computed insured wage, so
// they are flagged "Counted as insured (not registered)"); a freelancer or an unpaid intern (statutory false) has no B
// either ("Outside the labour law"). Pure code: the API sends it (GET /payroll/vs-insurance) and makes its workbook from
// it; the screens word it.

import { lawRatesFor, type LawRates } from './law-rates.js';
import type { EmploymentType } from './index.js';
import type { PayBasis } from './contracts.js';
import { isDaysType } from './payroll-adjustments.js';
import {
  EMPTY_PAYROLL_INPUTS,
  PAYROLL_STATUS_LABELS,
  payrollLine,
  type PayrollInputs,
  type PayrollResult,
  type PayrollRules,
  type PayrollSegment,
  type PayrollStatus,
  type PayrollTerms,
  type SavedPayrollInputs,
} from './payroll.js';
import type { ReportPeriod } from './salary-raises.js';

// ---------- the figures ----------

/** The whole cycle's figures, in the order the blocks show them. Every name is one the developer masking knows as money. */
export const VS_INSURANCE_FIGURE_KEYS = [
  'gross',
  'earned',
  'allowances',
  'insuredWage',
  'employeeInsurance',
  'employerInsurance',
  'monthlyTaxable',
  'monthlyTax',
  'martyrsFund',
  'deductions',
  'net',
  'companyCost',
] as const;
export type VsInsuranceFigureKey = (typeof VS_INSURANCE_FIGURE_KEYS)[number];
export type VsInsuranceFigures = Record<VsInsuranceFigureKey, number>;

export const VS_INSURANCE_FIGURE_LABELS: Record<VsInsuranceFigureKey, string> = {
  gross: 'Gross',
  earned: 'Pay earned',
  allowances: 'Allowances',
  insuredWage: 'Insured wage',
  employeeInsurance: 'Employee insurance',
  employerInsurance: 'Company insurance',
  monthlyTaxable: 'Taxable pay',
  monthlyTax: 'Salary tax',
  martyrsFund: "Martyrs' Fund",
  deductions: 'Deductions',
  net: 'Net',
  companyCost: 'Company cost',
};

/** The figures the differences are of (owner: "the differences in the social insurance and taxes"), and the net and cost with them. */
export const VS_INSURANCE_DIFFERENCE_KEYS = ['employeeInsurance', 'employerInsurance', 'monthlyTax', 'martyrsFund', 'net', 'companyCost'] as const satisfies readonly VsInsuranceFigureKey[];
export type VsInsuranceDifferenceKey = (typeof VS_INSURANCE_DIFFERENCE_KEYS)[number];
export type VsInsuranceDifference = Record<VsInsuranceDifferenceKey, number>;

/** Which way the differences go, said in every column header: the SI cycle less the actual run. */
export const VS_INSURANCE_DIFFERENCE_SIGN = 'SI cycle − actual';

/** A cycle in full: the figures, and what the pay earned was cut and added to, for the "in full" sheets. */
export interface VsInsuranceCycle extends VsInsuranceFigures {
  paidDays: number;
  attendanceCut: number;
  kpiCut: number;
  noShowCut: number;
  unpaidLeaveCut: number;
  bonus: number;
  penaltyCut: number;
  additionsTaxed: number;
  additionsUntaxed: number;
  adjustmentDeductions: number;
  beforeTaxDeductions: number;
  released: number;
  transfer: number;
  /** The engine's notes on this cycle (a part month, a cut capped …). */
  warnings: string[];
}

// ---------- who has a cycle ----------

/** Where someone stands with social insurance on the run: who has a B cycle, and why not. */
export const VS_INSURANCE_STANDINGS = ['registered', 'counted_as_insured', 'not_registered', 'outside_law'] as const;
export type VsInsuranceStanding = (typeof VS_INSURANCE_STANDINGS)[number];

export const VS_INSURANCE_STANDING_LABELS: Record<VsInsuranceStanding, string> = {
  registered: 'Registered',
  counted_as_insured: 'Counted as insured (not registered)',
  not_registered: 'Not registered',
  outside_law: 'Outside the labour law',
};

/** Why a person has no SI cycle, in words; null for someone registered. */
export const VS_INSURANCE_STANDING_NOTES: Record<VsInsuranceStanding, string | null> = {
  registered: null,
  counted_as_insured:
    'Not registered with social insurance: no SI cycle. The actual run deducts the shares on the computed insured wage, as Social insurance for everyone was on.',
  not_registered: 'Not registered with social insurance: no SI cycle, and the actual run deducts no insurance.',
  outside_law: 'Outside the labour law (a freelancer or an unpaid intern): no social insurance, no tax, no SI cycle.',
};

/**
 * Where a line's person stands: registered when the run insured them as registered (socialInsured on the profile when
 * the run was made or refreshed, so no notRegistered mark); counted as insured when the run insured them only because the
 * rules insure everyone (26 October 2026); not registered otherwise; outside the labour law for a freelancer or an
 * unpaid intern, whatever the rest says.
 */
export function vsInsuranceStanding(terms: Pick<PayrollTerms, 'statutory' | 'insured' | 'notRegistered'>): VsInsuranceStanding {
  if (!terms.statutory) return 'outside_law';
  if (!terms.insured) return 'not_registered';
  return terms.notRegistered === true ? 'counted_as_insured' : 'registered';
}

// ---------- the B cycle ----------

/**
 * The terms the SI cycle is worked out with: the line's own, the gross replaced by the registered insured wage (the
 * Social Insurance tab's, as the run took it), no allowances, the same basic percent and days paid; a month split between
 * contracts keeps its parts, each on the registered wage for its days. Pay by the hour has no monthly gross to swap, so
 * its SI cycle is the registered wage as a monthly salary for the days paid (the hours paid aren't an attendance measure:
 * vsInsuranceInputs leaves the worked hours out). The adjustments kept are the days-based ones (a Bonus (days), a
 * Penalty (days)) and every deduction, taken after tax or before it exactly as the actual run took them, so the net
 * difference is the wage's alone; the amount-based additions (a commission, a Correction, an untaxed addition) are not
 * pay of the registered wage and are left out. Client accounts held without an allowance are no longer a warning.
 */
export function vsInsuranceTerms(terms: PayrollTerms): PayrollTerms {
  const wage = terms.insuredWage;
  const segment = (s: PayrollSegment): PayrollSegment => ({ ...s, payBasis: 'monthly', gross: wage, hourlyRate: null, allowances: [] });
  const rest: PayrollTerms = { ...terms };
  delete rest.notRegistered;
  delete rest.adjustments;
  delete rest.accountsWithoutAllowance;
  const adjustments = (terms.adjustments ?? []).filter((a) => isDaysType(a.type) || a.kind === 'deduction');
  return {
    ...rest,
    payBasis: 'monthly',
    gross: wage,
    hourlyRate: null,
    allowances: [],
    ...(terms.segments && { segments: terms.segments.map(segment) }),
    insured: true,
    insuredWage: wage,
    ...(adjustments.length && { adjustments }),
  };
}

/**
 * The inputs the SI cycle is worked out with: the line's own (attendance, no-show, leave, permission, the CEO's waiver,
 * what was released), without the grid's commission and settlements of a line saved before 17 October 2026 (amount-based
 * additions; its bonus and penalty days stay). By the hour, without the worked hours: they are the hours paid, not an
 * attendance measure of a monthly salary.
 */
export function vsInsuranceInputs(inputs: SavedPayrollInputs, payBasis: PayBasis): SavedPayrollInputs {
  const rest: SavedPayrollInputs = { ...EMPTY_PAYROLL_INPUTS, ...inputs };
  delete rest.commission;
  delete rest.settlements;
  return payBasis === 'hourly' ? { ...rest, workedHours: null, expectedHours: null } : rest;
}

/** The SI cycle of a line: the same engine, the run's rules and rates set by law, on the registered insured wage. */
export function vsInsuranceCycle(line: Pick<VsInsuranceSourceLine, 'terms' | 'inputs' | 'payBasis'>, rules: PayrollRules, law: LawRates = lawRatesFor(line.terms.year)): PayrollResult {
  return payrollLine(vsInsuranceTerms(line.terms), vsInsuranceInputs(line.inputs, line.payBasis), rules, law);
}

// ---------- what the report reads ----------

/** A payroll line as the report reads it: who it is, what it was worked out from and what it came to. */
export interface VsInsuranceSourceLine {
  id: string;
  employeeId: string;
  employeeCode: string;
  nameEn: string;
  /** A team as "Department › Team", as the line keeps it. */
  department: string | null;
  jobTitle: string | null;
  employmentType: EmploymentType;
  payBasis: PayBasis;
  onHold: boolean;
  terms: PayrollTerms;
  inputs: SavedPayrollInputs;
  result: PayrollResult;
}

/** A run as the report reads it, with its own copied rules and rates set by law. */
export interface VsInsuranceSourceRun {
  id: string;
  month: string;
  status: PayrollStatus;
  rules: PayrollRules;
  law: LawRates;
  lines: readonly VsInsuranceSourceLine[];
}

// ---------- the report ----------

/** A run on the report, and the rules its month is worked out with, for the page and the workbook to word. */
export interface VsInsuranceRun {
  id: string;
  month: string;
  status: PayrollStatus;
  /** Social insurance for everyone, as the run's rules have it (insuresEveryone). */
  insureEveryone: boolean;
  law: Pick<LawRates, 'year' | 'employeeInsuranceRate' | 'employerInsuranceRate' | 'insurableWageMin' | 'insurableWageMax'>;
  /** The lines shown to the caller. */
  lines: number;
}

/** One employee of one month: the three blocks. */
export interface VsInsuranceRow {
  lineId: string;
  runId: string;
  month: string;
  status: PayrollStatus;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  department: string | null;
  jobTitle: string | null;
  employmentType: EmploymentType;
  payBasis: PayBasis;
  onHold: boolean;
  standing: VsInsuranceStanding;
  /** A: the actual run, as stored. */
  actual: VsInsuranceCycle;
  /** B: the SI cycle; null for someone without one (the standing says why). */
  insurance: VsInsuranceCycle | null;
  /** B − A; null with no B. */
  difference: VsInsuranceDifference | null;
}

/** The sums of some rows. */
export interface VsInsuranceTotals {
  rows: number;
  /** The people (someone on two months counts once). */
  people: number;
  registered: number;
  /** Not registered, those counted as insured among them. */
  notRegistered: number;
  countedAsInsured: number;
  outsideLaw: number;
  /** A over every row. */
  actual: VsInsuranceFigures;
  /** A over the registered rows alone: what the SI cycle's sum compares with. */
  actualRegistered: VsInsuranceFigures;
  /** B over the registered rows. */
  insurance: VsInsuranceFigures;
  /** B − A over the registered rows (the per-row differences summed). */
  difference: VsInsuranceDifference;
}

/** GET /payroll/vs-insurance, less the moment it was made and the C-level people left out. */
export interface PayrollVsInsurance {
  period: ReportPeriod;
  /** How the period was chosen when none was asked: the latest run's month, or this month when there is no run yet. */
  defaulted: 'latest_run' | 'this_month' | null;
  runs: VsInsuranceRun[];
  rows: VsInsuranceRow[];
  totals: VsInsuranceTotals;
}

const cents = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100);
/** A sum to the piaster, added in piasters so it never drifts (+ 0 turns a −0 into 0). */
const sumMoney = (values: readonly number[]) => values.reduce((s, v) => s + cents(v), 0) / 100 + 0;
const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A result as a cycle in full: `gross` is what the cycle was paid on (A: the contract's; B: the registered wage). */
export function vsInsuranceCycleOf(result: PayrollResult, terms: Pick<PayrollTerms, 'paidDays'>, gross: number): VsInsuranceCycle {
  return {
    gross: n(gross),
    earned: n(result.earned),
    allowances: n(result.allowances),
    insuredWage: n(result.insuredWage),
    employeeInsurance: n(result.employeeInsurance),
    employerInsurance: n(result.employerInsurance),
    monthlyTaxable: n(result.monthlyTaxable),
    monthlyTax: n(result.monthlyTax),
    martyrsFund: n(result.martyrsFund),
    deductions: n(result.deductions),
    net: n(result.net),
    companyCost: n(result.companyCost),
    paidDays: n(terms.paidDays),
    attendanceCut: n(result.attendanceCut),
    kpiCut: n(result.kpiCut),
    noShowCut: n(result.noShowCut),
    unpaidLeaveCut: n(result.unpaidLeaveCut),
    bonus: n(result.bonus),
    penaltyCut: n(result.penaltyCut),
    additionsTaxed: n(result.additionsTaxed),
    additionsUntaxed: n(result.additionsUntaxed),
    adjustmentDeductions: n(result.adjustmentDeductions),
    beforeTaxDeductions: n(result.beforeTaxDeductions),
    released: n(result.released),
    transfer: n(result.transfer),
    warnings: [...(result.warnings ?? [])],
  };
}

/** B − A, figure by figure, to the piaster. */
export function vsInsuranceDifference(actual: VsInsuranceFigures, insurance: VsInsuranceFigures): VsInsuranceDifference {
  return Object.fromEntries(VS_INSURANCE_DIFFERENCE_KEYS.map((k) => [k, (cents(insurance[k]) - cents(actual[k])) / 100 + 0])) as VsInsuranceDifference;
}

const emptyFigures = (): VsInsuranceFigures => Object.fromEntries(VS_INSURANCE_FIGURE_KEYS.map((k) => [k, 0])) as VsInsuranceFigures;
const emptyDifference = (): VsInsuranceDifference => Object.fromEntries(VS_INSURANCE_DIFFERENCE_KEYS.map((k) => [k, 0])) as VsInsuranceDifference;

const sumFigures = (list: readonly VsInsuranceFigures[]): VsInsuranceFigures =>
  Object.fromEntries(VS_INSURANCE_FIGURE_KEYS.map((k) => [k, sumMoney(list.map((f) => f[k]))])) as VsInsuranceFigures;

/** The sums of these rows (a group's subtotal, or the grand total). */
export function vsInsuranceTotals(rows: readonly VsInsuranceRow[]): VsInsuranceTotals {
  const registered = rows.filter((r): r is VsInsuranceRow & { insurance: VsInsuranceCycle; difference: VsInsuranceDifference } => r.insurance !== null && r.difference !== null);
  const differences = registered.map((r) => r.difference);
  return {
    rows: rows.length,
    people: new Set(rows.map((r) => r.employee.id)).size,
    registered: rows.filter((r) => r.standing === 'registered').length,
    notRegistered: rows.filter((r) => r.standing === 'not_registered' || r.standing === 'counted_as_insured').length,
    countedAsInsured: rows.filter((r) => r.standing === 'counted_as_insured').length,
    outsideLaw: rows.filter((r) => r.standing === 'outside_law').length,
    actual: rows.length ? sumFigures(rows.map((r) => r.actual)) : emptyFigures(),
    actualRegistered: registered.length ? sumFigures(registered.map((r) => r.actual)) : emptyFigures(),
    insurance: registered.length ? sumFigures(registered.map((r) => r.insurance)) : emptyFigures(),
    difference: differences.length
      ? (Object.fromEntries(VS_INSURANCE_DIFFERENCE_KEYS.map((k) => [k, sumMoney(differences.map((d) => d[k]))])) as VsInsuranceDifference)
      : emptyDifference(),
  };
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/** One line's row: A as stored, B worked out for someone registered, and the differences. */
export function vsInsuranceRow(run: Pick<VsInsuranceSourceRun, 'id' | 'month' | 'status' | 'rules' | 'law'>, line: VsInsuranceSourceLine): VsInsuranceRow {
  const standing = vsInsuranceStanding(line.terms);
  const actual = vsInsuranceCycleOf(line.result, line.terms, line.terms.gross);
  const insurance = standing === 'registered' ? vsInsuranceCycleOf(vsInsuranceCycle(line, run.rules, run.law), line.terms, line.terms.insuredWage) : null;
  return {
    lineId: line.id,
    runId: run.id,
    month: run.month,
    status: run.status,
    employee: { id: line.employeeId, employeeCode: line.employeeCode, fullNameEn: line.nameEn },
    department: line.department,
    jobTitle: line.jobTitle,
    employmentType: line.employmentType,
    payBasis: line.payBasis,
    onHold: line.onHold,
    standing,
    actual,
    insurance,
    difference: insurance ? vsInsuranceDifference(actual, insurance) : null,
  };
}

/**
 * The report for these runs (the period's, oldest first): a row per line, by department (none last), name, then month,
 * each run with the rules its month is worked out with, and the grand total.
 */
export function payrollVsInsurance(runs: readonly VsInsuranceSourceRun[]): Pick<PayrollVsInsurance, 'runs' | 'rows' | 'totals'> {
  const ordered = [...runs].sort((a, b) => a.month.localeCompare(b.month));
  const rows = ordered.flatMap((run) => run.lines.map((line) => vsInsuranceRow(run, line)));
  rows.sort((a, b) => byDepartment(a.department, b.department) || byName(a.employee.fullNameEn, b.employee.fullNameEn) || a.employee.employeeCode.localeCompare(b.employee.employeeCode) || a.month.localeCompare(b.month));
  return {
    runs: ordered.map((run) => ({
      id: run.id,
      month: run.month,
      status: run.status,
      insureEveryone: run.rules.insureEveryone === true,
      law: {
        year: run.law.year,
        employeeInsuranceRate: run.law.employeeInsuranceRate,
        employerInsuranceRate: run.law.employerInsuranceRate,
        insurableWageMin: run.law.insurableWageMin,
        insurableWageMax: run.law.insurableWageMax,
      },
      lines: run.lines.length,
    })),
    rows,
    totals: vsInsuranceTotals(rows),
  };
}

// ---------- the groups ----------

const SEPARATOR = ' › ';

/** "Marketing › Content" → its department and team; a department alone has no team; none for no department. */
export function vsInsurancePlace(department: string | null): { department: string | null; team: string | null } {
  const text = department?.trim();
  if (!text) return { department: null, team: null };
  const at = text.indexOf(SEPARATOR);
  return at < 0 ? { department: text, team: null } : { department: text.slice(0, at), team: text.slice(at + SEPARATOR.length) };
}

/** Departments in alphabetical order, no department last, as the run orders its lines. */
const byDepartment = (a: string | null, b: string | null) => (a === null ? 1 : 0) - (b === null ? 1 : 0) || byName(a ?? '', b ?? '');

/** A team's rows, or the department's own (team null). */
export interface VsInsuranceTeam {
  team: string | null;
  rows: VsInsuranceRow[];
  totals: VsInsuranceTotals;
}

/** A department's rows: its own first, then each team's; department null for those without one. */
export interface VsInsuranceDepartment {
  department: string | null;
  teams: VsInsuranceTeam[];
  totals: VsInsuranceTotals;
}

/**
 * The rows by department, then team, as the Leave report groups: departments by name, those without one last; in each,
 * the department's own people first, then its teams by name; with each group's totals. The rows keep their order.
 */
export function vsInsuranceGroups(rows: readonly VsInsuranceRow[]): VsInsuranceDepartment[] {
  const departments = new Map<string | null, Map<string | null, VsInsuranceRow[]>>();
  for (const r of rows) {
    const place = vsInsurancePlace(r.department);
    const teams = departments.get(place.department) ?? new Map<string | null, VsInsuranceRow[]>();
    departments.set(place.department, teams);
    teams.set(place.team, [...(teams.get(place.team) ?? []), r]);
  }
  return [...departments.entries()]
    .sort(([a], [b]) => byDepartment(a, b))
    .map(([department, teams]) => {
      const sorted = [...teams.entries()]
        .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : byName(a, b)))
        .map(([team, list]) => ({ team, rows: list, totals: vsInsuranceTotals(list) }));
      return { department, teams: sorted, totals: vsInsuranceTotals(sorted.flatMap((t) => t.rows)) };
    });
}

// ---------- in words ----------

/** A run's status as the report marks it: a draft, and a run with the CEO, may still change. */
export function vsInsuranceStatusText(status: PayrollStatus): string {
  const label = PAYROLL_STATUS_LABELS[status] ?? status;
  if (status === 'draft') return `${label}: may change`;
  if (status === 'pending_ceo') return `${label}: may still change`;
  return label;
}

const percent = (rate: number) => `${Math.round(rate * 10000) / 100}%`;
const amount = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The rules a run's month is worked out with, in words: "Social insurance 11% employee and 18.75% company on the insured
 * wage, within EGP 2,700.00 to 16,700.00; tax by the 2026 rates set by law; Social insurance for everyone: on."
 */
export function vsInsuranceRulesText(run: Pick<VsInsuranceRun, 'insureEveryone' | 'law'>): string {
  const l = run.law;
  return `Social insurance ${percent(l.employeeInsuranceRate)} employee and ${percent(l.employerInsuranceRate)} company on the insured wage, within EGP ${amount(l.insurableWageMin)} to ${amount(l.insurableWageMax)}; tax by the ${l.year} rates set by law; Social insurance for everyone: ${run.insureEveryone ? 'on' : 'off'}.`;
}

/**
 * The counts under the table: "12 people on the payroll: 9 registered, 2 not registered (1 counted as insured), 1 outside
 * the labour law. The differences are summed over the registered people."
 */
export function vsInsuranceCountsText(t: Pick<VsInsuranceTotals, 'people' | 'registered' | 'notRegistered' | 'countedAsInsured' | 'outsideLaw'>): string {
  const people = `${t.people} ${t.people === 1 ? 'person' : 'people'}`;
  const counted = t.countedAsInsured > 0 ? ` (${t.countedAsInsured} counted as insured)` : '';
  return `${people} on the payroll: ${t.registered} registered, ${t.notRegistered} not registered${counted}, ${t.outsideLaw} outside the labour law. The differences are summed over the registered people.`;
}
