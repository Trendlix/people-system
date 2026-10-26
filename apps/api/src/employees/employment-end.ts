import { fromDateOnly } from '../common/date-only.js';

// A leaver's last day, for the payroll and the attendance (owner's report, 27 October 2026: an employee with an approved
// ending whose last working day was the 20th, not yet completed, was paid 30/30 days with expected hours for the whole
// month and 8 no-shows after they left, a cut of 10,666.67 instead of 20/30 of the pay). While an employment has an
// ending the CEO approved (status approved: not one still waiting for the CEO, which the CEO may reject, and not one
// completed, which sets the employment's end date itself), its last working day (the agreed day when there is one) ends
// the employment for the month: the days paid and the shift's hours stop there (payroll/roster.ts), and the days after it
// are neither expected nor no-shows (attendance/attendance-days.service.ts: Daily Attendance shows them as not employed).
// The employment's end date, once set, ends it too: the earlier of the two wins. A withdrawn or rejected ending lifts it.

/** What a select reads for the leaving day: the endings the CEO approved, their last working day. */
export const APPROVED_ENDINGS_SELECT = { where: { status: 'approved' }, select: { lastWorkingDay: true } } as const;

/** An employment as the leaving day is read from it: its end date and, when read, its approved endings. */
export interface EmploymentEndRow {
  endDate: Date | null;
  endings?: readonly { lastWorkingDay: Date }[];
}

/** The earlier of an employment's end date and its leaving day (YYYY-MM-DD, or null each); null when it has neither. */
export function employmentEnd(endDate: string | null, leavingOn: string | null | undefined): string | null {
  if (!leavingOn) return endDate;
  return endDate !== null && endDate < leavingOn ? endDate : leavingOn;
}

/** The last working day of the employment's approved ending (YYYY-MM-DD), the earliest when there are several; null without one. */
export function leavingDayOf(e: Pick<EmploymentEndRow, 'endings'>): string | null {
  const days = (e.endings ?? []).map((x) => fromDateOnly(x.lastWorkingDay)).sort();
  return days[0] ?? null;
}

/** The day the employment ends for the payroll and the attendance: its end date, or an approved ending's last working day when earlier. */
export const employmentEndOf = (e: EmploymentEndRow): string | null => employmentEnd(fromDateOnly(e.endDate), leavingDayOf(e));
