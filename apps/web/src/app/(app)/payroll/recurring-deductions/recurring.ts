import {
  deductionBaseOf,
  deductionLimit,
  deductionLimitWarning,
  LAW_DEDUCTION_PERCENT,
  monthPlus,
  recurringDeductionProblems,
  recurringDue,
  sumAmounts,
  type Role,
} from '@trendlix/shared';
import { formatDate } from '../../../../lib/format';
import { hasRole } from '../../../../lib/roles';
import type { AdvanceLimitView, RecurringDeductionStatus, RecurringDeductionView } from '../../../../lib/types';
import { formatEgp, parseAmount } from '../../employees/[id]/contracts/salary';
import { placeOfClaim } from '../../reimbursements/list';
import { isMonth, monthName, monthOf } from '../list';

// Recurring Deductions (owner, 18 October 2026: "in the deductions i might have a loan of a medical subscription or
// something that needs to be deducted as installments on the employee. how will it be managed?"; asked, the owner chose
// a medical subscription as an ongoing monthly share): a fixed amount taken from an employee's pay every month, from its
// first month to its last, or until HR stops it; each month's payroll run takes it as a deduction after tax, named on
// the payslip as it is here ("Medical subscription (family)"). HR adds one, changes its amount from a month (it stops
// there and a new one starts with the new amount), stops it from a month, or changes its name and last month; leaving,
// it stops from the month after the last working day by itself. The Labour Law (owner, 18 October 2026, after reading
// the law: "Warn above 25%, record the consent"; Law 14/2025 Art. 114): a deduction the employee agrees to needs their
// written consent, so HR ticks that the signed consent is on file to add one (kept with who and when) and may attach it,
// kept in the employee file; one added before has "Consent not recorded" until HR records it; a higher amount needs it
// again. And such deductions may take at most 25% of the pay after income tax, social insurance and the installments
// of advances and loans: the forms warn, never block, as they are typed. Plain helpers for the page (no server-only,
// so they are unit tested): who sees it, each one in words, the months the forms offer, what they come to and what
// they send. Relative imports: the tests run without the "@/" alias. Salary data: HR, Finance and the CEO; HR changes
// them; the API checks every request.
// Deducted before tax (owner, 20 October 2026, asked whether the employee's medical share is taken before or after tax:
// "Before Tax i think"): a tick on the add, change and edit forms, off by default, "Deducted before tax (lowers taxable
// pay)", its hint that the tax law limits it (ask the accountant; Payroll Setup's limit, once set, is kept to); the list
// says "Before tax", and What It Comes To that the share lowers the taxable pay.

type WithRoles = { roles: readonly Role[] };

/** Who sees the page: HR, Finance and the CEO, as the payroll lines. */
export const canSeeRecurring = (user: WithRoles) => hasRole(user, 'hr', 'finance', 'ceo');

/** HR adds, changes and stops them. */
export const changesRecurring = (user: WithRoles) => hasRole(user, 'hr');

/** Who opens the signed consent: HR and the CEO, who see the employee file it is kept in. */
export const opensConsent = (user: WithRoles) => hasRole(user, 'hr', 'ceo');

/** The most a name may be: the API's. */
export const NAME_MAX = 100;

/** The tick (owner, 20 October 2026: "Before Tax i think"), and its hint: the tax law limits the deduction. */
export const BEFORE_TAX_TICK = 'Deducted before tax (lowers taxable pay)';
export const BEFORE_TAX_HINT =
  'The tax law limits this deduction: ask your accountant for the limit. Once a Super Admin sets it in Payroll Setup (rates set by law), the payroll keeps to it.';

/** "Before tax" on the list for one ticked so; null for one after tax, as they are by default. */
export const beforeTaxText = (r: Pick<RecurringDeductionView, 'beforeTax'>): string | null => (r.beforeTax === true ? 'Before tax' : null);

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

/**
 * The employee's written consent in words (Labour Law Art. 114; owner, 18 October 2026: "record the consent"):
 * "Consent on file (recorded by Nour Ali on 18/10/2026)", or "Consent not recorded"; null from an API from before it.
 */
export function consentText(r: Pick<RecurringDeductionView, 'consent'>): string | null {
  if (r.consent === undefined) return null;
  if (r.consent === null) return 'Consent not recorded';
  const who = r.consent.recordedBy?.name;
  return `Consent on file (recorded ${who ? `by ${who} ` : ''}on ${formatDate(r.consent.recordedAt)})`;
}

/** Where the signed consent opens: the employee file's paper (HR and the CEO). */
export const consentHref = (paper: { id: string }) => `/paperwork/${encodeURIComponent(paper.id)}`;

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

// ---------- what it comes to, and the law's 25% ----------

/** How many months from `start` to `end`, both counted: October 2026 to July 2027 is 10. */
export const monthsCounted = (start: string, end: string) =>
  (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1;

/** The figures read for the employee (/payroll/advances/limit) a preview works with. */
export type LimitFigures = Pick<AdvanceLimitView, 'gross' | 'byMonth'> & Partial<Pick<AdvanceLimitView, 'tax' | 'insurance' | 'recurring'>>;

/** The figures as typed: what it comes to, and the law's 25% (Art. 114). */
export interface RecurringPreview {
  /** "10 months, October 2026 to July 2027: EGP 15,000.00 a month, EGP 150,000.00 in all." */
  period: string;
  /**
   * What the law counts the 25% from, in its first month, plainly, and its share of it with the employee's other
   * recurring deductions; null until the employee's pay is read.
   */
  share: string | null;
  /** The months their recurring deductions pass 25% of it, the earliest first: warnings only, it can still be saved. */
  warnings: string[];
  /**
   * Ticked deducted before tax (owner, 20 October 2026: "Before Tax i think"): that the share lowers the taxable pay, so
   * less income tax is taken. Missing when it isn't ticked.
   */
  beforeTax?: string;
}

/** The most months the 25% is looked at in: five years. */
const LOOKED_AT = 60;

/**
 * The months its deductions are looked at in: its first to its last; until stopped, a year, or to the employee's last
 * installment when later (the pay left grows once they end), five years at most.
 */
function lookedAt(start: string, last: string | null, byMonth: Record<string, number>): string[] {
  const latest = Object.keys(byMonth).sort().at(-1);
  const end = last ?? [monthPlus(start, 11), latest ?? start].reduce((a, b) => (a > b ? a : b));
  const out: string[] = [];
  for (let m = start; m <= end && out.length < LOOKED_AT; m = monthPlus(m, 1)) out.push(m);
  return out;
}

const percentOf = (part: number, of: number) => Math.round((part / of) * 1000) / 10;

/**
 * The figures the add and change forms show as they are typed (owner, 18 October 2026, on the form: "view assumed
 * numbers"): how many months and what it comes to in all (a year's worth while it runs until stopped); and the law's
 * 25% (owner, 18 October 2026, after reading the law: "Warn above 25%"; Labour Law Art. 114): the employee's current
 * gross (their signed contract's, `limit` from /payroll/advances/limit) less about its income tax and social insurance
 * and the month's installments of advances and loans, of which a month's recurring deductions, this one and their
 * others (`replacing`: the one a change of amount stops from its month, left out), may take 25%: what it is in its
 * first month, and a warning for each month past it. Ticked deducted before tax (`beforeTax`, 20 October 2026), that it
 * lowers the taxable pay. Null until an amount and a first month can be read, or when the rules refuse them (the form
 * says why when sent).
 */
export function recurringPreview(
  amountInput: string,
  start: string,
  end: string,
  limit: LimitFigures | null | undefined,
  options: { replacing?: string; beforeTax?: boolean } = {},
): RecurringPreview | null {
  const amount = parseAmount(amountInput);
  if (amount === null || Number.isNaN(amount) || !isMonth(start)) return null;
  const last = isMonth(end) ? end : null;
  if (recurringDeductionProblems(amount, start, last).length) return null;
  const months = last ? monthsCounted(start, last) : null;
  const period =
    months !== null && last
      ? `${months} ${months === 1 ? 'month' : 'months'}, ${monthName(start)}${months > 1 ? ` to ${monthName(last)}` : ''}: ${formatEgp(amount)} a month, ${formatEgp(sumAmounts(Array(months).fill(amount)))} in all.`
      : `From ${monthName(start)} until stopped: ${formatEgp(amount)} a month, ${formatEgp(sumAmounts(Array(12).fill(amount)))} a year.`;
  // before tax (20 October 2026): the share lowers the taxable pay, within the tax law's limit on it
  const beforeTax = options.beforeTax
    ? { beforeTax: `Deducted before tax: the share lowers the taxable pay by ${formatEgp(amount)} a month, so less income tax is taken (within the limit the tax law sets on it).` }
    : {};
  if (limit === undefined) return { period, share: null, warnings: [], ...beforeTax };
  if (!limit || limit.gross === null || limit.gross <= 0) {
    return { period, share: 'No current contract, so its share of the pay can’t be shown.', warnings: [], ...beforeTax };
  }
  const gross = limit.gross;
  const tax = limit.tax ?? 0;
  const insurance = limit.insurance ?? 0;
  const others = (limit.recurring ?? []).filter((r) => r.id !== options.replacing);
  const baseIn = (month: string) => ({ pay: gross, tax, insurance, installments: limit.byMonth[month] ?? 0 });
  const totalIn = (month: string) => sumAmounts([amount, ...others.filter((r) => recurringDue(r, month)).map((r) => r.amount)]);

  const first = baseIn(start);
  const left = deductionBaseOf(first);
  const counted = `The law counts it against the pay after income tax, social insurance and the installments of advances and loans (Labour Law Art. 114): in ${monthName(start)}, the gross of ${formatEgp(gross)} less about ${formatEgp(tax)} tax, ${formatEgp(insurance)} insurance and ${formatEgp(first.installments)} installments leaves ${formatEgp(left)}, of which recurring deductions may take ${LAW_DEDUCTION_PERCENT}%, ${formatEgp(deductionLimit(first))}.`;
  const total = totalIn(start);
  const mine = total > amount ? `With their other recurring deductions, ${formatEgp(total)} a month, it is ${left > 0 ? `${percentOf(total, left)}%` : 'all'} of it.` : `It is ${left > 0 ? `${percentOf(amount, left)}%` : 'all'} of it.`;
  const warnings = lookedAt(start, last, limit.byMonth).flatMap((m) => {
    const w = deductionLimitWarning(totalIn(m), baseIn(m), m);
    return w ? [w] : [];
  });
  return { period, share: `${counted} ${mine}`, warnings, ...beforeTax };
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

/** Why it can't be added without the tick (Labour Law Art. 114). */
export const CONSENT_ERROR = "Tick that the employee's signed consent is on file: a deduction from the pay they agree to needs their written consent (Labour Law Art. 114).";
/** Why a higher amount can't be saved without the tick. */
export const MORE_CONSENT_ERROR = "Tick that the employee's signed consent to the new amount is on file: a deduction they agree to needs their written consent (Labour Law Art. 114).";

/** The most the signed consent may be: the employee file's. */
export const CONSENT_FILE_MAX_MB = 10;

/** The signed consent chosen (a photo or a PDF, which the API checks), or null when none is; too large is said. */
export function consentFileOf(fd: FormData, errors: string[]): File | null {
  const file = fd.get('consentFile');
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > CONSENT_FILE_MAX_MB * 1024 * 1024) errors.push(`The signed consent must be ${CONSENT_FILE_MAX_MB} MB or smaller.`);
  return file;
}

/** The tick "The employee's signed consent is on file". */
const ticked = (fd: FormData) => text(fd, 'consentOnFile') === 'yes';

/** The tick "Deducted before tax (lowers taxable pay)" (20 October 2026). */
const beforeTaxTicked = (fd: FormData) => text(fd, 'beforeTax') === 'yes';

/**
 * A new one: the employee, what for, the amount a month, the first month and the last (empty: until stopped), whether
 * it is deducted before tax (20 October 2026), and the tick that the employee's signed consent is on file, needed; the
 * signed consent itself if chosen.
 */
export function recurringBody(fd: FormData): {
  body: { employeeId: string; name: string; amount: number; startMonth: string; endMonth: string | null; beforeTax: boolean; consentOnFile: true };
  file: File | null;
  errors: string[];
} {
  const errors: string[] = [];
  const employeeId = text(fd, 'employeeId');
  if (!employeeId) errors.push('Choose the employee.');
  const name = nameOf(fd, errors);
  const amount = amountOf(fd);
  const startMonth = text(fd, 'startMonth');
  const endMonth = text(fd, 'endMonth') || null;
  errors.push(...recurringDeductionProblems(amount, startMonth, endMonth));
  if (!ticked(fd)) errors.push(CONSENT_ERROR);
  const file = consentFileOf(fd, errors);
  return { body: { employeeId, name, amount, startMonth, endMonth, beforeTax: beforeTaxTicked(fd), consentOnFile: true }, file, errors };
}

/** What a new one is sent as: a form, with the signed consent when chosen. */
export function recurringForm(body: ReturnType<typeof recurringBody>['body'], file: File | null): FormData {
  const form = new FormData();
  form.append('employeeId', body.employeeId);
  form.append('name', body.name);
  form.append('amount', body.amount.toFixed(2));
  form.append('startMonth', body.startMonth);
  form.append('endMonth', body.endMonth ?? '');
  form.append('beforeTax', body.beforeTax ? 'true' : 'false');
  form.append('consentOnFile', 'true');
  if (file) form.append('consentFile', file, file.name);
  return form;
}

/**
 * A change of amount: the new amount a month and the month it starts (this one stops there, a new one starts), whether
 * the new one is deducted before tax (the tick, as this one is to start with: 20 October 2026); for a higher amount,
 * the tick that the employee's signed consent to it is on file (`saved`: the amount it has).
 */
export function changeRecurringBody(
  fd: FormData,
  saved?: number,
): { body: { amount: number; fromMonth: string; beforeTax: boolean; consentOnFile?: true }; errors: string[] } {
  const errors: string[] = [];
  const amount = amountOf(fd);
  // the rules' own wording for the amount
  errors.push(...recurringDeductionProblems(amount, '2000-01', null));
  const fromMonth = text(fd, 'fromMonth');
  if (!isMonth(fromMonth)) errors.push('Choose the month the new amount starts.');
  if (saved !== undefined && raisesAmount(amount, saved) && !ticked(fd)) errors.push(MORE_CONSENT_ERROR);
  const beforeTax = beforeTaxTicked(fd);
  return { body: ticked(fd) ? { amount, fromMonth, beforeTax, consentOnFile: true } : { amount, fromMonth, beforeTax }, errors };
}

/** Whether a new amount is more than it has: the employee's consent to it is needed again. */
export const raisesAmount = (amount: number, saved: number) => Number.isFinite(amount) && Math.round(amount * 100) > Math.round(saved * 100);

/**
 * Recording the consent of one added before it was asked (the tick, needed), or attaching the signed consent to one
 * whose consent is recorded (`recorded`: the file, needed then).
 */
export function consentBody(fd: FormData): { file: File | null; errors: string[] } {
  const errors: string[] = [];
  const recorded = text(fd, 'recorded') === 'yes';
  if (!recorded && !ticked(fd)) errors.push(CONSENT_ERROR);
  const file = consentFileOf(fd, errors);
  if (recorded && !file) errors.push('Choose the signed consent: a photo or a PDF.');
  return { file, errors };
}

/** What a consent is sent as: a form, with the signed consent when chosen. */
export function consentForm(file: File | null): FormData {
  const form = new FormData();
  if (file) form.append('consentFile', file, file.name);
  return form;
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

/** A change of name, last month (empty: until stopped) or whether it is deducted before tax (20 October 2026). */
export function editRecurringBody(fd: FormData): { body: { name: string; endMonth: string | null; beforeTax: boolean }; errors: string[] } {
  const errors: string[] = [];
  const name = nameOf(fd, errors);
  const endMonth = text(fd, 'endMonth') || null;
  if (endMonth !== null && !isMonth(endMonth)) errors.push('Choose the last month it is deducted, or leave it empty to deduct it until stopped.');
  return { body: { name, endMonth, beforeTax: beforeTaxTicked(fd) }, errors };
}
