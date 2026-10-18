import {
  ADJUSTMENT_STATUS_LABELS,
  ADVANCE_SETTLED_HOW_LABELS,
  changeInstallment,
  installmentLimit,
  installmentLimitWarning,
  installmentPlan,
  installmentPlanProblems,
  installmentPlanText,
  monthPlus,
  type AdvanceSettleWay,
  type Installment,
} from '@trendlix/shared';
import type { AdvanceInstallment, AdvanceLimitView } from '../../../../lib/types';
import { formatEgp, parseAmount } from '../../employees/[id]/contracts/salary';
import { monthName, monthOf } from '../list';
import type { AdvanceRow } from '../adjustments/adjustments';

// Installments (owner, 18 October 2026: "in the deductions i might have a loan of a medical subscription or something
// that needs to be deducted as installments on the employee. how will it be managed?"). Decided with the owner the same
// day: recording an advance or a loan with its total, how many months and the first month makes every monthly
// installment at once, equal amounts, the last taking the rounding (installmentPlan, @trendlix/shared); HR may move one
// to the next month (it and every later one move a month on) or change one's amount (the later ones share what is
// left), while it is pending and its month's run isn't approved; a warning, never a block, when a month's installments
// pass the share of the pay set in Payroll Setup. Leaving before it is paid back: "taken from the final settlement,
// unless waived". Plain helpers for Unsettled (no server-only, so they are unit tested): the record form's live plan
// and warning, each installment's state, the settle form and the change form. The rules are the shared ones, which the
// API applies again. Relative imports: the tests run without the "@/" alias.

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();
const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

// ---------- the record form ----------

/** Where the record form reads the share-of-pay warning's figures for an employee (./installments-limit/route.ts). */
export const limitHref = (employeeId: string) => `/payroll/unsettled/installments-limit?employeeId=${encodeURIComponent(employeeId)}`;

/** How many installments as typed: a whole number ("6", "٦"), else NaN; empty: null. */
export function parseCount(input: string): number | null {
  const s = latin(input).trim();
  if (s === '') return null;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

/**
 * The months the first installment can be in, oldest first: last month (its run may not be made yet: salaries are paid
 * once the month is over) to a year ahead.
 */
export function firstMonthChoices(today: string): { value: string; label: string }[] {
  const now = monthOf(today);
  return Array.from({ length: 14 }, (_, i) => monthPlus(now, i - 1)).map((value) => ({ value, label: monthName(value) }));
}

/** "November 2026 to April 2027", or the one month. */
export function monthsText(plan: readonly Pick<Installment, 'month'>[]): string {
  if (!plan.length) return '';
  const first = plan[0].month;
  const last = plan[plan.length - 1].month;
  return first === last ? monthName(first) : `${monthName(first)} to ${monthName(last)}`;
}

/** The record form's plan, worked out as it is typed: null until the amount and how many are typed. */
export type PlanPreview = { ok: true; plan: Installment[]; text: string; months: string } | { ok: false; problems: string[] };

export function planPreview(amountInput: string, countInput: string, first: string): PlanPreview | null {
  const amount = parseAmount(amountInput);
  const count = parseCount(countInput);
  if (amount === null || count === null) return null;
  const problems = installmentPlanProblems(Number.isNaN(amount) ? NaN : amount, Number.isNaN(count) ? NaN : count, first);
  if (problems.length) return { ok: false, problems };
  const plan = installmentPlan(amount, count, first);
  return { ok: true, plan, text: installmentPlanText(plan), months: monthsText(plan) };
}

/**
 * The share-of-pay warnings for a plan (owner, 18 October 2026: a warning, never a block): each month whose
 * installments, those already planned or applied for the employee and the plan's, pass the percent set in Payroll
 * Setup of their current gross. None without a gross (no current contract), a percent, or the figures.
 */
export function planWarnings(plan: readonly Installment[], limit: AdvanceLimitView | null): { month: string; text: string }[] {
  if (!limit || limit.gross === null || limit.percent === null) return [];
  const { gross, percent, byMonth } = limit;
  return plan.flatMap((p) => {
    const month = Math.round(((byMonth[p.month] ?? 0) + p.amount) * 100) / 100;
    const warning = installmentLimitWarning(month, gross, percent);
    return warning ? [{ month: p.month, text: `${monthName(p.month)}: ${warning}` }] : [];
  });
}

/** What the warning is worked out with, as the form says it under the plan; null without it. */
export function limitText(limit: AdvanceLimitView | null): string | null {
  if (!limit || limit.percent === null) return null;
  if (limit.gross === null) return 'No current contract, so the share of the pay can’t be checked.';
  const most = installmentLimit(limit.gross, limit.percent);
  return `The current gross is ${formatEgp(limit.gross)} a month: Payroll Setup warns when a month’s installments pass ${limit.percent}% of it (${formatEgp(most ?? 0)}).`;
}

// ---------- each installment ----------

/** An advance's installments, as the API sends them; none from an API from before them. */
export const installmentsOf = (a: Pick<AdvanceRow, 'installments'>): AdvanceInstallment[] => a.installments ?? [];

/** One HR may move or change: pending, in a month whose run isn't with the CEO, approved or paid. */
export const changesInstallment = (i: Pick<AdvanceInstallment, 'status' | 'locked'>) => i.status === 'pending' && !i.locked;

/** The ones moving and changing work on, in month order: the pending ones not locked. */
export const changeablePlan = (installments: readonly AdvanceInstallment[]): Installment[] =>
  installments.filter(changesInstallment).map((i) => ({ month: i.month, amount: i.amount }));

/** An installment's state in words: Pending, Applied, Cancelled; a pending one whose month's run is with the CEO, approved or paid says so. */
export function installmentStatusText(i: Pick<AdvanceInstallment, 'status' | 'locked'>): string {
  const label = ADJUSTMENT_STATUS_LABELS[i.status] ?? i.status;
  return i.status === 'pending' && i.locked ? `${label}, its month’s run locked` : label;
}

/** "Next: November 2026, EGP 1,000.00", or null when none is pending. */
export const nextText = (next: AdvanceRow['nextInstallment']) => (next ? `Next: ${monthName(next.month)}, ${formatEgp(next.amount)}` : null);

/** What Move to next month asks first. */
export const postponeConfirm = (month: string) =>
  `Move the ${monthName(month)} installment, and every later one, a month on? Nothing of it is deducted in ${monthName(month)}; the plan ends a month later.`;

/**
 * What changing the installment of `month` to the amount typed does to the later ones, worked out as it is typed:
 * "After it: 4 installments of EGP 1,250.00, the last in April 2027.", or the reason it can't be; null until typed.
 */
export function changePreview(installments: readonly AdvanceInstallment[], month: string, amountInput: string): { text: string } | { problem: string } | null {
  const amount = parseAmount(amountInput);
  if (amount === null) return null;
  const result = changeInstallment(changeablePlan(installments), month, Number.isNaN(amount) ? NaN : amount);
  if ('problem' in result) return { problem: result.problem };
  const later = result.plan.filter((p) => p.month > month);
  if (!later.length) return { text: 'Nothing is left to deduct after it.' };
  return { text: `After it: ${installmentPlanText(later)}, the last in ${monthName(later[later.length - 1].month)}.` };
}

/** The change form: the installment's month and its new amount. */
export function changeBody(fd: FormData): { body: { month: string; amount: number }; errors: string[] } {
  const errors: string[] = [];
  const month = text(fd, 'month');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) errors.push('This installment was not found. Reload the page and try again.');
  const amount = parseAmount(text(fd, 'amount'));
  if (amount === null || Number.isNaN(amount) || amount <= 0) errors.push('Enter the installment in EGP, more than 0, e.g. 1000 or 1000.50.');
  return { body: { month, amount: amount ?? NaN }, errors };
}

// ---------- settled ----------

/** How a settled one was settled, with HR's note: "Waived: Hardship, agreed by the CEO"; from an API from before `settledHow`, the note. */
export function settledText(a: Pick<AdvanceRow, 'settledHow' | 'settledNote'>): string {
  const how = a.settledHow ? ADVANCE_SETTLED_HOW_LABELS[a.settledHow] : null;
  if (how && a.settledNote) return `${how}: ${a.settledNote}`;
  return how ?? a.settledNote ?? ADVANCE_SETTLED_HOW_LABELS.recovered;
}

/** The three ways HR marks one settled with something outstanding, as the settle form offers them, paid back first. */
export const SETTLE_CHOICES: { value: AdvanceSettleWay; label: string; hint: string }[] = (
  [
    ['paid_back', 'The employee paid back what is outstanding, e.g. in cash.'],
    ['final_settlement', 'Taken from the final dues of someone who left.'],
    ['waived', 'The company forgoes what is outstanding. Say why: it is kept with who waived it.'],
  ] as const
).map(([value, hint]) => ({ value, label: ADVANCE_SETTLED_HOW_LABELS[value], hint }));

/**
 * The settle form (owner, 18 October 2026: leaving before it is paid back, "taken from the final settlement, unless
 * waived"): how, and a note, needed when it is waived (why) or paid back (how, as before); the pending installments are
 * cancelled.
 */
export function settleAdvanceBody(fd: FormData): { body: { how: AdvanceSettleWay; note: string | null }; errors: string[] } {
  const errors: string[] = [];
  const how = text(fd, 'how') as AdvanceSettleWay;
  if (!SETTLE_CHOICES.some((c) => c.value === how)) errors.push('Choose how it was settled.');
  const note = text(fd, 'note');
  if (how === 'waived' && !note) errors.push('Say why it is waived.');
  if (how === 'paid_back' && !note) errors.push('Say how it was paid back, e.g. in cash on 20/10/2026.');
  return { body: { how, note: note || null }, errors };
}
