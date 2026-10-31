// The Attendance section (owner, 19 October 2026: "is the attendance module active?", then "the attendance is not active
// in the side menu"): the days kept from Zoho People's imports (AttendanceDay, attendance-import.ts) read back for HR, the
// CEO and Finance (Daily Attendance, a person's month, the Summary by department and team), for a manager's team and
// for an employee's own month. What a kept day shows (its short hours against the shift, a check-in without a
// check-out), a month's figures, the filters of Daily Attendance, the Summary's period and its rows by department and
// team. Pure: the API works the figures out with these and the web shows the same words. Checking in on the system
// (owner, 19 October 2026: "Check-in through the system … to replace Zoho", check-in.ts): a day may come from the
// system's check-ins too, its place unknown and its check-ins flagged; a day has one source shown (a correction, the
// system's, a device's, Zoho's: SOURCE_PRECEDENCE), and from someone's first check-in on, a working day gone by with
// none is absent (monthDays). Make-up hours (owner, 20 October 2026: "within the same month with no working hours to be
// counted after 8 PM even if the check out was 11 PM"): on a shift that counts hours until a time a day may count more
// than the shift's hours a day; what it counts past them is its extra time (AttendanceDayView.extraHours), and a month's
// extra time fills its short hours (AttendanceFigures.shortHoursFilled), as the payroll counts the month's total. A day
// as the sum of its pairs (owner, 25 October 2026: "the working hours to be calculated between the checkin and out only,
// not the first and last"; "Count the closed pairs, flag the open one"): a day kept on the system keeps its check-in →
// check-out pairs, the break between them and an open last check-in; with an open last check-in its check-out is
// missing, and like any missing check-out the day is said apart until HR corrects it. Such a day counts half the shift
// (owner, 27 October 2026: "open check ins with half day"; asked, "Half the shift (4.5 h) until corrected", replacing 25
// October's "Not short until corrected", which counted the whole shift): its closed pairs' hours plus half the shift's
// hours a day, never more than the shift's hours a day (openCheckInHours), short by the rest, among the days counted, and
// the payroll takes the same hours (attendance-import.ts lineDayHours), so the pages, the payroll and the KPIs agree; a
// correction setting the check-out counts the day by its real pairs again. People exempt from check-in (owner, 25
// October 2026; check-in-exemptions.ts): an exempt day counts as full, never short, absent or missing a press.

import type { PressPair } from './attendance.js';
import type { AttendanceDayStatus } from './attendance-import.js';
import type { CorrectedFrom } from './attendance-corrections.js';
import { CHECK_IN_SOURCES, countsAsRemote, daysByPrecedence, isCheckInFlag, type AttendanceSource, type CheckInFlag, type DayPlace } from './check-in.js';
import type { DayOfficialDuty } from './official-duty.js';
import { dropsForChoice, type DaySourceChoice } from './attendance-records.js';

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
  /** Office or remote; a check-in on the system at the person's approved home, home; one whose location was refused or unavailable, unknown. */
  place: DayPlace | null;
  zohoStatus: string | null;
  /**
   * The day's permission hours as the month counts them (the owner's rule, 19 October 2026): the permission requests
   * approved in the system when the month has any, else Zoho's Permission column that day; 0 for none.
   */
  permissionHours: number;
  /** The hours it counts, by the shift's rule (attendance.ts hoursCountedForDay). */
  hoursCounted: number;
  /** Where it came from (none: Zoho's, as every day was before 19 October 2026's check-ins). */
  source?: AttendanceSource;
  /** A check-in on the system that broke its work arrangement's rule (CHECK_IN_FLAGS): kept, flagged. */
  flags?: readonly string[];
  /**
   * A correction approved (owner, 19 October 2026: "Attendance corrections with approval"): the day it was applied over,
   * kept as it was (null: no day on record), and the correction.
   */
  correctedFrom?: CorrectedFrom | null;
  correctionId?: string | null;
  /**
   * An official duty approved on the day (owner, 23 October 2026: "OD counted as attended"; official-duty.ts
   * withOfficialDuty): its request, a full day or its times, and the hours it counts by itself. None: no duty that day.
   */
  od?: DayOfficialDuty | null;
  /**
   * The day's finished check-in → check-out pairs, in order (owner, 25 October 2026: "the working hours to be calculated
   * between the checkin and out only, not the first and last"): a day kept on the system's check-ins, or corrected. Null
   * or missing: a day not kept by its pairs (Zoho's import, a day gone by without a press).
   */
  pairs?: readonly PressPair[] | null;
  /** A last check-in with no check-out after it (owner, 25 October 2026: "flag the open one"): its moment; null: none. */
  openAt?: string | null;
  /** The time between the pairs within the shift's window, in minutes; null or missing: not known. */
  breakMinutes?: number | null;
  /**
   * A working day of an exemption from check-in (owner, 25 October 2026: "trat them as if they achived their full working
   * hours"; check-in-exemptions.ts exemptDays): counted as full, its presses for reference only.
   */
  exempt?: boolean;
  /**
   * An approved work from home day without a check-in, counted as the shift's full hours (owner, 26 October 2026: "Full
   * day, always"; wfh.ts wfhFullDays): worked, never short, no press needed.
   */
  wfhDay?: boolean;
  /**
   * A compensatory day off approved (owner, 26 October 2026: "my compensatory is a compensation with another day in the
   * same month"; compensatory.ts compensatoryDays): read full as an exempt day is (also `exempt`), a paid day, shown
   * "Compensatory day off", never counted as an exempt day.
   */
  compensatory?: boolean;
  /**
   * A day worked that a compensatory request compensates (a rest day or an official holiday; "if the day is compensated
   * with a day, we pay nothing"): its check-ins kept, its hours left out of the month's worked hours.
   */
  compensated?: boolean;
  /**
   * Hours off approved on this working day for part of a rest day worked (owner, 27 October 2026: "Hours off for hours
   * worked"; compensatory.ts compensatoryDays): counted as worked, with no deduction for them.
   */
  compensatoryHours?: number;
}

/** A kept day as the Attendance pages show it. */
export interface AttendanceDayView extends KeptDay {
  /** The hours the shift asks a day worked (payroll.ts shiftWorkHours); null without a shift, or on a day not worked. */
  expectedHours: number | null;
  /** Short of the shift's hours on a day worked from check-in to check-out, after the day's permission; 0 otherwise. */
  shortHours: number;
  /**
   * Counted past the shift's hours a day on a day worked from check-in to check-out (owner, 20 October 2026: "within the
   * same month"; only a shift that counts hours until a time counts past them): extra time, which fills the month's
   * short hours; 0 otherwise.
   */
  extraHours: number;
  /**
   * A check-in without a check-out after it: a day with only a check-in, or a last check-in after the day's pairs (owner,
   * 25 October 2026: "flag the open one"). On the system's own attendance counted as half a day until corrected
   * (`openHalfDay`, 27 October 2026); Zoho's as its import counted it.
   */
  missingCheckOut: boolean;
  /**
   * Counted as half a day for its open check-in until corrected (owner, 27 October 2026: "open check ins with half day";
   * asked, "Half the shift (4.5 h) until corrected"): `hoursCounted` is its closed pairs' hours plus half the shift's
   * hours a day, within the shift's hours a day (openCheckInHours), and it is short by the rest.
   */
  openHalfDay: boolean;
  /** A check-out without a check-in (on the system): no hours counted that day. */
  missingCheckIn: boolean;
  /** The day's flags it knows (CHECK_IN_FLAGS). */
  flags: CheckInFlag[];
  /** Its pairs (none: not kept by pairs), its open last check-in and break, as kept (owner, 25 October 2026). */
  pairs: readonly PressPair[] | null;
  openAt: string | null;
  breakMinutes: number | null;
  /** Exempt from check-in that day (owner, 25 October 2026): full hours, nothing missing, never short. */
  exempt: boolean;
  /** A compensatory day off (26 October 2026): full hours as an exempt day, said apart. */
  compensatory: boolean;
  /** The day worked of a compensatory request (26 October 2026): its hours are not counted in the month. */
  compensated: boolean;
}

/**
 * Whether a day worked is missing its check-out: a check-in without a check-out after it, the day's only press or a last
 * check-in after its pairs (owner, 25 October 2026: "Count the closed pairs, flag the open one"). Never on a full day of
 * official duty (no press is needed: 23 October 2026) nor an exempt day (25 October 2026).
 */
export function missingCheckOutOn(day: Pick<KeptDay, 'status' | 'checkIn' | 'checkOut' | 'openAt' | 'od' | 'exempt'>): boolean {
  if (day.status !== 'worked' || day.od?.fullDay || day.exempt) return false;
  return !!day.openAt || (!!day.checkIn && !day.checkOut);
}

/**
 * Whether a day counts as half a day for its open check-in (owner, 27 October 2026: "open check ins with half day";
 * asked, "Half the shift (4.5 h) until corrected", replacing 25 October's "Not short until corrected"): a day worked on
 * the system's own attendance (a check-in on the system or a device, a correction; not Zoho's, whose hours are its
 * import's) missing its check-out (missingCheckOutOn). Until HR corrects it: a correction setting the check-out closes
 * the open check-in and the day counts by its real pairs again.
 */
export function openHalfDayOn(day: Pick<KeptDay, 'status' | 'checkIn' | 'checkOut' | 'openAt' | 'od' | 'exempt'> & { source?: string | null }): boolean {
  return (day.source ?? 'zoho') !== 'zoho' && missingCheckOutOn(day);
}

/**
 * The hours such a day counts until corrected: its closed pairs' hours (`pairsHours`, as the day keeps them) plus half
 * the shift's hours a day, never more than the shift's hours a day: on a 9-hour shift, a check-in alone 4:30, 3:00 of
 * pairs and an open check-in 7:30, 8:00 and one 9:00. Without the shift's hours, its pairs' hours alone.
 */
export function openCheckInHours(pairsHours: number, hoursADay: number | null | undefined): number {
  const hours = pairsHours > 0 ? pairsHours : 0;
  return typeof hoursADay === 'number' && hoursADay > 0 ? toMinute(Math.min(hoursADay, hours + hoursADay / 2)) : hours;
}

/**
 * A kept day with what it shows: a day whose hours are counted (countsDayHours) is short by the shift's hours a day
 * less the hours counted and the day's permission (never below 0), and has extra time when it counts more than the
 * shift's hours a day (owner, 20 October 2026: a shift that counts hours until a time); a check-in without a check-out
 * after it is a missing check-out (owner, 25 October 2026: "flag the open one"), on the system's own attendance counted
 * as half a day until corrected (owner, 27 October 2026: "open check ins with half day"; openCheckInHours: its pairs'
 * hours and half a day, within the shift's hours, short by the rest, no extra time), on Zoho's as its import counted it;
 * an exempt day (25 October 2026) is neither short nor extra, nothing missing; any other day is neither.
 */
export function attendanceDayView(day: KeptDay, hoursADay: number | null): AttendanceDayView {
  const worked = day.status === 'worked';
  // a full day of official duty (23 October 2026) needs no press at all, and an exempt day (25 October 2026) none either
  const noPress = !!day.od?.fullDay || !!day.exempt || !!day.wfhDay;
  const missingCheckOut = missingCheckOutOn(day);
  const missingCheckIn = worked && !day.checkIn && !!day.checkOut && !noPress;
  // an open check-in's day counts half the shift (27 October 2026): its pairs' hours and half a day, within the shift's
  const openHalfDay = openHalfDayOn(day);
  const hoursCounted = openHalfDay ? openCheckInHours(day.hoursCounted, hoursADay) : day.hoursCounted;
  const counted = countsDayHours(day) && !day.exempt;
  const expectedHours = worked && typeof hoursADay === 'number' && hoursADay > 0 ? hoursADay : null;
  const shortHours = counted && expectedHours !== null ? Math.max(0, toMinute(expectedHours - hoursCounted - Math.max(0, day.permissionHours))) : 0;
  const extraHours = counted && expectedHours !== null ? Math.max(0, toMinute(hoursCounted - expectedHours)) : 0;
  return {
    ...day,
    hoursCounted,
    expectedHours,
    shortHours,
    extraHours,
    missingCheckOut,
    openHalfDay,
    missingCheckIn,
    flags: day.exempt ? [] : (day.flags ?? []).filter(isCheckInFlag),
    pairs: day.pairs ?? null,
    openAt: day.openAt ?? null,
    breakMinutes: day.breakMinutes ?? null,
    exempt: !!day.exempt,
    compensatory: !!day.compensatory,
    compensated: !!day.compensated,
  };
}

/**
 * Whether a day's hours are counted (its short hours and extra time worked out, the average a day over it): a day worked
 * from check-in to check-out; a day on the system's own attendance missing its last check-out, counted as half a day
 * until corrected (owner, 27 October 2026: "open check ins with half day"; openHalfDayOn; Zoho's isn't, its hours being
 * its import's); an exempt day (25 October 2026: full hours); and a day of official duty (owner, 23 October 2026: "If
 * they forget, the approved hours still count as attended") but for part of a day with one press of two missing, said
 * apart as a missing press.
 */
export function countsDayHours(day: Pick<KeptDay, 'status' | 'checkIn' | 'checkOut' | 'od'> & Partial<Pick<KeptDay, 'openAt' | 'exempt' | 'wfhDay' | 'source'>>): boolean {
  if (day.status !== 'worked') return false;
  if (day.exempt || day.wfhDay) return true;
  if (openHalfDayOn(day)) return true;
  if (day.checkIn && day.checkOut && !day.openAt) return true;
  return !!day.od && (day.od.fullDay || (!day.checkIn && !day.checkOut));
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
  /** Counted past the shift's hours a day on the days counted (attendanceDayView; owner, 20 October 2026). */
  extraHours: number;
  /**
   * The short hours the extra time fills (owner, 20 October 2026: "within the same month"): each calendar month's extra
   * hours against its own short hours, at most them; never another month's.
   */
  shortHoursFilled: number;
  permissionHours: number;
  officeDays: number;
  remoteDays: number;
  /** Days on leave in the system. */
  leaveDays: number;
  /** Days Zoho marks as leave with no leave in the system: for HR to record there. */
  zohoLeaveDays: number;
  missingCheckOuts: number;
  /** Check-outs on the system without a check-in that day: no hours counted. */
  missingCheckIns: number;
  /** Days whose check-in on the system broke the work arrangement's rule (CHECK_IN_FLAGS). */
  flaggedDays: number;
  /** Days Zoho says present or on duty without a check-in: not absent, nor any hours. */
  noCheckInDays: number;
  holidays: number;
  restDays: number;
  /** Days exempt from check-in (owner, 25 October 2026): counted as full. */
  exemptDays: number;
  /** Compensatory days off (owner, 26 October 2026): counted as full paid days. */
  compensatoryDays: number;
}

export const NO_ATTENDANCE_FIGURES: Readonly<AttendanceFigures> = Object.freeze({
  daysRecorded: 0,
  daysWorked: 0,
  daysCounted: 0,
  hoursCounted: 0,
  absentDays: 0,
  shortHours: 0,
  extraHours: 0,
  shortHoursFilled: 0,
  permissionHours: 0,
  officeDays: 0,
  remoteDays: 0,
  leaveDays: 0,
  zohoLeaveDays: 0,
  missingCheckOuts: 0,
  missingCheckIns: 0,
  flaggedDays: 0,
  noCheckInDays: 0,
  holidays: 0,
  restDays: 0,
  exemptDays: 0,
  compensatoryDays: 0,
});

const FIGURE_KEYS = Object.keys(NO_ATTENDANCE_FIGURES) as (keyof AttendanceFigures)[];
const HOUR_KEYS: ReadonlySet<keyof AttendanceFigures> = new Set(['hoursCounted', 'shortHours', 'extraHours', 'shortHoursFilled', 'permissionHours']);

/**
 * A month's figures from its days. The permission hours are the days' (the system's requests', else Zoho's column),
 * within `permissionLimit` when it is given (Zoho's column counts within the month's allowance: attendance-import.ts),
 * or `permissionHours` when the month's are known otherwise (the system's requests of the month, days without a row
 * too). The short hours filled by extra time (owner, 20 October 2026: "within the same month") are worked out month by
 * month: a month's extra hours fill its own short hours, at most them.
 */
export function attendanceFigures(days: readonly AttendanceDayView[], options: { permissionLimit?: number | null; permissionHours?: number } = {}): AttendanceFigures {
  const f: AttendanceFigures = { ...NO_ATTENDANCE_FIGURES };
  let permission = 0;
  const byMonth = new Map<string, { extra: number; short: number }>();
  for (const d of days) {
    f.daysRecorded++;
    if (d.status === 'worked') {
      f.daysWorked++;
      // a day of official duty counts as one counted too (23 October 2026)
      if (countsDayHours(d)) f.daysCounted++;
      if (d.place === 'office') f.officeDays++;
      // a day at home counts as remote (owner, 20 October 2026: "Label Home, flag elsewhere")
      if (countsAsRemote(d.place)) f.remoteDays++;
      if (d.missingCheckOut) f.missingCheckOuts++;
      if (d.missingCheckIn) f.missingCheckIns++;
      if (d.flags.length) f.flaggedDays++;
      // an API from before exemptions (25 October 2026) has none
      if (d.compensatory) f.compensatoryDays++;
      else if (d.exempt) f.exemptDays++;
      f.hoursCounted += d.hoursCounted;
      f.shortHours += d.shortHours;
      // an API from before make-up hours (20 October 2026) has no extra time
      const extra = d.extraHours ?? 0;
      f.extraHours += extra;
      const month = byMonth.get(d.date.slice(0, 7)) ?? { extra: 0, short: 0 };
      byMonth.set(d.date.slice(0, 7), { extra: month.extra + extra, short: month.short + d.shortHours });
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
  for (const m of byMonth.values()) f.shortHoursFilled += Math.min(toMinute(m.extra), toMinute(m.short));
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
export const ATTENDANCE_FILTERS = ['absences', 'short_hours', 'missing_check_outs', 'remote', 'zoho_leave', 'flagged'] as const;
export type AttendanceFilter = (typeof ATTENDANCE_FILTERS)[number];

export const ATTENDANCE_FILTER_LABELS: Record<AttendanceFilter, string> = {
  absences: 'Only with absences',
  short_hours: 'Only with short hours',
  missing_check_outs: 'Only with missing check-outs',
  remote: 'Only with remote days',
  zoho_leave: 'Only with leave in Zoho only',
  // a check-in on the system that broke the work arrangement's rule (owner's brief, 19 October 2026: "flagged … for the
  // manager and HR to see on Daily Attendance")
  flagged: 'Only with flagged check-ins',
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
    case 'flagged':
      return f.flaggedDays > 0;
    default:
      return true;
  }
}

// ---------- a person's month from every source ----------

/** A kept day with where it came from: what monthDays merges. */
export interface SourcedDay extends KeptDay {
  source: AttendanceSource;
}

/** What a person's month of days is worked out from, besides their kept days. */
export interface MonthDaysContext {
  /** YYYY-MM. */
  month: string;
  /** Today in Cairo (YYYY-MM-DD): only the days before it can have gone by without a check-in. */
  today: string;
  /**
   * The first day they checked in on the system (or on a device), in any month; null: never. From it on, a working day
   * gone by with no day kept is absent; before it, only what Zoho's import kept counts.
   */
  checkInFrom: string | null;
  /** Their shift's working days (0 = Sunday); null: Sunday to Thursday. */
  workingDays: readonly number[] | null;
  /** The official holidays of the month, and the days of it they have approved leave in the system. */
  holidays: readonly string[];
  leaveDays: readonly string[];
  /** Their employment's first and last day (null: current, or none). */
  employedFrom: string | null;
  employedTo: string | null;
  /**
   * The days a Super Admin chose the source of (owner, 31 October 2026: "zoho or system"; attendance-records.ts): date →
   * the source the day uses, over the usual order for that day. None: the usual order.
   */
  chosen?: ReadonlyMap<string, DaySourceChoice> | null;
}

const SUN_TO_THU: readonly number[] = [0, 1, 2, 3, 4];
const nextDay = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * A person's days of a month, one a date (owner's brief, 19 October 2026): each date's kept day from the first source
 * there is (a correction, the system's check-ins, a device's, Zoho's import: SOURCE_PRECEDENCE); and from their first
 * check-in on the system on (`checkInFrom`), within the month and their employment, up to yesterday, each date with
 * none: an official holiday, a rest day of their shift, a day of approved leave, or else an absent day (a working day
 * gone by without a check-in), as source 'system'. Someone who never checked in on the system has only what Zoho's
 * import kept, as before. A day Zoho's import kept is read against the approved leave as it is now (withLeaveNow). In
 * date order.
 */
export function monthDays<D extends SourcedDay>(rows: readonly D[], ctx: MonthDaysContext): (D | SourcedDay)[] {
  const onLeave = new Set(ctx.leaveDays);
  // a day whose source a Super Admin chose (31 October 2026): the other source's day left out for it
  const chosen = ctx.chosen;
  const rowsChosen = chosen?.size ? rows.filter((r) => !dropsForChoice(r.source, chosen.get(r.date))) : rows;
  const days: (D | SourcedDay)[] = daysByPrecedence(rowsChosen.filter((r) => r.date.startsWith(ctx.month))).map((d) => withLeaveNow(d, onLeave.has(d.date)));
  if (!ctx.checkInFrom) return days;
  const first = `${ctx.month}-01`;
  const last = new Date(Date.UTC(Number(ctx.month.slice(0, 4)), Number(ctx.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  let from = ctx.checkInFrom > first ? ctx.checkInFrom : first;
  if (ctx.employedFrom && ctx.employedFrom > from) from = ctx.employedFrom;
  let to = last;
  if (ctx.employedTo && ctx.employedTo < to) to = ctx.employedTo;
  const known = new Set(days.map((d) => d.date));
  const holidays = new Set(ctx.holidays);
  const leave = new Set(ctx.leaveDays);
  const working = new Set(ctx.workingDays ?? SUN_TO_THU);
  for (let date = from; date <= to && date < ctx.today; date = nextDay(date)) {
    if (known.has(date)) continue;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const status: AttendanceDayStatus = holidays.has(date) ? 'holiday' : !working.has(weekday) ? 'rest' : leave.has(date) ? 'leave' : 'absent';
    days.push({ date, status, checkIn: null, checkOut: null, place: null, zohoStatus: null, permissionHours: 0, hoursCounted: 0, source: 'system', flags: [] });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A day Zoho's import kept, read against the approved leave as it is now (owner, 21 October 2026, after importing leave:
 * Zoho's attendance counts a day absent when its leave wasn't in it, and "a day covered by an approved leave … is never a
 * no-show, whatever the source"): a day without a check-in that was absent (or present without a check-in, or Zoho's own
 * leave) is leave once leave is approved on it, a half day's too (its other half has no hours: short hours, as any day
 * short, never a no-show). Once that leave is gone again (cancelled, or its import undone) the day is what it was kept as.
 * A day with a check-in, a holiday or a rest day, a day kept as leave, and every other source's day stay as they are: the
 * system's own days are worked out with the leave already (monthDays).
 */
export function withLeaveNow<D extends SourcedDay>(day: D, onLeave: boolean): D {
  if (!onLeave || day.source !== 'zoho' || day.checkIn) return day;
  return day.status === 'absent' || day.status === 'no_check_in' || day.status === 'zoho_leave' ? { ...day, status: 'leave' } : day;
}

/** Whether a source is one of the system's check-ins (CHECK_IN_SOURCES): from someone's first one on, missing days are absent. */
export const isCheckInSource = (source: string): boolean => (CHECK_IN_SOURCES as readonly string[]).includes(source);

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
