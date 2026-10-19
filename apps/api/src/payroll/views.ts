import {
  damageLimitWarning,
  hiddenLinesLabel,
  deductionLimitWarning,
  EMPTY_PAYROLL_INPUTS,
  installmentLimitWarning,
  lawRatesFor,
  RECURRING_TYPE,
  sumAmounts,
  normalLawRates,
  paidAdjustments,
  type AttendanceImportMark,
  type EmploymentType,
  type LawRates,
  type PayBasis,
  type PayrollInputs,
  type PayrollResult,
  type PayrollRules,
  type PayrollStatus,
  type PayrollTerms,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { lineInstallments } from './adjustments/plans.js';
import { bankCheck, cleanBankDetails, lineBank, type BankDetails, type LineBank } from './bank.js';
import type { Exclusion } from './roster.js';

// A payroll run as the API sends it (owner's decisions, 16 October 2026): dates as YYYY-MM-DD, the month as YYYY-MM,
// money as numbers to the piaster. Salary data: HR, Finance and the CEO only. The bank details themselves are never
// sent, only which file pays each line and what stops it being paid.

/** A run's sums over its lines (on hold included): what the payroll costs and pays. */
export interface PayrollTotals {
  employees: number;
  earned: number;
  allowances: number;
  employeeInsurance: number;
  employerInsurance: number;
  monthlyTax: number;
  martyrsFund: number;
  deductions: number;
  net: number;
  released: number;
  transfer: number;
  companyCost: number;
}

export const TOTAL_KEYS = [
  'earned',
  'allowances',
  'employeeInsurance',
  'employerInsurance',
  'monthlyTax',
  'martyrsFund',
  'deductions',
  'net',
  'released',
  'transfer',
  'companyCost',
] as const satisfies readonly (keyof PayrollTotals & keyof PayrollResult)[];

export interface PayrollLineView {
  id: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string | null;
  jobTitle: string | null;
  employmentType: EmploymentType;
  payBasis: PayBasis;
  onHold: boolean;
  comments: string | null;
  terms: PayrollTerms;
  inputs: PayrollInputs;
  result: PayrollResult;
  bank: LineBank;
  /** Which of the line's payslips are drawn and kept (owner's decisions, 16 October 2026). */
  payslips: { en: boolean; ar: boolean };
  /** A C-level person's (owner, 19 October 2026: "make C level Employees details not visible to HR"): the CEO fills it. */
  confidential: boolean;
  /** Whether the caller changes its inputs, hold and comments now: a draft's, HR's, a C-level person's the CEO's. */
  editable: boolean;
  /**
   * The inputs an attendance import filled (owner, 19 October 2026: Zoho People), still as it filled them, for the grid
   * to mark "from Zoho"; null when none.
   */
  attendanceImport: AttendanceImportMark | null;
}

export interface PayrollRunView {
  id: string;
  month: string;
  status: PayrollStatus;
  rules: PayrollRules;
  /** The rates set by law it is worked out with: its year's, copied when it was made or last refreshed. */
  lawRates: LawRates;
  createdAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: { id: string; name: string } | null;
  returnedReason: string | null;
  paidOn: string | null;
  totals: PayrollTotals;
  lines: PayrollLineView[];
  exclusions: Exclusion[];
  bankCheck: { cib: number; ach: number; problems: number };
  /** How many English payslips are kept: one for each line paid, once the run is marked paid. */
  payslips: number;
  /**
   * The month's pending additions and deductions for people not on the run (owner, 17 October 2026): no line takes
   * them, so HR puts the person on the run or moves them to a later month. By person.
   */
  adjustmentsNotOnRun: { employeeId: string; employeeCode: string; name: string; count: number }[];
  /**
   * The C-level people's lines left out for the caller (owner, 19 October 2026: "make C level Employees details not
   * visible to HR"): one row, "C-level (N people) — hidden", with no figures; the totals, the bank check and the files are
   * without them. Null when nothing is hidden from the caller (the CEO and a Super Admin see the whole run).
   */
  hidden: { count: number; label: string } | null;
}

export interface PayrollRunSummary {
  id: string;
  month: string;
  status: PayrollStatus;
  /** Without the C-level people's lines hidden from the caller (`hidden` of them). */
  totals: PayrollTotals;
  hidden: number;
  createdAt: Date;
  approvedAt: Date | null;
  paidOn: string | null;
}

/** What a run is shown with: its lines in order (by department, none last, then by name) and who approved it. */
export const RUN_INCLUDE = {
  approvedBy: { select: { id: true, email: true } },
  lines: { orderBy: [{ department: { sort: 'asc', nulls: 'last' } }, { nameEn: 'asc' }], include: { payslips: { select: { language: true } } } },
} satisfies Prisma.PayrollRunInclude;

export type RunRow = Prisma.PayrollRunGetPayload<{ include: typeof RUN_INCLUDE }>;
export type LineRow = RunRow['lines'][number];

/** The month a run is for, YYYY-MM. */
export const monthOf = (run: { month: Date }) => fromDateOnly(run.month).slice(0, 7);

/**
 * The rates set by law a run is worked out with (owner's request, 16 October 2026): its copy, taken when it was made or
 * last refreshed, so an approved or paid run never changes. A run made before 17 October 2026 has none: it was worked
 * out with the built-in rates of its year, the same as the rows the law rates migration added.
 */
export function runLawRates(run: { month: Date; lawRates: Prisma.JsonValue | null }): LawRates {
  return run.lawRates ? normalLawRates(run.lawRates as unknown as LawRates) : lawRatesFor(Number(monthOf(run).slice(0, 4)));
}

/** Sums to the piaster. */
export function totalsOf(results: readonly Pick<PayrollResult, (typeof TOTAL_KEYS)[number]>[]): PayrollTotals {
  const totals = { employees: results.length } as PayrollTotals;
  for (const key of TOTAL_KEYS) totals[key] = results.reduce((cents, r) => cents + Math.round(r[key] * 100), 0) / 100;
  return totals;
}

/** The bank details a line is paid to: the copy taken at the approval once approved, else the employee's as they are. */
export function bankDetailsOf(line: LineRow, live: BankDetails | undefined, approved: boolean): BankDetails {
  if (approved) return cleanBankDetails({ bank: line.bankShort, accountNo: line.accountNo, iban: line.iban, holderName: line.holderName });
  return live ? cleanBankDetails(live) : { bank: null, accountNo: null, iban: null, holderName: null };
}

/**
 * What a line's warnings by the Labour Law are worked out with (Law No. 14 of 2025; owner, 18 October 2026, after
 * reading the law: "Block above 10%", "Warn above 25%, record the consent"): Payroll Setup's limit on installments (at
 * most the law's 10%) and the run's days in a month (5 days' wage of damage). Warnings, never blocks: the plans and the
 * entries are refused past the 10% when made, but the month's pay can be less than the wage they were planned on.
 */
export interface LineLimits {
  installmentPercent: number | null;
  dayDivisor: number | null;
}

/** The month's pay a line's limits are of: the pay earned and the allowances, as the run worked them out. */
const payOf = (result: PayrollResult) => Math.round((result.earned + result.allowances) * 100) / 100;

/**
 * Art. 113: when the line's installments of advances and loans (not its other deductions, nor its recurring ones) pass
 * `percent` of the month's pay (the pay earned and the allowances); null when they don't, or no percent is given.
 */
export function installmentWarning(line: { terms: PayrollTerms; result: PayrollResult }, percent: number | null): string | null {
  if (percent === null) return null;
  const installments = lineInstallments(paidAdjustments(line));
  if (!(installments > 0)) return null;
  return installmentLimitWarning(installments, payOf(line.result), percent);
}

/**
 * Art. 114 ("Warn above 25%"): when the line's recurring deductions pass 25% of the month's pay less its income tax,
 * its social insurance and its installments of advances and loans; null when they don't.
 */
export function recurringWarning(line: { terms: PayrollTerms; result: PayrollResult }): string | null {
  const items = paidAdjustments(line);
  const recurring = sumAmounts(items.filter((a) => a.kind === 'deduction' && a.type === RECURRING_TYPE).map((a) => a.amount));
  if (!(recurring > 0)) return null;
  return deductionLimitWarning(recurring, {
    pay: payOf(line.result),
    tax: line.result.monthlyTax ?? 0,
    insurance: line.result.employeeInsurance ?? 0,
    installments: lineInstallments(items),
  });
}

/** Art. 151: when the line's damage or loss deductions pass 5 days of its monthly gross (÷ the run's days in a month); null when they don't. */
export function damageWarning(line: { terms: PayrollTerms; result: PayrollResult }, dayDivisor: number | null): string | null {
  if (!dayDivisor) return null;
  const damage = sumAmounts(paidAdjustments(line).filter((a) => a.kind === 'deduction' && a.type === 'damage_loss').map((a) => a.amount));
  if (!(damage > 0)) return null;
  return damageLimitWarning(damage, line.terms.gross, dayDivisor);
}

/** The line's warnings by the Labour Law, in the order of its articles. */
export function lawWarnings(line: { terms: PayrollTerms; result: PayrollResult }, limits: LineLimits | null): string[] {
  if (!limits) return [];
  return [installmentWarning(line, limits.installmentPercent), recurringWarning(line), damageWarning(line, limits.dayDivisor)].filter((w): w is string => w !== null);
}

/** Whose a line is and who changes it: a C-level person's, and whether the caller changes it now (`editable`). */
export interface LineAccess {
  confidential: boolean;
  editable: boolean;
}

/**
 * A line as the API sends it; `limits`: what its warnings by the Labour Law are worked out with (18 October 2026);
 * `access`: a C-level person's, and whether the caller changes it (19 October 2026).
 */
export function lineView(line: LineRow, bank: LineBank, limits: LineLimits | null = null, access: LineAccess = { confidential: false, editable: false }): PayrollLineView {
  const terms = line.terms as unknown as PayrollTerms;
  const result = line.result as unknown as PayrollResult;
  const warnings = lawWarnings({ terms, result }, limits);
  return {
    id: line.id,
    employeeId: line.employeeId,
    employeeCode: line.employeeCode,
    name: line.nameEn,
    department: line.department,
    jobTitle: line.jobTitle,
    employmentType: line.employmentType,
    payBasis: line.payBasis as PayBasis,
    onHold: line.onHold,
    comments: line.comments,
    terms,
    // inputs saved before one existed (the leave days, 17 October 2026) read as not given
    inputs: { ...EMPTY_PAYROLL_INPUTS, ...(line.inputs as object) } as PayrollInputs,
    // with its warnings by the Labour Law, as the line's other warnings
    result: warnings.length ? { ...result, warnings: [...result.warnings, ...warnings] } : result,
    bank,
    payslips: { en: line.payslips.some((p) => p.language === 'en'), ar: line.payslips.some((p) => p.language === 'ar') },
    confidential: access.confidential,
    editable: access.editable,
    attendanceImport: (line.attendanceImport as unknown as AttendanceImportMark | null) ?? null,
  };
}

/** Whether the bank details were copied: from the CEO's approval on. */
export const isApproved = (status: string) => status === 'approved' || status === 'paid';

export function runView(
  run: RunRow,
  ctx: {
    banks: ReadonlyMap<string, BankDetails>;
    approvedByName: string | null;
    adjustmentsNotOnRun: PayrollRunView['adjustmentsNotOnRun'];
    /** Payroll Setup's limit on a month's installments (18 October 2026): its lines warn past it. */
    installmentLimitPercent?: number | null;
    /**
     * The C-level people (owner, 19 October 2026): `all` of them, those `hidden` from the caller (their lines left out,
     * as one row), and whether the caller changes a line, a C-level person's or not (packages/shared changesPayrollLine).
     */
    confidential?: { all: ReadonlySet<string>; hidden: ReadonlySet<string>; changes: (confidentialLine: boolean) => boolean };
  },
): PayrollRunView {
  const approved = isApproved(run.status);
  const draft = run.status === 'draft';
  const c = ctx.confidential;
  const shown = c ? run.lines.filter((l) => !c.hidden.has(l.employeeId)) : run.lines;
  const hidden = run.lines.length - shown.length;
  // the run's own days in a month, as it was worked out with
  const limits: LineLimits = { installmentPercent: ctx.installmentLimitPercent ?? null, dayDivisor: (run.rules as unknown as PayrollRules | null)?.dayDivisor ?? null };
  const lines = shown.map((l) => {
    const confidential = c?.all.has(l.employeeId) ?? false;
    return lineView(l, lineBank(bankDetailsOf(l, ctx.banks.get(l.employeeId), approved)), limits, { confidential, editable: draft && (c?.changes(confidential) ?? false) });
  });
  return {
    id: run.id,
    month: monthOf(run),
    status: run.status as PayrollStatus,
    rules: run.rules as unknown as PayrollRules,
    lawRates: runLawRates(run),
    createdAt: run.createdAt,
    submittedAt: run.submittedAt,
    approvedAt: run.approvedAt,
    approvedBy: run.approvedBy && { id: run.approvedBy.id, name: ctx.approvedByName ?? run.approvedBy.email },
    returnedReason: run.returnedReason,
    paidOn: fromDateOnly(run.paidOn),
    totals: totalsOf(lines.map((l) => l.result)),
    lines,
    // those left out of the run, but a C-level person hidden from the caller
    exclusions: (run.exclusions as unknown as Exclusion[]).filter((x) => !c?.hidden.has(x.employeeId)),
    bankCheck: bankCheck(lines.map((l) => ({ onHold: l.onHold, transfer: l.result.transfer, bank: l.bank }))),
    payslips: lines.filter((l) => l.payslips.en).length,
    adjustmentsNotOnRun: ctx.adjustmentsNotOnRun.filter((a) => !c?.hidden.has(a.employeeId)),
    hidden: hidden ? { count: hidden, label: hiddenLinesLabel(hidden) } : null,
  };
}
