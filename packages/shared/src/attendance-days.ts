// The Attendance section (owner, 19 October 2026: "is the attendance module active?", then "the attendance is not active
// in the side menu"): the days kept from Zoho People's imports (AttendanceDay, attendance-import.ts) read back for HR, the
// CEO and Finance (Daily Attendance, a person's month, the Summary by department and team), for a manager's team and
// for an employee's own month. What a kept day shows (its short hours against the shift, a check-in without a
// check-out), a month's figures, the filters of Daily Attendance, the Summary's period and its rows by department and
// team. Pure: the API works the figures out with these and the web shows the same words.

import type { AttendanceDayStatus, WorkPlace } from './attendance-import.js';

/** To the minute, as the import counts hours. */
const toMinute = (hours: number) => Math.round(hours * 60) / 60 + 0;

// ---------- a day ----------

/** A day of someone's attendance as the system keeps it (AttendanceDay): what the import worked it out to be. */
export interface KeptDay {
  /** YYYY-MM-DD. */
  date: string;
  status: AttendanceDayStatus;
  /** Moments, ISO; null: none in Zoho's file. */
  checkIn: string | null;
  checkOut: string | null;
  place: WorkPlace | null;
  zohoStatus: string | null;
  /**
   * The day's permission hours as the month counts them (the owner's rule, 19 October 2026): the permission requests
   * approved in the system when the month has any, else Zoho's Permission column that day; 0 for none.
   */
  permissionHours: number;
  /** The hours it counts, by the shift's rule (attendance.ts hoursCountedForDay). */
  hoursCounted: number;
}

/** A kept day as the Attendance pages show it. */
export interface AttendanceDayView extends KeptDay {
  /** The hours the shift asks a day worked (payroll.ts shiftWorkHours); null without a shift, or on a day not worked. */
  expectedHours: number | null;
  /** Short of the shift's hours on a day worked from check-in to check-out, after the day's permission; 0 otherwise. */
  shortHours: number;
  /** A check-in without a check-out: no hours counted that day. */
  missingCheckOut: boolean;
}

/**
 * A kept day with what it shows: a day worked with both a check-in and a check-out is short by the shift's hours a day
 * less the hours counted and the day's permission (never below 0); a check-in without a check-out is a missing
 * check-out (no hours, not short: it is said apart); any other day is neither.
 */
export function attendanceDayView(day: KeptDay, hoursADay: number | null): AttendanceDayView {
  const worked = day.status === 'worked';
  const missingCheckOut = worked && !!day.checkIn && !day.checkOut;
  const counted = worked && !!day.checkIn && !!day.checkOut;
  const expectedHours = worked && typeof hoursADay === 'number' && hoursADay > 0 ? hoursADay : null;
  const shortHours = counted && expectedHours !== null ? Math.max(0, toMinute(expectedHours - day.hoursCounted - Math.max(0, day.permissionHours))) : 0;
  return { ...day, expectedHours, shortHours, missingCheckOut };
}

// ---------- a month's figures ----------

/** A person's figures for a month (or several), as Daily Attendance, a person's month and the Summary show them. */
export interface AttendanceFigures {
  /** Days kept from the imports. */
  daysRecorded: number;
  /** Days with a check-in. */
  daysWorked: number;
  /** Days worked with a check-out: the days whose hours are counted (the average a day is over these). */
  daysCounted: number;
  hoursCounted: number;
  /** Working days with no check-in, not on leave, not a holiday: the payroll's no-show days. */
  absentDays: number;
  /** Short of the shift's hours on the days counted, after their permission (attendanceDayView). */
  shortHours: number;
  permissionHours: number;
  officeDays: number;
  remoteDays: number;
  /** Days on leave in the system. */
  leaveDays: number;
  /** Days Zoho marks as leave with no leave in the system: for HR to record there. */
  zohoLeaveDays: number;
  missingCheckOuts: number;
  /** Days Zoho says present or on duty without a check-in: not absent, nor any hours. */
  noCheckInDays: number;
  holidays: number;
  restDays: number;
}

export const NO_ATTENDANCE_FIGURES: Readonly<AttendanceFigures> = Object.freeze({
  daysRecorded: 0,
  daysWorked: 0,
  daysCounted: 0,
  hoursCounted: 0,
  absentDays: 0,
  shortHours: 0,
  permissionHours: 0,
  officeDays: 0,
  remoteDays: 0,
  leaveDays: 0,
  zohoLeaveDays: 0,
  missingCheckOuts: 0,
  noCheckInDays: 0,
  holidays: 0,
  restDays: 0,
});

const FIGURE_KEYS = Object.keys(NO_ATTENDANCE_FIGURES) as (keyof AttendanceFigures)[];
const HOUR_KEYS: ReadonlySet<keyof AttendanceFigures> = new Set(['hoursCounted', 'shortHours', 'permissionHours']);

/**
 * A month's figures from its days. The permission hours are the days' (the system's requests', else Zoho's column),
 * within `permissionLimit` when it is given (Zoho's column counts within the month's allowance: attendance-import.ts),
 * or `permissionHours` when the month's are known otherwise (the system's requests of the month, days without a row
 * too).
 */
export function attendanceFigures(days: readonly AttendanceDayView[], options: { permissionLimit?: number | null; permissionHours?: number } = {}): AttendanceFigures {
  const f: AttendanceFigures = { ...NO_ATTENDANCE_FIGURES };
  let permission = 0;
  for (const d of days) {
    f.daysRecorded++;
    if (d.status === 'worked') {
      f.daysWorked++;
      if (d.checkIn && d.checkOut) f.daysCounted++;
      if (d.place === 'office') f.officeDays++;
      if (d.place === 'remote') f.remoteDays++;
      if (d.missingCheckOut) f.missingCheckOuts++;
      f.hoursCounted += d.hoursCounted;
      f.shortHours += d.shortHours;
    } else if (d.status === 'absent') f.absentDays++;
    else if (d.status === 'leave') f.leaveDays++;
    else if (d.status === 'zoho_leave') f.zohoLeaveDays++;
    else if (d.status === 'no_check_in') f.noCheckInDays++;
    else if (d.status === 'holiday') f.holidays++;
    else if (d.status === 'rest') f.restDays++;
    permission += Math.max(0, d.permissionHours);
  }
  const limit = options.permissionLimit;
  f.permissionHours = options.permissionHours ?? (typeof limit === 'number' ? Math.min(permission, Math.max(0, limit)) : permission);
  for (const k of HOUR_KEYS) f[k] = toMinute(f[k]);
  return f;
}

/** Two sets of figures together: a department's people, a person's months. */
export function addFigures(a: AttendanceFigures, b: AttendanceFigures): AttendanceFigures {
  const f = { ...a };
  for (const k of FIGURE_KEYS) f[k] = HOUR_KEYS.has(k) ? toMinute(a[k] + b[k]) : a[k] + b[k];
  return f;
}

/** The hours counted a day, on the days counted (worked with a check-out), to the minute; null with none. */
export function averageHoursADay(f: Pick<AttendanceFigures, 'hoursCounted' | 'daysCounted'>): number | null {
  return f.daysCounted > 0 ? toMinute(f.hoursCounted / f.daysCounted) : null;
}

// ---------- Daily Attendance's filters ----------

/** "Only with absences" and the like (owner's brief, 19 October 2026): who Daily Attendance lists. */
export const ATTENDANCE_FILTERS = ['absences', 'short_hours', 'missing_check_outs', 'remote', 'zoho_leave'] as const;
export type AttendanceFilter = (typeof ATTENDANCE_FILTERS)[number];

export const ATTENDANCE_FILTER_LABELS: Record<AttendanceFilter, string> = {
  absences: 'Only with absences',
  short_hours: 'Only with short hours',
  missing_check_outs: 'Only with missing check-outs',
  remote: 'Only with remote days',
  zoho_leave: 'Only with leave in Zoho only',
};

export const isAttendanceFilter = (value: unknown): value is AttendanceFilter => (ATTENDANCE_FILTERS as readonly unknown[]).includes(value);

/** Whether a person's figures are listed under a filter; none: everyone. */
export function matchesAttendanceFilter(f: AttendanceFigures, filter: AttendanceFilter | null | undefined): boolean {
  switch (filter) {
    case 'absences':
      return f.absentDays > 0;
    case 'short_hours':
      return f.shortHours > 0;
    case 'missing_check_outs':
      return f.missingCheckOuts > 0;
    case 'remote':
      return f.remoteDays > 0;
    case 'zoho_leave':
      return f.zohoLeaveDays > 0;
    default:
      return true;
  }
}

// ---------- the Summary's period ----------

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The most months a Summary covers at once: three years. */
export const ATTENDANCE_SUMMARY_MONTHS = 36;

/**
 * The Summary's period (owner's brief, 19 October 2026: "?month= or a range"): `month` alone is that month; `from` and
 * `to` a range (one of them alone: that month); none, this month. Months it can't read are left out, as if not sent;
 * the wrong way round, swapped.
 */
export function attendancePeriod(query: { month?: string | null; from?: string | null; to?: string | null }, today: string): { from: string; to: string } {
  const ok = (m: string | null | undefined): m is string => typeof m === 'string' && MONTH.test(m.trim());
  const month = ok(query.month) ? query.month.trim() : null;
  let from = ok(query.from) ? query.from.trim() : null;
  let to = ok(query.to) ? query.to.trim() : null;
  if (!from && !to) from = to = month ?? today.slice(0, 7);
  from ??= to!;
  to ??= from;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** How many months a period covers: 2026-01 to 2026-03 → 3. */
export function periodMonthCount(p: { from: string; to: string }): number {
  const n = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  return n(p.to) - n(p.from) + 1;
}

// ---------- the Summary's rows ----------

/** Where someone worked a month: a department, or a team with its department. */
export interface AttendancePlace {
  id: string;
  nameEn: string;
  parent: { id: string; nameEn: string } | null;
}

/** A person's month as the Summary counts it: where they worked that month, and its figures. */
export interface PersonMonthFigures {
  employeeId: string;
  month: string;
  place: AttendancePlace | null;
  figures: AttendanceFigures;
}

/** A department's or a team's row of the Summary. */
export interface AttendanceSummaryRow {
  /** The department or team; null: those without a department. */
  id: string | null;
  name: string | null;
  /** Different people counted, and person-months. */
  people: number;
  personMonths: number;
  figures: AttendanceFigures;
  averageHours: number | null;
}

/** A department with its teams: its row counts its teams' people too, each team has its own. */
export interface AttendanceSummaryGroup extends AttendanceSummaryRow {
  teams: AttendanceSummaryRow[];
}

/** A department or team as GET /departments lists them, in the order set on Organization (Reorder). */
export interface OrderedPlace {
  id: string;
  nameEn: string;
  parentId: string | null;
}

interface Tally {
  people: Set<string>;
  personMonths: number;
  figures: AttendanceFigures;
}

const tally = (): Tally => ({ people: new Set(), personMonths: 0, figures: { ...NO_ATTENDANCE_FIGURES } });
const count = (t: Tally, row: PersonMonthFigures) => {
  t.people.add(row.employeeId);
  t.personMonths++;
  t.figures = addFigures(t.figures, row.figures);
};
const rowOf = (id: string | null, name: string | null, t: Tally): AttendanceSummaryRow => ({ id, name, people: t.people.size, personMonths: t.personMonths, figures: t.figures, averageHours: averageHoursADay(t.figures) });

/**
 * The Summary by department and team (owner's brief, 19 October 2026): each department with everyone who worked in it
 * or in one of its teams, then each team, in Organization's order (`places`, as GET /departments lists them; a place it
 * doesn't know follows by name); those without a department last. A person counts where they worked each month.
 */
export function attendanceSummary(rows: readonly PersonMonthFigures[], places: readonly OrderedPlace[]): { groups: AttendanceSummaryGroup[]; totals: AttendanceSummaryRow } {
  const departments = new Map<string | null, { name: string | null; all: Tally; teams: Map<string, { name: string; t: Tally }> }>();
  const all = tally();
  for (const row of rows) {
    count(all, row);
    const department = row.place ? (row.place.parent ?? { id: row.place.id, nameEn: row.place.nameEn }) : null;
    const key = department?.id ?? null;
    const group = departments.get(key) ?? { name: department?.nameEn ?? null, all: tally(), teams: new Map() };
    departments.set(key, group);
    count(group.all, row);
    if (row.place?.parent) {
      const team = group.teams.get(row.place.id) ?? { name: row.place.nameEn, t: tally() };
      group.teams.set(row.place.id, team);
      count(team.t, row);
    }
  }
  const position = new Map(places.map((p, i) => [p.id, i]));
  const order = (a: { id: string | null; name: string | null }, b: { id: string | null; name: string | null }) => {
    if (a.id === null || b.id === null) return a.id === null ? (b.id === null ? 0 : 1) : -1;
    const [x, y] = [position.get(a.id), position.get(b.id)];
    if (x !== undefined && y !== undefined) return x - y;
    if (x !== undefined || y !== undefined) return x !== undefined ? -1 : 1;
    return (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base' });
  };
  const groups = [...departments.entries()]
    .map(([id, g]) => ({
      ...rowOf(id, g.name, g.all),
      teams: [...g.teams.entries()].map(([teamId, t]) => rowOf(teamId, t.name, t.t)).sort(order),
    }))
    .sort(order);
  return { groups, totals: rowOf(null, null, all) };
}
