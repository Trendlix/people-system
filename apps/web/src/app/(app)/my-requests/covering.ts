import type { CoverAssignment } from '@trendlix/shared';
import { formatDate } from '../../../lib/format';

// "I'm Covering" (owner, 25 October 2026: "if there are leaves applied by an employee and another employee in the same
// department is on a leave, how can we manage it without affecting the workflow?"; asked, "Required over 2 days" and
// "Names, no leave types"): the colleagues' leave someone was named to cover, current or to come (GET /me/leave/covering),
// on My Requests and their dashboard: whom, the days, whether it is approved or still waiting, and the handover note the
// colleague left them; never the kind of leave. Pure code, tested; relative imports, as vitest's tests read them.

/** The section's anchor on My Requests: the notification of a cover opens it (/my-requests#covering). */
export const COVERING_ID = 'covering';
export const COVERING_HREF = `/my-requests#${COVERING_ID}`;

type Days = Pick<CoverAssignment, 'startDate' | 'endDate' | 'halfDay'>;

/** The days covered: "12/11/2026–14/11/2026"; one day "12/11/2026"; "12/11/2026 (half day)". */
export function coverDaysText(a: Days): string {
  if (a.startDate === a.endDate) return `${formatDate(a.startDate)}${a.halfDay ? ' (half day)' : ''}`;
  return `${formatDate(a.startDate)}–${formatDate(a.endDate)}`;
}

/** The line of one: "You’re covering Omar Khaled on 12/11/2026–14/11/2026." */
export const coveringLine = (a: Pick<CoverAssignment, 'employee'> & Days): string => `You’re covering ${a.employee.fullNameEn} on ${coverDaysText(a)}.`;

/** Where their leave stands: approved, or still being decided (never its type). */
export const coverStateText = (a: Pick<CoverAssignment, 'waiting'>): string => (a.waiting ? 'Waiting for approval' : 'Approved');

const dayNumber = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000;

/**
 * When, from today (YYYY-MM-DD, Cairo): "Now, until 14/11/2026" while it is on (today, for a day of its own); "Starts
 * tomorrow"; "Starts in 3 days"; "Ended" once it is over (the API sends none of those).
 */
export function coverWhenText(a: Days, today: string): string {
  if (a.endDate < today) return 'Ended';
  if (a.startDate <= today) return a.startDate === a.endDate ? 'Today' : `Now, until ${formatDate(a.endDate)}`;
  const days = Math.round(dayNumber(a.startDate) - dayNumber(today));
  return days === 1 ? 'Starts tomorrow' : `Starts in ${days} days`;
}

/** The ones current or to come, the nearest first: what the section and the card list. */
export function coveringToCome<T extends Pick<CoverAssignment, 'startDate' | 'endDate'>>(list: readonly T[], today: string): T[] {
  return list.filter((a) => a.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
}

/** How many: "1 colleague’s leave", "2 colleagues’ leave". */
export const coveringCountText = (n: number): string => `${n} ${n === 1 ? 'colleague’s' : 'colleagues’'} leave`;
