import { isOpenLeave, permissionClock, permissionHoursText } from '@trendlix/shared';
import { formatDate, formatTime } from '../../../lib/format';
import type { OdCalendarItem } from '../../../lib/od-types';
import type { Holiday, LeaveCalendarEntry } from '../../../lib/types';
import type { WfhCalendarItem } from '../../../lib/wfh-types';
import { addMonths, monthName } from '../payroll/list';
import { placeOfEmployee } from './list';
import { permissionTimesText } from './permissions';

// The month's calendar of who is off (owner, 18 October 2026: leaves first, "if we will work on the attendance and
// leaves, how will we build it?"): for HR and the CEO on Requests → Leave Requests, for a direct manager their team's on
// My Team. A month at a time (?month=2026-10): each day with its weekday and the official holidays on it (Organization →
// Holidays), each person off with their leave of each day (approved, and for HR those still being decided, shown apart),
// grouped by department, then team, as the other lists of people are. On a phone the same month reads as a list of the
// days someone is off. Permission (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day", asked "In
// the system, like leave"; the owner's brief: on the calendar "as hours") marks its day with its hours, apart from a day
// of leave, and isn't a day off: someone with only permission in the month still has a row, its hours beside the days.
// A work from home day (owner, 21 October 2026: "think about how should we handle the working from home in out erp"; the
// brief: on the leave calendar and the team's "as a distinct style from leave") marks its day apart too, and isn't a day
// off either: a working day elsewhere. An official duty (owner, 23 October 2026: "Official duty (OD) requests"; the
// spec: "Team calendar shows leave and OD") marks each of its days apart in its own colour, a working day away from the
// office, not a day off; part of a day with its times. A leave's colleague who covers it (owner's brief, 25 October 2026:
// "My Team's calendar: unchanged, plus the cover person on hover or detail") is in its cell's words, its tooltip, and the
// phone's list. Pure code, tested; relative imports, as vitest doesn't know the @/ paths. Dates are YYYY-MM-DD.

const pad = (n: number) => String(n).padStart(2, '0');
const MONTH = /^(\d{4})-(\d{2})$/;

/** The months the calendar can show (the API's years). */
export const CALENDAR_YEARS = { from: 2000, to: 2100 } as const;

type Query = Record<string, string | string[] | undefined>;

/** The month in the address (?month=2026-10) when it is one, else this month (`today`: YYYY-MM-DD, Cairo). */
export function readMonth(query: Query, today: string): string {
  const asked = typeof query.month === 'string' ? query.month : '';
  const m = MONTH.exec(asked);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= CALENDAR_YEARS.from && Number(m[1]) <= CALENDAR_YEARS.to) return asked;
  return today.slice(0, 7);
}

/** The department or team in the address (?department=<id>), when it looks like an id; null for everyone. */
export function readDepartment(query: Query): string | null {
  const asked = typeof query.department === 'string' ? query.department : '';
  return /^[0-9a-f-]{36}$/i.test(asked) ? asked : null;
}

/** The month's first and last day: what GET /leave/calendar?from=&to= is asked for. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

/** The API's calendar for a month and a department (none: everyone the caller may see). */
export function calendarPath(month: string, departmentId?: string | null): string {
  const { from, to } = monthRange(month);
  const params = new URLSearchParams({ from, to });
  if (departmentId) params.set('departmentId', departmentId);
  return `/leave/calendar?${params.toString()}`;
}

/** The month before and after, for the calendar's arrows. */
export const previousMonth = (month: string) => addMonths(month, -1);
export const nextMonth = (month: string) => addMonths(month, 1);

/** "October 2026". */
export const monthTitle = (month: string) => monthName(month);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A day of the month, as the calendar's head shows it. */
export interface CalendarDay {
  date: string;
  day: number;
  /** "Sun" … "Sat", and the whole name for those who can't see the head. */
  weekday: string;
  weekdayName: string;
  /** The official holidays on it, by name (one day can have two). */
  holidays: { nameEn: string; nameAr: string | null }[];
  today: boolean;
}

/** Every day of the month, with its weekday, its holidays and whether it is today. */
export function calendarDays(month: string, holidays: readonly Pick<Holiday, 'date' | 'nameEn' | 'nameAr'>[], today: string): CalendarDay[] {
  const { to } = monthRange(month);
  const last = Number(to.slice(8, 10));
  const days: CalendarDay[] = [];
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${pad(d)}`;
    const index = new Date(`${date}T00:00:00Z`).getUTCDay();
    days.push({
      date,
      day: d,
      weekday: WEEKDAYS[index],
      weekdayName: WEEKDAY_NAMES[index],
      holidays: holidays.filter((h) => h.date === date).map((h) => ({ nameEn: h.nameEn, nameAr: h.nameAr })),
      today: date === today,
    });
  }
  return days;
}

/** A permission on a day: its hours (two of a day together), and its times (HH:MM) when it is one with times. */
export interface CalendarPermission {
  hours: number;
  fromTime: string | null;
  toTime: string | null;
}

/**
 * A person's leave on a day: its type, half a day or not, and whether it is approved or still being decided; or their
 * permission that day (`permission`, 19 October 2026), its type Permission.
 */
export interface CalendarCell {
  typeName: string;
  halfDay: boolean;
  waiting: boolean;
  /** The first and the last day of this leave, to draw it as one bar across its days (a permission is one day). */
  first: boolean;
  last: boolean;
  requestId: string | null;
  /** A permission's hours and times; null for leave. */
  permission: CalendarPermission | null;
  /** A work from home day (21 October 2026): a working day elsewhere, not a day off. */
  wfh?: boolean;
  /**
   * A day of official duty (23 October 2026): a working day away from the office, not a day off; part of a day's times
   * in words ("10:00 AM–2:00 PM"), null for a full day.
   */
  od?: { times: string | null };
  /** A leave's colleague who covers it, by name (25 October 2026); none named, or not leave: absent. */
  cover?: string | null;
}

/**
 * A row of the calendar: someone off at least once in the month, or with permission on one of its days, and their leave
 * or permission on each day (null: neither).
 */
export interface CalendarPerson {
  id: string;
  name: string;
  /** "Department › Team", the department alone, or null: what the calendar groups them by. */
  place: string | null;
  cells: (CalendarCell | null)[];
  /** The days of the month they are off, half days as halves (approved and waiting together); permission isn't a day off. */
  daysOff: number;
  /** Their permission hours in the month (approved and waiting together). */
  permissionHours: number;
  /** Their work from home days in the month (approved and waiting together; 21 October 2026). */
  wfhDays: number;
  /** Their days of official duty in the month (approved and waiting together; 23 October 2026). */
  odDays: number;
}

/** Only the leave the calendar shows: approved, and still being decided; rejected and cancelled ones are left out. */
const shown = (e: Pick<LeaveCalendarEntry, 'status'>) => e.status === 'approved' || isOpenLeave(e.status);

/**
 * A cell's share of a day off: a day, half a day, or none for a permission (19 October 2026: it isn't a day off) and a
 * work from home day (21 October 2026: a working day elsewhere).
 */
const offOf = (c: CalendarCell | null | undefined) => (!c || c.permission || c.wfh || c.od ? 0 : c.halfDay ? 0.5 : 1);

/** Whether a cell is a working day's mark rather than leave: a permission, a work from home day or official duty. */
const working = (c: Pick<CalendarCell, 'permission' | 'wfh' | 'od'>) => c.permission !== null || c.wfh === true || !!c.od;

/**
 * Whether what is already on a person's day stays when another of their requests falls on it: the approved over one
 * being decided, as before; leave over a permission (a day of leave needs no permission, 19 October 2026). Two
 * permissions of a day as one are put together by calendarPeople.
 */
function keeps(had: CalendarCell, waiting: boolean, permission: boolean): boolean {
  if (!working(had) && permission) return true;
  if (working(had) && !permission) return false;
  return !had.waiting || waiting;
}

/**
 * The people off in the month (anyone with leave on one of its days), and those with permission on one (19 October
 * 2026), by name, each with their leave or permission on each day. Where two of someone's requests meet on a day, the
 * approved one is shown (an approved one replaces one being decided), leave over a permission; two permissions of a
 * day, both approved or both being decided, show their hours together.
 */
export function calendarPeople(entries: readonly (LeaveCalendarEntry | WfhCalendarItem | OdCalendarItem)[], days: readonly Pick<CalendarDay, 'date'>[]): CalendarPerson[] {
  const people = new Map<string, CalendarPerson>();
  for (const e of entries.filter(shown)) {
    let person = people.get(e.employee.id);
    if (!person) {
      person = { id: e.employee.id, name: e.employee.fullNameEn, place: placeOfEmployee(e.employee), cells: days.map(() => null), daysOff: 0, permissionHours: 0, wfhDays: 0, odDays: 0 };
      people.set(e.employee.id, person);
    }
    const waiting = isOpenLeave(e.status);
    const wfh = e.kind === 'wfh';
    // official duty (23 October 2026): each day its own mark, part of a day with its times
    const od = e.kind === 'od' ? { times: !e.fullDay && e.fromTime && e.toTime ? `${formatTime(e.fromTime)}–${formatTime(e.toTime)}` : null } : null;
    const permission: CalendarPermission | null =
      e.kind === 'permission' ? { hours: typeof e.hours === 'number' && e.hours > 0 ? e.hours : 0, fromTime: e.fromTime ?? null, toTime: e.toTime ?? null } : null;
    days.forEach((d, i) => {
      if (d.date < e.startDate || d.date > e.endDate) return;
      const had = person!.cells[i];
      if (had?.permission && permission && had.waiting === waiting) {
        // two permissions of a day: their hours together, the times no longer one span
        person!.cells[i] = { ...had, permission: { hours: had.permission.hours + permission.hours, fromTime: null, toTime: null } };
        return;
      }
      if (had && keeps(had, waiting, permission !== null || wfh || od !== null)) return;
      person!.cells[i] = {
        typeName: e.type.nameEn,
        halfDay: permission || wfh || od ? false : e.halfDay,
        waiting,
        first: permission !== null || wfh || od !== null || d.date === e.startDate || i === 0,
        last: permission !== null || wfh || od !== null || d.date === e.endDate || i === days.length - 1,
        requestId: e.id ?? null,
        permission,
        ...(wfh && { wfh: true }),
        ...(od && { od }),
        // who covers the leave (25 October 2026)
        ...(!permission && !wfh && !od && 'cover' in e && e.cover && { cover: e.cover.fullNameEn }),
      };
    });
  }
  const list = [...people.values()];
  for (const p of list) {
    p.daysOff = p.cells.reduce((n, c) => n + offOf(c), 0);
    p.permissionHours = p.cells.reduce((n, c) => n + (c?.permission?.hours ?? 0), 0);
    p.wfhDays = p.cells.reduce((n, c) => n + (c?.wfh ? 1 : 0), 0);
    p.odDays = p.cells.reduce((n, c) => n + (c?.od ? 1 : 0), 0);
  }
  return list.filter((p) => p.daysOff > 0 || p.permissionHours > 0 || p.wfhDays > 0 || p.odDays > 0).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** How many are off on each day of the month (half days as halves; permission isn't a day off), for the calendar's last row. */
export function offPerDay(people: readonly Pick<CalendarPerson, 'cells'>[], dayCount: number): number[] {
  return Array.from({ length: dayCount }, (_, i) => people.reduce((n, p) => n + offOf(p.cells[i]), 0));
}

/** A permission's hours as its cell shows them: "2:00", "1:30". */
export const permissionCellText = (p: Pick<CalendarPermission, 'hours'>) => permissionClock(p.hours);

/** A permission in words, for its cell's label and the phone's list: "Permission, 2 hours, 5:00 PM – 7:00 PM". */
export function permissionCellWords(typeName: string, p: CalendarPermission): string {
  const times = permissionTimesText(p);
  return `${typeName}, ${permissionHoursText(p.hours)}${times ? `, ${times}` : ''}`;
}

/**
 * What a day's cell says to those who can't see the grid, and as its tooltip: "Nour Adel: Annual leave, half a day,
 * being decided, Monday 05/10/2026"; a permission "Nour Adel: Permission, 2 hours, 5:00 PM – 7:00 PM, approved, Tuesday
 * 03/11/2026".
 */
export function cellLabel(cell: CalendarCell, name: string, day: Pick<CalendarDay, 'date' | 'weekdayName'>): string {
  const when = `${day.weekdayName} ${formatDate(day.date)}`;
  if (cell.wfh) return `${name}: ${WFH_CELL_WORDS}, ${cell.waiting ? 'being decided' : 'approved'}, ${when}`;
  if (cell.od) return `${name}: ${odCellWords(cell.od)}, ${cell.waiting ? 'being decided' : 'approved'}, ${when}`;
  if (cell.permission) return `${name}: ${permissionCellWords(cell.typeName, cell.permission)}, ${cell.waiting ? 'being decided' : 'approved'}, ${when}`;
  return `${name}: ${cell.typeName}${cell.halfDay ? ', half a day' : ''}${cell.waiting ? ', being decided' : ''}${coverWords(cell)}, ${when}`;
}

/** Who covers a leave, as its cell's words say it: ", covered by Sara Ali"; nothing when nobody is named (25 October 2026). */
export const coverWords = (cell: Pick<CalendarCell, 'cover'>): string => (cell.cover ? `, covered by ${cell.cover}` : '');

/** A work from home day's mark in the grid, and its words (21 October 2026). */
export const WFH_CELL_TEXT = 'WFH';
export const WFH_CELL_WORDS = 'Working from home';

/** A day of official duty's mark in the grid, and its words (23 October 2026), part of a day's times with them. */
export const OD_CELL_TEXT = 'OD';
export const OD_CELL_WORDS = 'Official duty';
export const odCellWords = (od: { times: string | null }) => (od.times ? `${OD_CELL_WORDS}, ${od.times}` : OD_CELL_WORDS);

/** One person off on a day, or with permission that day, as the phone's list of days says it. */
export interface AgendaPerson {
  id: string;
  name: string;
  place: string | null;
  typeName: string;
  halfDay: boolean;
  waiting: boolean;
  requestId: string | null;
  permission: CalendarPermission | null;
  wfh?: boolean;
  od?: { times: string | null };
  /** A leave's colleague who covers it, by name (25 October 2026). */
  cover?: string | null;
}

/** A day of the phone's list: the day, its holidays, and who is off on it. */
export interface AgendaDay {
  day: CalendarDay;
  off: AgendaPerson[];
}

/** The days of the month someone is off or a holiday falls on, in order: the calendar as a list, for a phone. */
export function calendarAgenda(people: readonly CalendarPerson[], days: readonly CalendarDay[]): AgendaDay[] {
  return days
    .map((day, i) => ({
      day,
      off: people.flatMap((p) => {
        const c = p.cells[i];
        return c
          ? [
              {
                id: p.id,
                name: p.name,
                place: p.place,
                typeName: c.typeName,
                halfDay: c.halfDay,
                waiting: c.waiting,
                requestId: c.requestId,
                permission: c.permission,
                ...(c.wfh && { wfh: true }),
                ...(c.od && { od: c.od }),
                ...(c.cover && { cover: c.cover }),
              },
            ]
          : [];
      }),
    }))
    .filter((a) => a.off.length > 0 || a.day.holidays.length > 0);
}

/**
 * The letter each type of leave shows in its cells, and the legend under the calendar: the first letter of its name, a
 * second one when two types start alike ("Annual leave" A, "Absence" Ab), in the order the types come.
 */
export function typeLetters(names: readonly string[]): Map<string, string> {
  const letters = new Map<string, string>();
  const used = new Set<string>();
  for (const name of [...new Set(names)]) {
    const clean = name.replace(/[^A-Za-z]/g, '') || name;
    let mark = clean.slice(0, 1).toUpperCase();
    for (let n = 2; used.has(mark) && n <= clean.length; n++) mark = clean.slice(0, 1).toUpperCase() + clean.slice(n - 1, n).toLowerCase();
    used.add(mark);
    letters.set(name, mark);
  }
  return letters;
}

/** "3 people off this month", "1 person off this month", "No one off this month". */
export function offThisMonthText(n: number): string {
  if (n === 0) return 'No one off this month';
  return `${n} ${n === 1 ? 'person' : 'people'} off this month`;
}

/**
 * What the calendar says of its month: how many are off, and how many have permission (19 October 2026), "2 people off
 * this month, 1 with permission"; the permission said only when someone has it.
 */
export function monthSummaryText(people: readonly (Pick<CalendarPerson, 'daysOff' | 'permissionHours'> & { wfhDays?: number; odDays?: number })[]): string {
  const off = offThisMonthText(people.filter((p) => p.daysOff > 0).length);
  const withPermission = people.filter((p) => p.permissionHours > 0).length;
  // and how many work from home some day of it (21 October 2026)
  const fromHome = people.filter((p) => (p.wfhDays ?? 0) > 0).length;
  // and how many are on official duty some day of it (23 October 2026)
  const onDuty = people.filter((p) => (p.odDays ?? 0) > 0).length;
  return `${off}${withPermission ? `, ${withPermission} with permission` : ''}${fromHome ? `, ${fromHome} working from home` : ''}${onDuty ? `, ${onDuty} on official duty` : ''}`;
}
