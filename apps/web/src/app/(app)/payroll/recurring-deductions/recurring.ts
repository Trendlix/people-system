import { monthPlus, recurringDeductionProblems, sumAmounts, type Role } from '@trendlix/shared';
import { hasRole } from '../../../../lib/roles';
import type { RecurringDeductionStatus, RecurringDeductionView } from '../../../../lib/types';
import { formatEgp, parseAmount } from '../../employees/[id]/contracts/salary';
import { placeOfClaim } from '../../reimbursements/list';
import { isMonth, monthName, monthOf } from '../list';

// Recurring Deductions (owner, 18 October 2026: "in the deductions i might have a loan of a medical subscription or
// something that needs to be deducted as installments on the employee. how will it be managed?"; asked, the owner chose
// a medical subscription as an ongoing monthly share): a fixed amount taken from an employee's pay every month, from its
// first month to its last, or until HR stops it; each month's payroll run takes it as a deduction after tax, named on
// the payslip as it is here ("Medical subscription (family)"). HR adds one, changes its amount from a month (it stops
// there and a new one starts with the new amount), stops it from a month, or changes its name and last month; leaving,
// it stops from the month after the last working day by itself. Plain helpers for the page (no server-only, so they are
// unit tested): who sees it, each one in words, the months the forms offer and what they send. Relative imports: the
// tests run without the "@/" alias. Salary data: HR, Finance and the CEO; HR changes them; the API checks every request.

type WithRoles = { roles: readonly Role[] };

/** Who sees the page: HR, Finance and the CEO, as the payroll lines. */
export const canSeeRecurring = (user: WithRoles) => hasRole(user, 'hr', 'finance', 'ceo');

/** HR adds, changes and stops them. */
export const changesRecurring = (user: WithRoles) => hasRole(user, 'hr');

/** The most a name may be: the API's. */
export const NAME_MAX = 100;

// ---------- each one in words ----------

export const RECURRING_STATUS_LABELS: Record<RecurringDeductionStatus, string> = { upcoming: 'Upcoming', running: 'Running', ended: 'Ended' };

export const RECURRING_BADGE: Record<RecurringDeductionStatus, string> = {
  upcoming: 'bg-accent-soft text-accent',
  running: 'bg-ok-soft text-ok',
  ended: 'bg-line-soft text-muted',
};

/** Where the employee works, as the list groups them (lib/place-groups.ts): "Department › Team", the department, or null. */
export const placeOfRecurring = (r: Pick<RecurringDeductionView, 'employee'>) => placeOfClaim(r.employee);

/** The last month it is (or was) deducted: the month before it was stopped, else its last month; null: until stopped. */
export function lastMonth(r: Pick<RecurringDeductionView, 'endMonth' | 'stoppedFrom'>): string | null {
  const stoppedLast = r.stoppedFrom ? monthPlus(r.stoppedFrom, -1) : null;
  if (stoppedLast && r.endMonth) return stoppedLast < r.endMonth ? stoppedLast : r.endMonth;
  return stoppedLast ?? r.endMonth;
}

/**
 * Its months in words: "From November 2026, until stopped", "November 2026 to October 2027", "November 2026 to
 * February 2027, then stopped", or "Stopped before it began" when it was stopped from its first month.
 */
export function periodText(r: Pick<RecurringDeductionView, 'startMonth' | 'endMonth' | 'stoppedFrom'>): string {
  const start = monthName(r.startMonth);
  if (r.stoppedFrom && r.stoppedFrom <= r.startMonth) return `Stopped before it began (${start})`;
  const last = lastMonth(r);
  if (!last) return `From ${start}, until stopped`;
  const stopped = r.stoppedFrom !== null && (r.endMonth === null || r.stoppedFrom <= r.endMonth);
  const range = last === r.startMonth ? start : `${start} to ${monthName(last)}`;
  return stopped ? `${range}, then stopped` : range;
}

/** What was deducted so far, the cancelled left out: "3 months, EGP 1,050.00", "None yet"; and how many wait for their run. */
export function deductedText(r: Pick<RecurringDeductionView, 'deducted'>): { applied: string; pending: string | null } {
  const applied = r.deducted.filter((d) => d.status === 'applied');
  const pending = r.deducted.filter((d) => d.status === 'pending').length;
  return {
    applied: applied.length ? `${applied.length} ${applied.length === 1 ? 'month' : 'months'}, ${formatEgp(sumAmounts(applied.map((d) => d.amount)))}` : 'None yet',
    pending: pending ? `${pending} waiting for ${pending === 1 ? 'its run' : 'their runs'}` : null,
  };
}

/** The ones running or still to start, and those ended (shown apart, folded). */
export function splitByStatus<T extends Pick<RecurringDeductionView, 'status'>>(rows: readonly T[]): { current: T[]; ended: T[] } {
  return { current: rows.filter((r) => r.status !== 'ended'), ended: rows.filter((r) => r.status === 'ended') };
}

/** The sum a month of those running: what the next payroll takes for them. */
export const monthlyTotal = (rows: readonly Pick<RecurringDeductionView, 'amount' | 'status'>[]) => sumAmounts(rows.filter((r) => r.status === 'running').map((r) => r.amount));

/** "4 employees", "1 employee": how many people the rows are for. */
export const peopleOf = (rows: readonly Pick<RecurringDeductionView, 'employee'>[]) => new Set(rows.map((r) => r.employee.id)).size;

// ---------- the months the forms offer ----------

type MonthChoice = { value: string; label: string };

const monthsBetween = (from: string, to: string): MonthChoice[] => {
  const out: MonthChoice[] = [];
  for (let m = from; m <= to; m = monthPlus(m, 1)) out.push({ value: m, label: monthName(m) });
  return out;
};

const later = (a: string, b: string) => (a > b ? a : b);

/** How far ahead the forms offer months: three years, for a yearly subscription renewed. */
export const MONTHS_AHEAD = 36;

/** The first month a new one can start: last month (its run may not be made yet) to a year ahead. */
export const startChoices = (today: string): MonthChoice[] => monthsBetween(monthPlus(monthOf(today), -1), monthPlus(monthOf(today), 12));

/** Its last month, when it has one: from last month to three years ahead; empty (until stopped) is offered by the form. */
export const endChoices = (today: string): MonthChoice[] => monthsBetween(monthPlus(monthOf(today), -1), monthPlus(monthOf(today), MONTHS_AHEAD));

/**
 * The first month a change of amount or a stop can be from: not before its first month, nor a month already deducted,
 * nor before last month (whose run may still be made); the first of them to start with. Up to its last month, or three
 * years on.
 */
export function fromChoices(r: Pick<RecurringDeductionView, 'startMonth' | 'endMonth' | 'deducted'>, today: string): MonthChoice[] {
  const applied = r.deducted.filter((d) => d.status === 'applied').map((d) => d.month);
  const afterApplied = applied.length ? monthPlus(applied.reduce(later), 1) : r.startMonth;
  const first = [r.startMonth, afterApplied, monthPlus(monthOf(today), -1)].reduce(later);
  const last = r.endMonth ?? monthPlus(first, MONTHS_AHEAD);
  return first <= last ? monthsBetween(first, last) : [];
}

/** A changed last month's choices: those of a new one's, with its own last month too if it is outside them. */
export function editEndChoices(r: Pick<RecurringDeductionView, 'endMonth'>, today: string): MonthChoice[] {
  const months = endChoices(today);
  if (r.endMonth && !months.some((m) => m.value === r.endMonth)) months.unshift({ value: r.endMonth, label: monthName(r.endMonth) });
  return months;
}

// ---------- what the forms send ----------

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

function nameOf(fd: FormData, errors: string[]): string {
  const name = text(fd, 'name');
  if (!name) errors.push('Say what it is for, e.g. Medical subscription (family).');
  else if (name.length > NAME_MAX) errors.push(`Keep the name to ${NAME_MAX} characters or fewer.`);
  return name;
}

/** An amount a month as typed, NaN when it can't be read (the rules say why). */
const amountOf = (fd: FormData) => parseAmount(text(fd, 'amount')) ?? NaN;

/** A new one: the employee, what for, the amount a month, the first month and the last (empty: until stopped). */
export function recurringBody(fd: FormData): { body: { employeeId: string; name: string; amount: number; startMonth: string; endMonth: string | null }; errors: string[] } {
  const errors: string[] = [];
  const employeeId = text(fd, 'employeeId');
  if (!employeeId) errors.push('Choose the employee.');
  const name = nameOf(fd, errors);
  const amount = amountOf(fd);
  const startMonth = text(fd, 'startMonth');
  const endMonth = text(fd, 'endMonth') || null;
  errors.push(...recurringDeductionProblems(amount, startMonth, endMonth));
  return { body: { employeeId, name, amount, startMonth, endMonth }, errors };
}

/** A change of amount: the new amount a month and the month it starts (this one stops there, a new one starts). */
export function changeRecurringBody(fd: FormData): { body: { amount: number; fromMonth: string }; errors: string[] } {
  const errors: string[] = [];
  const amount = amountOf(fd);
  // the rules' own wording for the amount
  errors.push(...recurringDeductionProblems(amount, '2000-01', null));
  const fromMonth = text(fd, 'fromMonth');
  if (!isMonth(fromMonth)) errors.push('Choose the month the new amount starts.');
  return { body: { amount, fromMonth }, errors };
}

/** A stop: the first month no longer deducted, and why (optional). */
export function stopRecurringBody(fd: FormData): { body: { fromMonth: string; note?: string }; errors: string[] } {
  const errors: string[] = [];
  const fromMonth = text(fd, 'fromMonth');
  if (!isMonth(fromMonth)) errors.push('Choose the first month it is no longer deducted.');
  const note = text(fd, 'note');
  if (note.length > 500) errors.push('Keep the note to 500 characters or fewer.');
  return { body: note ? { fromMonth, note } : { fromMonth }, errors };
}

/** A change of name or last month (empty: until stopped). */
export function editRecurringBody(fd: FormData): { body: { name: string; endMonth: string | null }; errors: string[] } {
  const errors: string[] = [];
  const name = nameOf(fd, errors);
  const endMonth = text(fd, 'endMonth') || null;
  if (endMonth !== null && !isMonth(endMonth)) errors.push('Choose the last month it is deducted, or leave it empty to deduct it until stopped.');
  return { body: { name, endMonth }, errors };
}
