import {
  DEDUCTION_TYPE_LABELS,
  monthPlus,
  RECOVERY_TYPE,
  recoveredKind,
  sumAmounts,
  type AdvanceKind,
  type Installment,
  type RecurringDeduction,
} from '@trendlix/shared';

// Installments and recurring deductions as the API keeps them (owner, 18 October 2026: "in the deductions i might have a
// loan of a medical subscription or something that needs to be deducted as installments on the employee. how will it be
// managed?"). The rules are packages/shared installments.ts; these are the API's own steps around them: the reasons an
// installment is made with, what a plan's change does to the deductions saved, where a recurring deduction stands, and
// the month's installments a line or a person has. Months are YYYY-MM. Pure.

// ---------- installments ----------

/** "Loan installment 2 of 6", "Advance recovery 1 of 3": the reason a planned installment is made with. */
export const installmentReason = (kind: AdvanceKind, n: number, of: number) => `${DEDUCTION_TYPE_LABELS[RECOVERY_TYPE[kind]]} ${n} of ${of}`;

/** Whether a reason is one installmentReason made: HR's own reasons (a deduction linked by hand) are never renumbered. */
export const isInstallmentReason = (reason: string) => /^(Advance recovery|Loan installment) \d+ of \d+$/.test(reason);

/** A deduction recovering an advance or loan, as saved. */
export interface SavedInstallment {
  id: string;
  month: string;
  amount: number;
  /** ADJUSTMENT_STATUSES: pending, applied, cancelled. */
  status: string;
  reason: string;
}

/**
 * What a plan's change does to the deductions it was made from (`before`, the pending ones HR may change, in month
 * order; `after`, postponeInstallment's or changeInstallment's answer for them, in the same order): one by one, those
 * whose month or amount changed are updated; any more in `after` are made (a lowered last one's extra month); any
 * fewer, the rest of `before` are cancelled (the changed one took what was left).
 */
export function planChanges(
  before: readonly Pick<SavedInstallment, 'id' | 'month' | 'amount'>[],
  after: readonly Installment[],
): { update: { id: string; month: string; amount: number }[]; create: Installment[]; cancel: string[] } {
  const update: { id: string; month: string; amount: number }[] = [];
  const shared = Math.min(before.length, after.length);
  for (let i = 0; i < shared; i++) {
    const [b, a] = [before[i], after[i]];
    if (b.month !== a.month || Math.round(b.amount * 100) !== Math.round(a.amount * 100)) update.push({ id: b.id, month: a.month, amount: a.amount });
  }
  return { update, create: after.slice(shared).map((a) => ({ ...a })), cancel: before.slice(shared).map((b) => b.id) };
}

/**
 * The reasons that change once a plan changed: every installment but those cancelled, numbered in month order ("2 of
 * 7"), on those still pending whose reason the plan made (never an applied one, nor HR's own). By id.
 */
export function renumbered(kind: AdvanceKind, rows: readonly Pick<SavedInstallment, 'id' | 'month' | 'status' | 'reason'>[]): Map<string, string> {
  const counted = rows.filter((r) => r.status !== 'cancelled').sort((a, b) => a.month.localeCompare(b.month));
  const out = new Map<string, string>();
  counted.forEach((r, i) => {
    const reason = installmentReason(kind, i + 1, counted.length);
    if (r.status === 'pending' && isInstallmentReason(r.reason) && r.reason !== reason) out.set(r.id, reason);
  });
  return out;
}

/** The installments by month (pending and applied, the cancelled left out), summed to the piaster. */
export function byMonth(rows: readonly { month: string; amount: number; status: string }[]): Record<string, number> {
  const months = new Map<string, number[]>();
  for (const r of rows.filter((x) => x.status !== 'cancelled')) months.set(r.month, [...(months.get(r.month) ?? []), r.amount]);
  return Object.fromEntries([...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, amounts]) => [m, sumAmounts(amounts)]));
}

/**
 * A line's installments for the share of pay warning (owner, 18 October 2026): its advances' recoveries and loans'
 * installments, summed; never its recurring deductions nor any other.
 */
export const lineInstallments = (items: readonly { kind: string; type: string; amount: number | null }[]) =>
  sumAmounts(items.filter((a) => recoveredKind(a.kind, a.type) !== null).map((a) => a.amount ?? 0));

// ---------- recurring deductions ----------

export const RECURRING_STATUSES = ['upcoming', 'running', 'ended'] as const;
export type RecurringStatus = (typeof RECURRING_STATUSES)[number];

/** The last month a recurring deduction is taken: its end month, or the month before it was stopped, the earlier; null: no end yet. */
export function lastMonthOf(r: Pick<RecurringDeduction, 'endMonth' | 'stoppedFrom'>): string | null {
  const stopped = r.stoppedFrom === null ? null : monthPlus(r.stoppedFrom, -1);
  if (r.endMonth === null) return stopped;
  if (stopped === null) return r.endMonth;
  return stopped < r.endMonth ? stopped : r.endMonth;
}

/**
 * Where a recurring deduction stands in `current` (this month): upcoming before its first month, ended after its last
 * (or stopped before it began), else running.
 */
export function recurringStatus(r: Pick<RecurringDeduction, 'startMonth' | 'endMonth' | 'stoppedFrom'>, current: string): RecurringStatus {
  const last = lastMonthOf(r);
  if (last !== null && (last < r.startMonth || last < current)) return 'ended';
  return r.startMonth > current ? 'upcoming' : 'running';
}

/** The later of two months. */
export const laterMonth = (a: string, b: string) => (a > b ? a : b);
