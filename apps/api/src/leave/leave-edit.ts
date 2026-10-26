import { overBalanceStepText } from '@trendlix/shared';
import { shownDate } from '../common/date-only.js';

// A Super Admin editing a leave (owner, 26 October 2026, on an imported approved annual leave's page: "as a superadmin i
// need to edit the leaves"; asked, "All four": dates, leave type, reason, covered by; "Any status"; "Super Admin only").
// The pure parts of it, tested: what changed and how the step says it, which months the old and new days touch, and
// whether the balance moves. LeaveRequestsService.edit does the rest.

/** What an edit can change, as the request has it (names for the words of the step). */
export interface LeaveEditFacts {
  typeId: string;
  typeName: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  reason: string | null;
  coverId: string | null;
  coverName: string | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 2026" for "2026-10" (or a date in it). */
export const monthWords = (month: string): string => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

const periodWords = (f: Pick<LeaveEditFacts, 'startDate' | 'endDate'>) => (f.startDate === f.endDate ? shownDate(f.startDate) : `${shownDate(f.startDate)}–${shownDate(f.endDate)}`);

const quoted = (text: string | null) => (text ? `“${text.length > 80 ? `${text.slice(0, 77)}…` : text}”` : 'none');

/**
 * What the edit changes, in words, first the dates, then the type, the half day, the reason and who covers
 * ("Dates 05/11/2026 → 06/11/2026", "type Annual leave → Casual leave"): the first begins with a capital, the rest
 * lower case, as the step lists them. Empty: nothing changes.
 */
export function leaveEditChanges(before: LeaveEditFacts, after: LeaveEditFacts): string[] {
  const out: string[] = [];
  if (before.startDate !== after.startDate || before.endDate !== after.endDate) out.push(`dates ${periodWords(before)} → ${periodWords(after)}`);
  if (before.typeId !== after.typeId) out.push(`type ${before.typeName} → ${after.typeName}`);
  if (before.halfDay !== after.halfDay) out.push(`half day ${before.halfDay ? 'yes' : 'no'} → ${after.halfDay ? 'yes' : 'no'}`);
  if ((before.reason ?? null) !== (after.reason ?? null)) out.push(`reason ${quoted(before.reason)} → ${quoted(after.reason)}`);
  if ((before.coverId ?? null) !== (after.coverId ?? null)) out.push(`covered by ${before.coverName ?? 'nobody'} → ${after.coverName ?? 'nobody'}`);
  return out.map((c, i) => (i === 0 ? c[0].toUpperCase() + c.slice(1) : c));
}

/** The step's comment: the changes, then "Why:" and the note when given. */
export function leaveEditComment(changes: readonly string[], note: string | null | undefined): string {
  const text = note?.trim();
  return `${changes.join('; ')}${text ? `\nWhy: ${text}` : ''}`;
}

/** The months ("YYYY-MM") the days from the first to the last touch, in order. */
export function monthsOfDays(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7));
  const last = endDate.slice(0, 7);
  for (;;) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (month > last || out.length > 600) break;
    out.push(month);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Why days can't change (null: they can): the first month among those the old and new days touch whose payroll is with
 * the CEO, approved or paid, named (as the check-in exemptions say it; owner, 25 October 2026: approved or paid months
 * never change, and a run with the CEO would miss the change).
 */
export function leaveEditLockProblem(
  ranges: readonly { startDate: string; endDate: string }[],
  locked: readonly { month: string; status: string }[],
): string | null {
  const touched = new Set(ranges.flatMap((r) => monthsOfDays(r.startDate, r.endDate)));
  const hit = [...locked].filter((l) => touched.has(l.month)).sort((a, b) => a.month.localeCompare(b.month))[0];
  if (!hit) return null;
  const words = hit.status === 'pending_ceo' ? 'is with the CEO' : hit.status === 'paid' ? 'is paid' : 'is approved';
  return `The ${monthWords(hit.month)} payroll ${words}, so the days of this leave can't change. Ask the CEO to return the payroll to HR first, or leave these days as they are.`;
}

/** What an edit changes about the balance and the payroll: the days, the type or the year (reason and cover change neither). */
export function leaveEditMovesBalance(before: Pick<LeaveEditFacts, 'typeId' | 'startDate'> & { days: number }, after: Pick<LeaveEditFacts, 'typeId' | 'startDate'> & { days: number }): boolean {
  return before.typeId !== after.typeId || before.startDate.slice(0, 4) !== after.startDate.slice(0, 4) || before.days !== after.days;
}

/** Whether the edit changes what the payroll reads: the days, the half day or the type (the pay). */
export const leaveEditMovesPayroll = (before: LeaveEditFacts, after: LeaveEditFacts): boolean =>
  before.typeId !== after.typeId || before.startDate !== after.startDate || before.endDate !== after.endDate || before.halfDay !== after.halfDay;

/** The step's words in a message to the Super Admin when nothing changes. */
export const NOTHING_TO_EDIT = "Nothing was changed: change the type, the days, the reason or who covers it, then save.";

export const EDIT_SUPER_ADMIN_ONLY = 'Only a Super Admin edits a leave, in their own session (not while viewing as someone else, and never a developer).';

export const RESTORE_SUPER_ADMIN_ONLY = 'Only a Super Admin restores a cancelled leave, in their own session (not while viewing as someone else, and never a developer).';

/**
 * The step's comment of a restore (owner, 26 October 2026: "allow superadmin to undo cancellation"): where the leave is
 * back to, the balance it takes below 0 when it does (allowed for a Super Admin), then "Why:" and the note when given.
 */
export function leaveRestoreComment(to: string, over: number, note: string | null | undefined): string {
  const where = to === 'approved' ? 'Back to approved' : to === 'with_hr' ? 'Back to waiting for HR' : 'Back to waiting for the direct manager';
  const text = note?.trim();
  return `${where}${over > 0 ? `\n${overBalanceStepText(over)}` : ''}${text ? `\nWhy: ${text}` : ''}`;
}
