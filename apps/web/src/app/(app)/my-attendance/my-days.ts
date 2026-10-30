import { ATTENDANCE_DAY_STATUS_LABELS, formatHours, type AttendanceDayStatus } from '@trendlix/shared';
import { formatDate } from '../../../lib/format';
import { weekdayOf } from '../organization/holidays/holidays';

// My Attendance in the owner's design (30 October 2026, Figma "PeopleTrendlix", desktop): the month at a glance, a dot
// for each day on record (worked, rest, holiday, leave… from the month's own days, nothing else), and each day's row as
// the design writes it: "Thu 01" over "/10/2026", and its balance, the time over (+) or short (−) of the shift's hours
// that day. The design's attendance rate isn't shown: People counts it only in the attendance history on the profile,
// which the owner gave to HR, the CEO and Finance (23 October 2026). Pure, tested; relative imports for the tests.

/** What a day was, as its dot shows it: its status. */
export type GlanceKind = AttendanceDayStatus;

/** The legend's words, short ("Worked", "Rest", "Leave"); the dot's own title says the day's status in full. */
export const GLANCE_LABELS: Record<GlanceKind, string> = {
  worked: 'Worked',
  rest: 'Rest',
  holiday: 'Holiday',
  leave: 'Leave',
  zoho_leave: 'Leave in Zoho only',
  absent: 'Absent',
  no_check_in: 'No check-in',
};

/** The legend's order: the design's (worked, rest, leave), the others where they fit. */
const ORDER: readonly GlanceKind[] = ['worked', 'rest', 'holiday', 'leave', 'zoho_leave', 'absent', 'no_check_in'];

/** A day's dot: its date, what it was, and its title on hover ("Thursday 01/10/2026: Worked"). */
export interface GlanceDot {
  date: string;
  kind: GlanceKind;
  title: string;
}

/** The month at a glance: a dot for each day on record in date order, the legend of what is there, and it all in words. */
export interface Glance {
  dots: GlanceDot[];
  legend: { kind: GlanceKind; label: string; count: number }[];
  /** For a screen reader: "Worked 16, Rest 8, Holiday 1, Leave 1". */
  summary: string;
}

export function glanceOf(days: readonly { date: string; status: AttendanceDayStatus }[]): Glance {
  const known = days.filter((d) => ORDER.includes(d.status));
  const dots = [...known]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, kind: d.status, title: `${weekdayOf(d.date)} ${formatDate(d.date)}: ${ATTENDANCE_DAY_STATUS_LABELS[d.status]}`.trim() }));
  const legend = ORDER.map((kind) => ({ kind, label: GLANCE_LABELS[kind], count: dots.filter((d) => d.kind === kind).length })).filter((l) => l.count > 0);
  return { dots, legend, summary: legend.map((l) => `${l.label} ${l.count}`).join(', ') };
}

/** A day as its row starts: "Thu 01", and the rest of its date under it, "/10/2026". */
export function dayLabel(date: string): { day: string; rest: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return { day: date, rest: '' };
  return { day: `${weekdayOf(date).slice(0, 3)} ${m[3]}`, rest: `/${m[2]}/${m[1]}` };
}

/**
 * A day's balance (the design's "Balance"): over the shift's hours that day, "+0:46" (extra time, owner, 20 October
 * 2026), or short of them after its permission, "−0:40"; null when neither.
 */
export function dayBalance(day: { shortHours: number; extraHours?: number | null }): { text: string; kind: 'extra' | 'short' } | null {
  if (day.shortHours > 0) return { text: `−${formatHours(day.shortHours)}`, kind: 'short' };
  if (typeof day.extraHours === 'number' && day.extraHours > 0) return { text: `+${formatHours(day.extraHours)}`, kind: 'extra' };
  return null;
}

/**
 * Where most of the month's days came from (their words, "Checked in on the system"), said once under the table so a
 * row says its own only when it differs; null without days.
 */
export function usualSource(sources: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const s of sources) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best: string | null = null;
  for (const [s, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = s;
  return best;
}

/** How many columns the month's figures take on a wide screen: all in a row up to 7 (the design's), else two rows. */
export const figureColumns = (count: number): number => (count <= 7 ? Math.max(1, count) : Math.ceil(count / 2));
