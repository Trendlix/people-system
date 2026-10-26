// A person's attendance history on their profile (owner, 23 October 2026: "Attendance history on the profile. Since
// joining: on-time %, average check-in time, late days by weekday and trends; an Excel export"; the spec's §5: "period
// filter (this month / 3 months / year / since joining) with attendance rate, on-time %, average check-in, average
// hours/day, absences, leave/WFH/OD days, overtime, on-time trend (monthly or quarterly), check-in time distribution,
// late-days-by-weekday, daily log with filters (late, WFH, OD, leave) and Excel export. Each log row shows its source
// (System / Zoho import)"). Asked who sees it, the owner chose "HR, CEO and Finance only" (and the Super Admin; a C-level
// person's only the CEO and the Super Admin). The days are the attendance's own (attendance-days.ts monthDays, with the
// official duties: official-duty.ts), so the history counts as Daily Attendance and the payroll do. Claude's choices:
// - the days on record only: Zoho People's imports, the system's check-ins (and, from someone's first one, every
//   working day gone by), the corrections; a day before any record isn't absent, it isn't there;
// - since joining is from the first employment's join date; across a rehire, the days between two employments are left
//   out (neither expected nor absent);
// - on time is a check-in by the shift's start plus its grace minutes (the grace the system already uses), and late
//   minutes count from the shift's start; a day of official duty from the shift's start is on time with or without a
//   press; on a flexible shift a check-in past its start and grace is late here though the day's hours may still be full;
// - overtime is the system's own extra time: the hours a day counts past the shift's hours a day, which only a shift
//   that counts hours until a time counts (attendance-days.ts extraHours); the payroll doesn't pay overtime now.
// - a day as the sum of its pairs (owner, 25 October 2026: "the working hours to be calculated between the checkin and
//   out only, not the first and last"): the log shows its pairs, its break and an open last check-in; lateness is still by
//   the first check-in; a day missing its last check-out isn't counted towards the average until corrected;
// - a day exempt from check-in (owner, 25 October 2026: "trat them as if they achived their full working hours";
//   check-in-exemptions.ts) is Exempt: attended and on time, its full hours counted; its presses, kept for reference,
//   aren't in the average check-in nor its distribution.
// Pure: the API works the figures out with these and the web shows the same words.

import { shiftWindowOn, zonedMoment, type ShiftWindowTimes } from './attendance.js';
import { isFlexibleShift, shiftWorkHours } from './payroll.js';
import { countsDayHours, type AttendanceDayView } from './attendance-days.js';
import type { AttendanceDayStatus } from './attendance-import.js';
import type { PressPair } from './attendance.js';
import type { AttendanceSource } from './check-in.js';
import { odCoversStart } from './official-duty.js';

// ---------- the period ----------

/** The periods (the spec's §5): this month, the last 3 months, this year, since joining, or a range of days. */
export const HISTORY_PERIODS = ['this_month', 'last_3_months', 'this_year', 'since_joining', 'custom'] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

export const HISTORY_PERIOD_LABELS: Record<HistoryPeriod, string> = {
  this_month: 'This month',
  last_3_months: 'Last 3 months',
  this_year: 'This year',
  since_joining: 'Since joining',
  custom: 'Custom range',
};

export const isHistoryPeriod = (v: unknown): v is HistoryPeriod => (HISTORY_PERIODS as readonly unknown[]).includes(v);

/**
 * A period's days, to today (Cairo), never before they joined (`joinedOn`, their first employment's join date): this
 * month from its 1st; the last 3 months from the 1st of the month two before this one; this year from 1 January; since
 * joining from the join date; a custom range as given (its end at today at the latest). A custom range it can't read:
 * a problem instead.
 */
export function historyRange(period: HistoryPeriod, today: string, joinedOn: string | null, custom: { from?: string | null; to?: string | null } = {}): { from: string; to: string } | { problem: string } {
  let from: string;
  let to = today;
  if (period === 'this_month') from = `${today.slice(0, 7)}-01`;
  else if (period === 'last_3_months') from = `${monthsBefore(today.slice(0, 7), 2)}-01`;
  else if (period === 'this_year') from = `${today.slice(0, 4)}-01-01`;
  else if (period === 'since_joining') from = joinedOn ?? today;
  else {
    if (!isDate(custom.from) || !isDate(custom.to)) return { problem: 'Choose the first and the last day of the range, e.g. 2026-01-01 and 2026-06-30.' };
    if (custom.to < custom.from) return { problem: "The last day can't be before the first." };
    from = custom.from;
    to = custom.to < today ? custom.to : today;
  }
  if (joinedOn && from < joinedOn) from = joinedOn;
  if (to < from) to = from;
  return { from, to };
}

/** Whether the on-time trend is by quarter (owner's brief: "by quarter when the period is a year or more"): over 12 months. */
export const trendByQuarter = (range: { from: string; to: string }): boolean => monthIndex(range.to.slice(0, 7)) - monthIndex(range.from.slice(0, 7)) + 1 > 12;

// ---------- a day ----------

/** What a day was, as the log shows it (the brief: "Office / WFH / OD / Leave / Absent / Holiday"). */
export const HISTORY_MODES = ['office', 'remote', 'wfh', 'od', 'exempt', 'leave', 'absent', 'holiday', 'rest', 'no_check_in', 'zoho_leave'] as const;
export type HistoryMode = (typeof HISTORY_MODES)[number];

export const HISTORY_MODE_LABELS: Record<HistoryMode, string> = {
  office: 'Office',
  remote: 'Remote',
  wfh: 'Working from home',
  od: 'Official duty',
  exempt: 'Exempt',
  leave: 'Leave',
  absent: 'Absent',
  holiday: 'Holiday',
  rest: 'Rest day',
  no_check_in: 'Present, no check-in',
  zoho_leave: 'Leave in Zoho only',
};

/** Where a day came from, as the log says it (the spec: "System / Zoho import"; and Corrected). */
export const HISTORY_SOURCE_LABELS: Record<AttendanceSource, string> = { system: 'System', device: 'Attendance device', zoho: 'Zoho import', correction: 'Corrected' };

/** The log's filters (the brief: "late, WFH, OD, leave, absent"). */
export const HISTORY_FILTERS = ['late', 'wfh', 'od', 'leave', 'absent'] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export const HISTORY_FILTER_LABELS: Record<HistoryFilter, string> = { late: 'Late', wfh: 'Working from home', od: 'Official duty', leave: 'Leave', absent: 'Absent' };

export const isHistoryFilter = (v: unknown): v is HistoryFilter => (HISTORY_FILTERS as readonly unknown[]).includes(v);

/** A day as the history reads it: the attendance's day, and what the API knows of it besides. */
export type HistoryDayInput = Pick<AttendanceDayView, 'date' | 'status' | 'checkIn' | 'checkOut' | 'place' | 'hoursCounted' | 'extraHours' | 'od' | 'correctionId'> &
  Partial<Pick<AttendanceDayView, 'pairs' | 'openAt' | 'breakMinutes' | 'exempt'>> & {
  source: AttendanceSource;
  /** A work from home day approved for them (wfh.ts). */
  wfh: boolean;
  /** The shift of their employment that day, with its hours to work a day (a flexible shift's: fewer than its window); null: none. */
  shift: (ShiftWindowTimes & { hoursPerDay?: number | null }) | null;
  /** A working day of that shift (Sunday to Thursday without one) that isn't an official holiday. */
  scheduled: boolean;
};

/** A day of the log. */
export interface HistoryDay {
  date: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  mode: HistoryMode;
  status: AttendanceDayStatus;
  checkIn: string | null;
  checkOut: string | null;
  /** The hours it counts. */
  hours: number;
  /** Whether its hours count towards the average a day (attendance-days.ts countsDayHours). */
  counted: boolean;
  /** Minutes after the shift's start of a late check-in; 0 otherwise. */
  lateMinutes: number;
  /**
   * Checked in by the shift's start and grace, or on a flexible shift by the latest check-in that fits its hours (or on
   * official duty from the start); false: late; null: not measured.
   */
  onTime: boolean | null;
  /** A working day expected of them: a working day of their shift, not a holiday, not leave. */
  expected: boolean;
  /** Attended: an expected day worked (or Zoho's present without a check-in). */
  attended: boolean;
  /** Worked on a rest day or an official holiday. */
  offDay: boolean;
  /** The check-in's time, as minutes after midnight in Cairo (past 24 hours on a night shift's next day); null: none. */
  checkInMinutes: number | null;
  /** The system's extra time that day (attendance-days.ts extraHours): the overtime figure. */
  extraHours: number;
  source: AttendanceSource;
  /** The official duty's request (its page), and the correction's. */
  odRequestId: string | null;
  correctionId: string | null;
  /** Its check-in → check-out pairs (none: not kept by pairs), open last check-in and break (owner, 25 October 2026). */
  pairs: readonly PressPair[] | null;
  openAt: string | null;
  breakMinutes: number | null;
  /** Exempt from check-in that day (owner, 25 October 2026): full hours, on time. */
  exempt: boolean;
}

const EXPECTED_STATUSES: readonly AttendanceDayStatus[] = ['worked', 'absent', 'no_check_in'];

/** A day as the log shows it: what it was, whether expected and attended, on time or late, from where. */
export function historyDay(d: HistoryDayInput): HistoryDay {
  const weekday = new Date(`${d.date}T00:00:00Z`).getUTCDay();
  const expected = d.scheduled && EXPECTED_STATUSES.includes(d.status);
  const attended = expected && (d.status === 'worked' || d.status === 'no_check_in');
  const worked = d.status === 'worked';
  const exempt = worked && !!d.exempt;
  let mode: HistoryMode;
  if (worked) mode = d.od ? 'od' : exempt ? 'exempt' : d.wfh || d.place === 'home' ? 'wfh' : d.place === 'remote' ? 'remote' : 'office';
  else mode = d.status as HistoryMode;
  const midnight = zonedMoment(d.date, '00:00');
  // an exempt day's presses are for reference only (25 October 2026): not in the check-in times
  const checkInMinutes = d.checkIn && !exempt && Number.isFinite(midnight) ? Math.floor((Date.parse(d.checkIn) - midnight) / 60_000) : null;
  let onTime: boolean | null = null;
  let lateMinutes = 0;
  if (expected && worked) {
    // never late on an exempt day (25 October 2026), nor on official duty from the start
    if (exempt || (d.od && odCoversStart(d.date, d.od, d.shift))) onTime = true;
    else if (d.checkIn && d.shift) {
      const window = shiftWindowOn(d.date, d.shift);
      if (window) {
        const at = Date.parse(d.checkIn);
        const grace = Math.max(0, Math.round(d.shift.graceMinutes ?? 0)) * 60_000;
        // a flexible shift (its hours fewer than its window, worked anywhere in it): late only past the latest check-in
        // that still fits its hours before the window's end, grace and "Count hours until" included (owner, 26 October
        // 2026: "After the latest that fits 9 hours": 10:15 AM on the MORNING shift, 9 hours within 9:00 AM–7:15 PM),
        // late by the minutes past it; a fixed shift: past its start and grace, by the minutes past its start, as before
        const work = isFlexibleShift(d.shift) ? shiftWorkHours(d.shift) : null;
        const latest = work !== null ? window.end - Math.round(work * 3_600_000) : null;
        onTime = at <= (latest ?? window.start + grace);
        lateMinutes = onTime ? 0 : Math.floor((at - (latest ?? window.start)) / 60_000);
      }
    }
  }
  return {
    date: d.date,
    weekday,
    mode,
    status: d.status,
    checkIn: d.checkIn,
    checkOut: d.checkOut,
    hours: d.hoursCounted,
    counted: countsDayHours(d),
    lateMinutes,
    onTime,
    expected,
    attended,
    offDay: worked && !d.scheduled,
    checkInMinutes,
    extraHours: d.extraHours ?? 0,
    source: d.source,
    odRequestId: d.od?.requestId ?? null,
    correctionId: d.correctionId ?? null,
    pairs: d.pairs ?? null,
    openAt: d.openAt ?? null,
    breakMinutes: d.breakMinutes ?? null,
    exempt,
  };
}

/** Whether a day is listed under a filter of the log; none: every day. */
export function matchesHistoryFilter(d: Pick<HistoryDay, 'mode' | 'onTime'>, filter: HistoryFilter | null | undefined): boolean {
  switch (filter) {
    case 'late':
      return d.onTime === false;
    case 'wfh':
      return d.mode === 'wfh';
    case 'od':
      return d.mode === 'od';
    case 'leave':
      return d.mode === 'leave' || d.mode === 'zoho_leave';
    case 'absent':
      return d.mode === 'absent';
    default:
      return true;
  }
}

// ---------- the figures ----------

/** A period's figures (the brief), each defined in HISTORY_FIGURE_DEFINITIONS. Rates are fractions (0.95), null with none. */
export interface HistoryFigures {
  daysOnRecord: number;
  expectedDays: number;
  attendedDays: number;
  attendanceRate: number | null;
  /** Attended days whose start can be told: a check-in under a shift, or official duty from the start. */
  measuredDays: number;
  onTimeDays: number;
  lateDays: number;
  onTimeRate: number | null;
  /** Minutes after midnight (Cairo), on the attended days with a check-in; null: none. */
  averageCheckIn: number | null;
  /** Hours counted a day, over the days counted; null: none. */
  averageHours: number | null;
  hoursCounted: number;
  daysCounted: number;
  absences: number;
  leaveDays: number;
  zohoLeaveDays: number;
  wfhDays: number;
  odDays: number;
  /** Days exempt from check-in (owner, 25 October 2026). */
  exemptDays: number;
  /** The system's extra time (attendance-days.ts extraHours), the overtime figure. */
  extraHours: number;
  /** Days worked on a rest day or an official holiday. */
  offDaysWorked: number;
  /** The late days' minutes, together. */
  lateMinutes: number;
}

/** Each figure in a line, shown on hover or below it (the brief: "each with a one-line definition"). */
export const HISTORY_FIGURE_DEFINITIONS = {
  attendanceRate: 'Days attended ÷ working days expected: their shift’s working days, without official holidays, rest days and leave.',
  onTimeRate: 'Days checked in by the shift’s start and its grace minutes (or on official duty from the start) ÷ the days attended that can be told.',
  averageCheckIn: 'The average time of the first check-in, on the days attended with one.',
  averageHours: 'The hours counted by the shift’s rule ÷ the days counted (checked in and out, or on official duty).',
  absences: 'Working days gone by with no check-in, not on leave, not a holiday.',
  leaveDays: 'Days of approved leave in the system; Zoho’s own leave days are said apart.',
  wfhDays: 'Days worked from home: an approved work from home day, or checked in at their approved home.',
  odDays: 'Days on approved official duty, counted as attended for its hours.',
  extraHours: 'Hours counted past the shift’s hours a day, on a shift that counts hours until a time; the payroll doesn’t pay overtime now.',
  lateDays: 'Days attended with the first check-in after the shift’s start and its grace minutes; late minutes count from the start.',
} as const;

const NO_FIGURES: HistoryFigures = {
  daysOnRecord: 0,
  expectedDays: 0,
  attendedDays: 0,
  attendanceRate: null,
  measuredDays: 0,
  onTimeDays: 0,
  lateDays: 0,
  onTimeRate: null,
  averageCheckIn: null,
  averageHours: null,
  hoursCounted: 0,
  daysCounted: 0,
  absences: 0,
  leaveDays: 0,
  zohoLeaveDays: 0,
  wfhDays: 0,
  odDays: 0,
  exemptDays: 0,
  extraHours: 0,
  offDaysWorked: 0,
  lateMinutes: 0,
};

/** A period's figures from its days. */
export function historyFigures(days: readonly HistoryDay[]): HistoryFigures {
  const f: HistoryFigures = { ...NO_FIGURES };
  let checkInSum = 0;
  let checkIns = 0;
  for (const d of days) {
    f.daysOnRecord++;
    if (d.expected) f.expectedDays++;
    if (d.attended) {
      f.attendedDays++;
      if (d.checkInMinutes !== null) {
        checkInSum += d.checkInMinutes;
        checkIns++;
      }
    }
    if (d.onTime !== null) {
      f.measuredDays++;
      if (d.onTime) f.onTimeDays++;
      else {
        f.lateDays++;
        f.lateMinutes += d.lateMinutes;
      }
    }
    if (d.counted) {
      f.daysCounted++;
      f.hoursCounted += d.hours;
    }
    if (d.mode === 'absent') f.absences++;
    if (d.mode === 'leave') f.leaveDays++;
    if (d.mode === 'zoho_leave') f.zohoLeaveDays++;
    if (d.mode === 'wfh') f.wfhDays++;
    if (d.mode === 'od') f.odDays++;
    if (d.exempt) f.exemptDays++;
    if (d.offDay) f.offDaysWorked++;
    f.extraHours += d.extraHours;
  }
  f.attendanceRate = f.expectedDays ? f.attendedDays / f.expectedDays : null;
  f.onTimeRate = f.measuredDays ? f.onTimeDays / f.measuredDays : null;
  f.averageCheckIn = checkIns ? Math.round(checkInSum / checkIns) : null;
  f.hoursCounted = toMinute(f.hoursCounted);
  f.extraHours = toMinute(f.extraHours);
  f.averageHours = f.daysCounted ? toMinute(f.hoursCounted / f.daysCounted) : null;
  return f;
}

// ---------- the charts ----------

/** A point of the on-time trend: a month ("Oct 2026") or a quarter ("Q4 2026"). */
export interface HistoryTrendPoint {
  /** "2026-10" or "2026-Q4". */
  key: string;
  label: string;
  /** Its first and last day within the period. */
  from: string;
  to: string;
  measuredDays: number;
  onTimeDays: number;
  onTimeRate: number | null;
  expectedDays: number;
  attendedDays: number;
  attendanceRate: number | null;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The on-time trend (the brief: "by month, or by quarter when the period is a year or more"): every month (or quarter)
 * of the period, its on-time rate and attendance rate (null for one with no day measured or expected).
 */
export function historyTrend(days: readonly HistoryDay[], range: { from: string; to: string }): HistoryTrendPoint[] {
  const quarter = trendByQuarter(range);
  const keyOf = (date: string) => (quarter ? `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}` : date.slice(0, 7));
  const points = new Map<string, HistoryTrendPoint>();
  for (let m = range.from.slice(0, 7); m <= range.to.slice(0, 7); m = monthsBefore(m, -1)) {
    const key = keyOf(`${m}-01`);
    const first = `${m}-01` < range.from ? range.from : `${m}-01`;
    const last = lastOfMonth(m) > range.to ? range.to : lastOfMonth(m);
    const was = points.get(key);
    if (was) {
      was.to = last;
      continue;
    }
    const label = quarter ? `${key.slice(5)} ${key.slice(0, 4)}` : `${MONTHS_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
    points.set(key, { key, label, from: first, to: last, measuredDays: 0, onTimeDays: 0, onTimeRate: null, expectedDays: 0, attendedDays: 0, attendanceRate: null });
  }
  for (const d of days) {
    const p = points.get(keyOf(d.date));
    if (!p) continue;
    if (d.onTime !== null) {
      p.measuredDays++;
      if (d.onTime) p.onTimeDays++;
    }
    if (d.expected) p.expectedDays++;
    if (d.attended) p.attendedDays++;
  }
  for (const p of points.values()) {
    p.onTimeRate = p.measuredDays ? p.onTimeDays / p.measuredDays : null;
    p.attendanceRate = p.expectedDays ? p.attendedDays / p.expectedDays : null;
  }
  return [...points.values()];
}

/** A bin of the check-in time distribution: from a time (minutes after midnight), how many check-ins. */
export interface HistoryBin {
  from: number;
  /** "9:00 AM". */
  label: string;
  count: number;
}

/** The size of a bin (the brief: "15-minute bins"). */
export const HISTORY_BIN_MINUTES = 15;

/**
 * The check-in time distribution: the attended days' first check-ins by the 15 minutes they fall in, every bin from the
 * earliest to the latest (none between counted 0).
 */
export function checkInBins(days: readonly HistoryDay[], binMinutes = HISTORY_BIN_MINUTES): HistoryBin[] {
  const counts = new Map<number, number>();
  for (const d of days) {
    if (!d.attended || d.checkInMinutes === null) continue;
    const bin = Math.floor(d.checkInMinutes / binMinutes) * binMinutes;
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
  }
  if (!counts.size) return [];
  const keys = [...counts.keys()];
  const [lo, hi] = [Math.min(...keys), Math.max(...keys)];
  const out: HistoryBin[] = [];
  for (let b = lo; b <= hi; b += binMinutes) out.push({ from: b, label: clockText(b), count: counts.get(b) ?? 0 });
  return out;
}

/** A weekday's late days: of the days measured that weekday, how many were late. */
export interface HistoryWeekday {
  weekday: number;
  /** "Sun". */
  label: string;
  lateDays: number;
  measuredDays: number;
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Late days by weekday (the brief: "Sun–Thu, or the company's working days"): each of `workingDays` (their shifts'
 * working days in the period, Sunday first), with any other weekday that had a late day.
 */
export function lateByWeekday(days: readonly HistoryDay[], workingDays: readonly number[]): HistoryWeekday[] {
  const out = new Map<number, HistoryWeekday>();
  const add = (w: number) => out.get(w) ?? out.set(w, { weekday: w, label: WEEKDAY_SHORT[w], lateDays: 0, measuredDays: 0 }).get(w)!;
  for (const w of workingDays) add(w);
  for (const d of days) {
    if (d.onTime === null) continue;
    if (!d.onTime) add(d.weekday).lateDays++;
    if (out.has(d.weekday)) out.get(d.weekday)!.measuredDays++;
  }
  return [...out.values()].sort((a, b) => a.weekday - b.weekday);
}

// ---------- words ----------

/** Minutes after midnight as the 12-hour clock: 545 → "9:05 AM"; past 24 hours, the next day's ("1:10 AM"). */
export function clockText(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A rate as a whole percent: 0.953 → "95%"; null → "—". */
export const percentText = (rate: number | null): string => (rate === null ? '—' : `${Math.round(rate * 100)}%`);

/** The file a history is saved as: "Attendance history EMP-0182 2026-01-01 to 2026-10-23.xlsx". */
export const historyFileName = (code: string, range: { from: string; to: string }) => `Attendance history ${code} ${range.from} to ${range.to}.xlsx`;

// ---------- helpers ----------

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
/** The month `n` before (negative: after) a month. */
const monthsBefore = (m: string, n: number) => {
  const i = monthIndex(m) - n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};
const lastOfMonth = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const toMinute = (hours: number) => Math.round(hours * 60) / 60 + 0;
