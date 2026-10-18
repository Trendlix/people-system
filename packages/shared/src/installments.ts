// Installments and recurring deductions (owner, 18 October 2026: "in the deductions i might have a loan of a medical
// subscription or something that needs to be deducted as installments on the employee. how will it be managed?").
// Decided with the owner the same day:
// - An advance or a loan is recovered by installments the system makes at once: HR gives the total, how many months
//   and the first month; each month's installment is a deduction linked to it (payroll-adjustments.ts), equal amounts,
//   the last taking the rounding. HR may move one to a later month (it and every later one move a month on) or change
//   one's amount (the later ones share what is left).
// - A medical subscription is an ongoing monthly share: a recurring deduction of a fixed amount from a start month, to
//   an end month or until HR stops it, added to each month's payroll.
// - Leaving before it is paid back: what is left is taken from the final settlement, unless HR waives it.
// - A warning (never a block) when a month's installments pass a share of the pay set in Payroll Setup, e.g. 10%.
// Months are YYYY-MM. Amounts in EGP, two decimals, worked out in piastres.

// ---------- months ----------

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Whether `month` is a month as YYYY-MM. */
export const isMonth = (month: string) => MONTH.test(month);

/** The month `n` months after `month` (before it when `n` is negative). */
export function monthPlus(month: string, n: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

// ---------- installments ----------

/** One month's installment. */
export interface Installment {
  month: string;
  amount: number;
}

/** The most months a plan may have: five years. */
export const INSTALLMENTS_MAX = 60;

/** Why a plan can't be made as typed (none: it can): the total, how many months, the first month. */
export function installmentPlanProblems(total: number, count: number, first: string): string[] {
  const problems: string[] = [];
  if (!isMoney(total) || total <= 0) problems.push('Enter the total to recover, more than 0, e.g. 6000 or 6000.50.');
  if (!Number.isInteger(count) || count < 1 || count > INSTALLMENTS_MAX) problems.push(`Enter how many monthly installments, 1 to ${INSTALLMENTS_MAX}.`);
  if (!isMonth(first)) problems.push('Choose the month of the first installment.');
  if (problems.length === 0 && cents(total) < count) problems.push('The total is too small to split into that many installments.');
  return problems;
}

/**
 * `total` in `count` monthly installments from `first`: equal amounts in whole piastres, the last taking what the
 * rounding leaves (10,000 in 3: 3,333.33, 3,333.33, 3,333.34). The plan's problems must be none.
 */
export function installmentPlan(total: number, count: number, first: string): Installment[] {
  return spread(cents(total), count).map((c, i) => ({ month: monthPlus(first, i), amount: money(c) }));
}

/** The amount of each installment, in words: "6 installments of EGP 1,000.00", or "3 installments: EGP 3,333.33 … 3,333.34". */
export function installmentPlanText(plan: readonly Installment[]): string {
  if (plan.length === 0) return 'No installments';
  const egp = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const first = plan[0].amount;
  const last = plan[plan.length - 1].amount;
  const word = plan.length === 1 ? 'installment' : 'installments';
  if (plan.every((p) => cents(p.amount) === cents(first))) return `${plan.length} ${word} of EGP ${egp(first)}`;
  return `${plan.length} ${word}: EGP ${egp(first)} … ${egp(last)}`;
}

/**
 * The installments still to come after HR moves the one of `month` to a later month: it and every later one move a
 * month on, amounts as they were (e.g. none taken in December). `pending` in month order.
 */
export function postponeInstallment(pending: readonly Installment[], month: string): Installment[] {
  return pending.map((p) => (p.month >= month ? { ...p, month: monthPlus(p.month, 1) } : { ...p }));
}

/**
 * The installments still to come after HR changes the one of `month` to `amount`: the earlier ones stay, the later ones
 * share equally what is left of their total (the last taking the rounding); when the changed one takes it all, the later
 * ones go; when a last one is lowered, the difference becomes one more installment the month after. The total of
 * `pending` (in month order) never changes. A problem when `amount` isn't more than 0 or is more than what is left from
 * that month on.
 */
export function changeInstallment(pending: readonly Installment[], month: string, amount: number): { plan: Installment[] } | { problem: string } {
  const at = pending.findIndex((p) => p.month === month);
  if (at < 0) return { problem: 'That installment is no longer waiting to be deducted.' };
  if (!isMoney(amount) || amount <= 0) return { problem: 'Enter the installment, more than 0, e.g. 1000 or 1000.50.' };
  const fromHere = pending.slice(at).reduce((s, p) => s + cents(p.amount), 0);
  if (cents(amount) > fromHere) return { problem: `The installment can be at most EGP ${money(fromHere).toFixed(2)}, what is left from that month on.` };

  const before = pending.slice(0, at).map((p) => ({ ...p }));
  const changed = { month, amount: money(cents(amount)) };
  const left = fromHere - cents(amount);
  const later = pending.slice(at + 1);
  if (left === 0) return { plan: [...before, changed] };
  if (later.length === 0) return { plan: [...before, changed, { month: monthPlus(month, 1), amount: money(left) }] };
  const shares = spread(left, Math.min(later.length, left));
  return { plan: [...before, changed, ...shares.map((c, i) => ({ month: later[i].month, amount: money(c) }))] };
}

// ---------- recurring deductions ----------

/** A recurring deduction, e.g. the employee's share of a medical subscription: a fixed amount a month. */
export interface RecurringDeduction {
  amount: number;
  /** The first month it is deducted. */
  startMonth: string;
  /** The last month it is deducted; null: until stopped. */
  endMonth: string | null;
  /** The first month it is no longer deducted, once HR stopped it; null while it runs. */
  stoppedFrom: string | null;
}

/** Why a recurring deduction can't be saved as typed (none: it can). */
export function recurringDeductionProblems(amount: number, startMonth: string, endMonth: string | null): string[] {
  const problems: string[] = [];
  if (!isMoney(amount) || amount <= 0) problems.push('Enter the amount a month, more than 0, e.g. 350 or 350.50.');
  if (!isMonth(startMonth)) problems.push('Choose the first month it is deducted.');
  if (endMonth !== null && !isMonth(endMonth)) problems.push('Choose the last month it is deducted, or leave it empty to deduct it until stopped.');
  else if (endMonth !== null && isMonth(startMonth) && endMonth < startMonth) problems.push("The last month can't be before the first.");
  return problems;
}

/** Whether a recurring deduction is taken in `month`: from its start, to its end, and not after it was stopped. */
export function recurringDue(r: Pick<RecurringDeduction, 'startMonth' | 'endMonth' | 'stoppedFrom'>, month: string): boolean {
  if (month < r.startMonth) return false;
  if (r.endMonth !== null && month > r.endMonth) return false;
  return r.stoppedFrom === null || month < r.stoppedFrom;
}

// ---------- the share of pay warning ----------

/** The most a month's installments may take before the warning: `percent` of `pay`; null without a percent set. */
export function installmentLimit(pay: number, percent: number | null): number | null {
  if (percent === null || !(percent > 0)) return null;
  return money(Math.floor((cents(pay) * percent) / 100));
}

/**
 * The warning when a month's installments (advances' recoveries and loans' installments) take more than `percent` of
 * `pay` (the month's gross, as the run has it): never a block, HR may go ahead. Null when they don't, or no percent is set.
 */
export function installmentLimitWarning(installments: number, pay: number, percent: number | null): string | null {
  const limit = installmentLimit(pay, percent);
  if (limit === null || cents(installments) <= cents(limit)) return null;
  const egp = (n: number) => `EGP ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `This month's installments, ${egp(installments)}, are more than ${percent}% of the pay (${egp(limit)}), the share set in Payroll Setup.`;
}

// ---------- helpers ----------

/** `total` piastres in `count` equal parts, whole piastres, the last taking the rest. */
function spread(total: number, count: number): number[] {
  const each = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? total - each * (count - 1) : each));
}

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100 + 0;
const isMoney = (n: number) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
