import type { PayrollStatus } from '@trendlix/shared';
import { monthsOfDays } from '../../leave/leave-edit.js';
import { monthName } from '../months.js';
import { STATUS_TEXT } from '../status.js';

// Leave and attendance changes in a month whose payroll has moved on (owner's brief, 27 October 2026, after the proof of
// the night before: with July's run with the CEO, HR recording leave in July answered 201 approved with no warning, and
// the line was unchanged). A run with the CEO, approved or paid keeps its lines for good, so such a change is allowed
// but never silent: the API answers with a warning, the request carries the months not in their payroll, HR and Finance
// are told, and Unsettled lists it until HR marks it handled (corrected by hand on the next payroll) or the month's run
// returns to draft and is refilled. The owner hasn't chosen refuse over warn; this is the warning path. Pure code here,
// tested; the service writes the rows.

/** The payroll statuses that keep a month's lines as they are: with the CEO, approved, paid. */
export const LOCKED_PAYROLL_STATUSES = ['pending_ceo', 'approved', 'paid'] as const satisfies readonly PayrollStatus[];

/**
 * The kinds of request flagged: leave, permission, working from home and official duty. Compensatory days refuse such a
 * month already (compensatory.service.ts assertMonthOpen), as official duty refuses being recorded in one (official-duty.ts
 * odLockProblem), a leave's edit and restore too; the paths still silent are flagged.
 */
export const LOCKED_CHANGE_KINDS = ['leave', 'permission', 'wfh', 'od'] as const;
export type LockedChangeKind = (typeof LOCKED_CHANGE_KINDS)[number];

/** What was done to the request: recorded by HR (approved at once), approved at its last step, or cancelled. */
export const LOCKED_CHANGE_ACTIONS = ['recorded', 'approved', 'cancelled'] as const;
export type LockedChangeAction = (typeof LOCKED_CHANGE_ACTIONS)[number];

/** How a flagged change was handled: by HR, by hand on a later payroll; or by the month's run, returned to draft and refilled. */
export const LOCKED_CHANGE_HANDLING = ['by_hand', 'refilled'] as const;
export type LockedChangeHandling = (typeof LOCKED_CHANGE_HANDLING)[number];

export const LOCKED_CHANGE_KIND_LABELS: Record<LockedChangeKind, string> = { leave: 'Leave', permission: 'Permission', wfh: 'Work from home', od: 'Official duty' };
export const LOCKED_CHANGE_ACTION_LABELS: Record<LockedChangeAction, string> = { recorded: 'recorded by HR', approved: 'approved', cancelled: 'cancelled' };

/** A month (YYYY-MM) and its run's status, as the runs are read. */
export interface LockedMonth {
  month: string;
  status: PayrollStatus;
}

/**
 * The months among those the days from `from` to `to` (YYYY-MM-DD) touch whose payroll keeps its lines (with the CEO,
 * approved or paid), the earliest first; none when every month touched is a draft or has no run yet.
 */
export function lockedMonthsOf(ranges: readonly { from: string; to: string }[], runs: readonly { month: string; status: string }[]): LockedMonth[] {
  const touched = new Set(ranges.flatMap((r) => monthsOfDays(r.from, r.to)));
  return runs
    .filter((r) => touched.has(r.month) && (LOCKED_PAYROLL_STATUSES as readonly string[]).includes(r.status))
    .map((r) => ({ month: r.month, status: r.status as PayrollStatus }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** The API's warning for one month: "July 2026's payroll is with the CEO: it isn't changed. Correct it by hand on the next payroll." */
export const lockedChangeWarning = (m: LockedMonth): string => `${monthName(m.month)}'s payroll ${STATUS_TEXT[m.status]}: it isn't changed. Correct it by hand on the next payroll.`;

/** What a request's view carries once flagged: the months (YYYY-MM) not in their payroll, and the warnings of the action just taken. */
export interface PayrollLockedView {
  /** The months whose payroll had moved on when this was recorded, approved or cancelled, still to handle; none otherwise. */
  payrollLocked?: string[];
  /** The API's warnings on the action just taken (record, approve, cancel): one a month flagged. Missing when none. */
  warnings?: string[];
}

/**
 * The view answered after an action, with the warnings when there are any: after a view's own (a work from home day's or
 * an official duty's "recorded past" warnings), never dropping them.
 */
export function withWarnings<T extends object>(view: T, warnings: readonly string[]): T & { warnings?: string[] } {
  if (!warnings.length) return view;
  const own = 'warnings' in view && Array.isArray((view as { warnings?: unknown }).warnings) ? ((view as { warnings: string[] }).warnings as string[]) : [];
  return { ...view, warnings: [...own, ...warnings.filter((w) => !own.includes(w))] };
}
