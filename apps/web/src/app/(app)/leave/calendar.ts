import { isOpenLeave } from '@trendlix/shared';
import type { Holiday, LeaveCalendarEntry } from '../../../lib/types';
import { addMonths, monthName } from '../payroll/list';
import { placeOfEmployee } from './list';

// The month's calendar of who is off (owner, 18 October 2026: leaves first, "if we will work on the attendance and
// leaves, how will we build it?"): for HR and the CEO on Requests → Leave Requests, for a direct manager their team's on
// My Team. A month at a time (?month=2026-10): each day with its weekday and the official holidays on it (Organization →
// Holidays), each person off with their leave of each day (approved, and for HR those still being decided, shown apart),
// grouped by department, then team, as the other lists of people are. On a phone the same month reads as a list of the
// days someone is off. Pure code, tested; relative imports, as vitest doesn't know the @/ paths. Dates are YYYY-MM-DD.

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

/** A person's leave on a day: its type, half a day or not, and whether it is approved or still being decided. */
export interface CalendarCell {
  typeName: string;
  halfDay: boolean;
  waiting: boolean;
  /** The first and the last day of this leave, to draw it as one bar across its days. */
  first: boolean;
  last: boolean;
  requestId: string | null;
}

/** A row of the calendar: someone off at least once in the month, and their leave on each day (null: not off). */
export interface CalendarPerson {
  id: string;
  name: string;
  /** "Department › Team", the department alone, or null: what the calendar groups them by. */
  place: string | null;
  cells: (CalendarCell | null)[];
  /** The days of the month they are off, half days as halves (approved and waiting together). */
  daysOff: number;
}

/** Only the leave the calendar shows: approved, and still being decided; rejected and cancelled ones are left out. */
const shown = (e: Pick<LeaveCalendarEntry, 'status'>) => e.status === 'approved' || isOpenLeave(e.status);

/**
 * The people off in the month (anyone with leave on one of its days), by name, each with their leave on each day. Where
 * two of someone's requests meet on a day, the approved one is shown (an approved one replaces one being decided).
 */
export function calendarPeople(entries: readonly LeaveCalendarEntry[], days: readonly Pick<CalendarDay, 'date'>[]): CalendarPerson[] {
  const people = new Map<string, CalendarPerson>();
  for (const e of entries.filter(shown)) {
    let person = people.get(e.employee.id);
    if (!person) {
      person = { id: e.employee.id, name: e.employee.fullNameEn, place: placeOfEmployee(e.employee), cells: days.map(() => null), daysOff: 0 };
      people.set(e.employee.id, person);
    }
    const waiting = isOpenLeave(e.status);
    days.forEach((d, i) => {
      if (d.date < e.startDate || d.date > e.endDate) return;
      const had = person!.cells[i];
      if (had && (!had.waiting || waiting)) return;
      person!.cells[i] = {
        typeName: e.type.nameEn,
        halfDay: e.halfDay,
        waiting,
        first: d.date === e.startDate || i === 0,
        last: d.date === e.endDate || i === days.length - 1,
        requestId: e.id ?? null,
      };
    });
  }
  const list = [...people.values()];
  for (const p of list) p.daysOff = p.cells.reduce((n, c) => n + (c ? (c.halfDay ? 0.5 : 1) : 0), 0);
  return list.filter((p) => p.daysOff > 0).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** How many are off on each day of the month (half days as halves), for the calendar's last row. */
export function offPerDay(people: readonly Pick<CalendarPerson, 'cells'>[], dayCount: number): number[] {
  return Array.from({ length: dayCount }, (_, i) => people.reduce((n, p) => n + (p.cells[i] ? (p.cells[i]!.halfDay ? 0.5 : 1) : 0), 0));
}

/** One person off on a day, as the phone's list of days says it. */
export interface AgendaPerson {
  id: string;
  name: string;
  place: string | null;
  typeName: string;
  halfDay: boolean;
  waiting: boolean;
  requestId: string | null;
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
        return c ? [{ id: p.id, name: p.name, place: p.place, typeName: c.typeName, halfDay: c.halfDay, waiting: c.waiting, requestId: c.requestId }] : [];
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
