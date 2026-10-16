import {
  lawRatesFor,
  normalLawRates,
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
}

export interface PayrollRunSummary {
  id: string;
  month: string;
  status: PayrollStatus;
  totals: PayrollTotals;
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

export function lineView(line: LineRow, bank: LineBank): PayrollLineView {
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
    terms: line.terms as unknown as PayrollTerms,
    inputs: line.inputs as unknown as PayrollInputs,
    result: line.result as unknown as PayrollResult,
    bank,
    payslips: { en: line.payslips.some((p) => p.language === 'en'), ar: line.payslips.some((p) => p.language === 'ar') },
  };
}

/** Whether the bank details were copied: from the CEO's approval on. */
export const isApproved = (status: string) => status === 'approved' || status === 'paid';

export function runView(run: RunRow, ctx: { banks: ReadonlyMap<string, BankDetails>; approvedByName: string | null }): PayrollRunView {
  const approved = isApproved(run.status);
  const lines = run.lines.map((l) => lineView(l, lineBank(bankDetailsOf(l, ctx.banks.get(l.employeeId), approved))));
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
    exclusions: run.exclusions as unknown as Exclusion[],
    bankCheck: bankCheck(lines.map((l) => ({ onHold: l.onHold, transfer: l.result.transfer, bank: l.bank }))),
    payslips: lines.filter((l) => l.payslips.en).length,
  };
}
