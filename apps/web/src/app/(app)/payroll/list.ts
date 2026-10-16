import { PAYROLL_STATUS_LABELS, PAYROLL_STATUSES, type PayrollRules, type PayrollStatus, type Role } from '@trendlix/shared';
import { hasRole, isSuperAdmin } from '../../../lib/roles';

// Plain helpers for the Payroll pages (no server-only, so they are unit tested): who sees payroll and who does what on a
// run, the months a run can be made for and their names, and where a run stands. Relative imports: the tests run
// without the "@/" alias.
//
// The owner's decisions of 16 October 2026: HR prepares a month's run, the CEO (the CEO only) approves it, which locks
// it, and HR marks it paid. Salary data: HR, Finance and the CEO see it. Hiding a button is a convenience: the API
// checks every request.

type WithRoles = { roles: readonly Role[] };

/** Who sees payroll (the sidebar shows them the link). Not an Admin as such: salaries are restricted. */
export const PAYROLL_ROLES: readonly Role[] = ['hr', 'finance', 'ceo'];

export function canSeePayroll(user: WithRoles): boolean {
  return hasRole(user, ...PAYROLL_ROLES);
}

/** HR makes runs, types the month's figures, sends a run to the CEO and marks it paid. */
export function preparesPayroll(user: WithRoles): boolean {
  return hasRole(user, 'hr');
}

/** Only the CEO approves a run, or returns it to HR (owner's decision, 16 October 2026). */
export function approvesPayroll(user: WithRoles): boolean {
  return hasRole(user, 'ceo');
}

/** A run's page. */
export const runHref = (id: string) => `/payroll/${id}`;

// ---------- months ----------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Whether this is a payroll month as the API takes it: "2026-09". */
export const isMonth = (value: string) => MONTH.test(value);

/** "2026-09" → "September 2026"; anything else as it is. */
export function monthName(month: string): string {
  const m = MONTH.exec(month);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : month;
}

/** A run's title: "September 2026 Payroll". */
export const runTitle = (month: string) => `${monthName(month)} Payroll`;

/** The month a date (YYYY-MM-DD) is in: "2026-10-16" → "2026-10". */
export const monthOf = (date: string) => date.slice(0, 7);

/** A month this many months later (or earlier, when negative): ("2026-01", -2) → "2025-11". */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** How far back a run can be made, in months, and how far ahead: the API's range, from 12 months back to next month. */
export const MONTHS_BACK = 12;
export const MONTHS_AHEAD = 1;

/** The months a run can be made for, on `today` (YYYY-MM-DD, Cairo), newest first: next month back to 12 months ago. */
export function runMonths(today: string): string[] {
  const now = monthOf(today);
  const out: string[] = [];
  for (let n = MONTHS_AHEAD; n >= -MONTHS_BACK; n--) out.push(addMonths(now, n));
  return out;
}

/**
 * The month offered first for a new run: last month, as salaries are paid once the month is over (the owner's March
 * file was made on 6 April), else this month, else the newest month without a run; null when every month has one.
 */
export function suggestedMonth(choices: readonly string[], taken: readonly string[], today: string): string | null {
  const free = (m: string) => choices.includes(m) && !taken.includes(m);
  const now = monthOf(today);
  return [addMonths(now, -1), now].find(free) ?? choices.find(free) ?? null;
}

// ---------- where a run stands ----------

export const STATUS_BADGE: Record<PayrollStatus, string> = {
  draft: 'bg-line-soft text-muted',
  pending_ceo: 'bg-warn-soft text-warn',
  approved: '', // the badge's own accent colours
  paid: 'bg-ok-soft text-ok',
};

export const statusLabel = (status: PayrollStatus) => PAYROLL_STATUS_LABELS[status] ?? status;

export interface Step {
  status: PayrollStatus;
  label: string;
  state: 'done' | 'current' | 'upcoming';
}

/** The stepper: Draft → With the CEO → Approved → Paid, those before the run's status done. A paid run is done throughout. */
export function payrollSteps(status: PayrollStatus): Step[] {
  const at = PAYROLL_STATUSES.indexOf(status);
  return PAYROLL_STATUSES.map((s, i) => ({
    status: s,
    label: PAYROLL_STATUS_LABELS[s],
    state: i < at || (status === 'paid' && i === at) ? 'done' : i === at ? 'current' : 'upcoming',
  }));
}

/** What a user may do on a run, by their roles and its status. The register can always be downloaded. */
export interface RunActions {
  /** HR, on a draft: type the month's figures, refresh it, send it to the CEO. */
  editInputs: boolean;
  refresh: boolean;
  submit: boolean;
  /** The CEO, on a run with the CEO. */
  approve: boolean;
  returnToHr: boolean;
  /** HR, once approved. */
  markPaid: boolean;
  /** A Super Admin, on a draft only (the only role that deletes: owner's decision, 15 October 2026). */
  delete: boolean;
  /** The bank files, once approved (the bank details are as the CEO approved them). */
  bankFiles: boolean;
}

export function runActions(user: WithRoles, status: PayrollStatus): RunActions {
  const hr = preparesPayroll(user);
  const ceo = approvesPayroll(user);
  const draft = status === 'draft';
  return {
    editInputs: hr && draft,
    refresh: hr && draft,
    submit: hr && draft,
    approve: ceo && status === 'pending_ceo',
    returnToHr: ceo && status === 'pending_ceo',
    markPaid: hr && status === 'approved',
    delete: isSuperAdmin(user) && draft,
    bankFiles: status === 'approved' || status === 'paid',
  };
}

/** The rules a run was worked out with, in words, one per rule. */
export function rulesSummary(r: PayrollRules): string[] {
  return [
    `A month counts as ${r.dayDivisor} days, for day rates and part months.`,
    `Attendance counts in full from ${r.attendanceGracePercent}%; below it, the fixed part follows it.`,
    `The KPI average counts in full from ${r.kpiGracePercent}%; below it, the variable part follows it.`,
    `Overtime is paid for attendance above ${r.overtimeAbovePercent}%, at ${r.overtimeRate}×.`,
    `A no-show day costs ${r.noShowDayMultiplier} ${r.noShowDayMultiplier === 1 ? "day's" : "days'"} pay.`,
  ];
}

/** "1 employee", "12 employees". */
export const employeesLabel = (n: number) => `${n} ${n === 1 ? 'employee' : 'employees'}`;
