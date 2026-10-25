// Interviewers' availability (owner, 25 October 2026: "is it better for each interviewer to add his available interviews
// timeslots?"; recommended weekly interview hours set once, the conflicts taken away by the system; asked, they chose
// "Hours + calendar" and, for booking, "HR only"):
// - each interviewer sets weekly interview hours once (per weekday one or more ranges, in Cairo, from a date on), with
//   one-off changes (a day off from interviews, extra hours on a date), and may make the company's minimum notice and
//   buffer between interviews stricter, never looser;
// - taken away automatically: approved leave and official duty (waiting ones, and a half day, kept but marked "maybe"),
//   the public holidays (payroll's), for an in-person interview the days they work from home, their interviews already
//   booked with the buffer around each, and their calendar's busy times when one is read (Zoho, Google, Microsoft);
// - HR sees the times every chosen interviewer is free (starting on the quarter hour, grouped by day) and books one; the
//   candidate is only invited. A time typed by hand is saved all the same, with warnings, never refused.
// Someone's leave is only ever "unavailable", never its type; a C-level person's anything is "isn't free" to those who
// don't see C-level people; a calendar gives busy or free only, never an event's title. Every moment is worked out in
// Cairo's own time (zonedMoment), so the summer-time changes never move an hour; Cairo's offsets are whole hours, so a
// quarter hour there is a quarter hour everywhere. Pure code: the API reads the inputs and answers, the web shows them.
// Tested in apps/api/src/common/interview-availability.spec.ts.

import { zonedMoment } from './attendance.js';
import { cairoClock, cairoDay } from './check-in.js';
import type { InterviewKind } from './recruitment-hiring.js';

// ---------- the hours ----------

/** The weekdays as JavaScript numbers them (0 Sunday … 6 Saturday), in the order the week is shown: Sunday first. */
export const WEEKDAY_ORDER = [0, 1, 2, 3, 4, 5, 6] as const;
export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAY_SHORT_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** A weekly range: a weekday (0 Sunday … 6 Saturday) and its hours in Cairo, "HH:mm" on the quarter hour. */
export interface WeeklyWindow {
  day: number;
  from: string;
  to: string;
}

/** A one-off change: a day off from interviews, or extra hours on a date (Cairo). */
export const HOURS_CHANGE_KINDS = ['off', 'extra'] as const;
export type HoursChangeKind = (typeof HOURS_CHANGE_KINDS)[number];

export const HOURS_CHANGE_LABELS: Readonly<Record<HoursChangeKind, string>> = { off: 'Day off from interviews', extra: 'Extra hours' };

export interface HoursChange {
  /** YYYY-MM-DD. */
  date: string;
  kind: HoursChangeKind;
  /** Extra hours' range ("HH:mm"); null for a day off (the whole day). */
  from: string | null;
  to: string | null;
}

/** Someone's interview hours, as saved. */
export interface InterviewHours {
  windows: WeeklyWindow[];
  changes: HoursChange[];
  /** The weekly hours count from this day on (YYYY-MM-DD); before it, they have none. */
  effectiveFrom: string;
  /** Their own minimum notice, in hours, at least the company's; null: the company's. */
  noticeHours: number | null;
  /** Their own buffer between interviews, in minutes, at least the company's; null: the company's. */
  bufferMinutes: number | null;
}

/** The company's: the least notice an interview is booked with, and the buffer between one person's interviews. */
export interface InterviewDefaults {
  noticeHours: number;
  bufferMinutes: number;
}

/** The brief's defaults (25 October 2026): a day's notice, a quarter of an hour between interviews. */
export const INTERVIEW_DEFAULTS_STANDARD: InterviewDefaults = { noticeHours: 24, bufferMinutes: 15 };

export const INTERVIEW_HOURS_LIMITS = {
  rangesPerDay: 4,
  changes: 60,
  /** Two weeks. */
  noticeHoursMax: 336,
  bufferMinutesMax: 120,
  /** How far ahead a one-off change may be. */
  changeDaysAhead: 366,
} as const;

/** The lengths "Find a time" offers, in minutes. */
export const AVAILABILITY_LENGTHS = [30, 45, 60, 90] as const;
/** "Find a time"'s range: the next 14 days unless chosen, at most 31. */
export const AVAILABILITY_DAYS = { standard: 14, max: 31 } as const;
/** At most this many times are listed (the rest: "narrow the dates"). */
export const AVAILABILITY_SLOTS_MAX = 400;
/** How long a calendar is waited for, live, before "Couldn't check …" (the brief: "a 5-second limit"). */
export const CALENDAR_CHECK_MS = 5000;

const QUARTER_MS = 15 * 60_000;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "13:30" → 810; NaN for anything else. */
export function minutesOfDay(hhmm: string | null | undefined): number {
  const m = HHMM.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}

/** 810 → "13:30". */
export const hhmmOf = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** "13:30" → "1:30 PM". */
export function clock12(hhmm: string): string {
  const m = minutesOfDay(hhmm);
  if (!Number.isFinite(m)) return hhmm;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const isDay = (v: unknown): v is string => typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** The weekday a date is (0 Sunday … 6 Saturday). */
export const weekdayOf = (ymd: string): number => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/** A date `days` after another (YYYY-MM-DD). */
export const addDaysYmd = (ymd: string, days: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The days from `from` to `to`, both counted. */
export function datesFromTo(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= 400; d = addDaysYmd(d, 1)) out.push(d);
  return out;
}

/** "Sun 12:00 PM–3:00 PM" for a range. */
export const windowText = (w: { from: string; to: string }): string => `${clock12(w.from)}–${clock12(w.to)}`;

/** A range's problem in words, or null: "HH:mm" both, on the quarter hour, the end after the start. */
function rangeProblem(from: unknown, to: unknown, what: string): string | null {
  const a = minutesOfDay(typeof from === 'string' ? from : '');
  const b = minutesOfDay(typeof to === 'string' ? to : '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return `Give ${what} a start and an end time.`;
  if (a % 15 || b % 15) return `Start and end ${what} on the quarter hour (:00, :15, :30, :45).`;
  if (b <= a) return `End ${what} after it starts.`;
  return null;
}

/**
 * What is wrong with interview hours, each in words (none: they can be saved): the ranges (a weekday, on the quarter
 * hour, the end after the start, at most four a day, not overlapping), the one-off changes (a date from today on within
 * a year, a day off or extra hours with their range, never both on one date nor one twice), the date they count from,
 * and the notice and buffer, which may only be stricter than the company's (`defaults`).
 */
export function interviewHoursProblems(input: Partial<InterviewHours>, defaults: InterviewDefaults, today: string): string[] {
  const L = INTERVIEW_HOURS_LIMITS;
  const out: string[] = [];
  const windows = Array.isArray(input.windows) ? input.windows : [];
  if (!Array.isArray(input.windows)) out.push('Give the weekly hours (none is fine).');
  for (const day of WEEKDAY_ORDER) {
    const ranges = windows.filter((w) => w?.day === day);
    if (ranges.length > L.rangesPerDay) out.push(`Give ${WEEKDAY_LABELS[day]} at most ${L.rangesPerDay} ranges.`);
    const label = `${WEEKDAY_LABELS[day]}’s range`;
    const problems = ranges.map((w) => rangeProblem(w.from, w.to, label)).filter((p): p is string => !!p);
    if (problems.length) out.push(problems[0]);
    else {
      const sorted = [...ranges].sort((a, b) => minutesOfDay(a.from) - minutesOfDay(b.from));
      if (sorted.some((w, i) => i > 0 && minutesOfDay(w.from) < minutesOfDay(sorted[i - 1].to))) out.push(`${WEEKDAY_LABELS[day]}’s ranges overlap: join them into one.`);
    }
  }
  if (windows.some((w) => !w || !Number.isInteger(w.day) || w.day < 0 || w.day > 6)) out.push('Each range needs its weekday.');

  const changes = Array.isArray(input.changes) ? input.changes : [];
  if (input.changes !== undefined && !Array.isArray(input.changes)) out.push('Give the one-off changes as a list.');
  if (changes.length > L.changes) out.push(`Keep to ${L.changes} one-off changes: remove the ones you no longer need.`);
  const last = addDaysYmd(today, L.changeDaysAhead);
  const seen = new Map<string, HoursChangeKind>();
  for (const c of changes) {
    if (!c || !isDay(c.date)) {
      out.push('Give each one-off change its date.');
      continue;
    }
    if (c.date < today) out.push('A one-off change is for today or a later day.');
    else if (c.date > last) out.push('Give one-off changes within a year.');
    if (!(HOURS_CHANGE_KINDS as readonly string[]).includes(c.kind)) {
      out.push('Say whether each one-off change is a day off or extra hours.');
      continue;
    }
    if (c.kind === 'extra') {
      const p = rangeProblem(c.from, c.to, 'the extra hours');
      if (p) out.push(p);
    }
    const before = seen.get(c.date);
    if (before === 'off' || (before && c.kind === 'off')) out.push('A day off from interviews can’t have extra hours on it too, nor be given twice.');
    seen.set(c.date, before === 'off' ? 'off' : c.kind);
  }
  const extras = changes.filter((c) => c?.kind === 'extra' && isDay(c.date));
  for (const date of new Set(extras.map((c) => c.date))) {
    const sorted = extras.filter((c) => c.date === date).sort((a, b) => minutesOfDay(a.from) - minutesOfDay(b.from));
    if (sorted.some((c, i) => i > 0 && minutesOfDay(c.from) < minutesOfDay(sorted[i - 1].to))) out.push('Two extra hours on the same day overlap: join them into one.');
  }

  if (!isDay(input.effectiveFrom)) out.push('Give the day the weekly hours count from.');
  const notice = input.noticeHours;
  if (notice !== null && notice !== undefined) {
    if (!Number.isInteger(notice) || notice < 0 || notice > L.noticeHoursMax) out.push(`Give the notice in whole hours, up to ${L.noticeHoursMax} (two weeks).`);
    else if (notice < defaults.noticeHours) out.push(`Your notice can’t be shorter than the company’s ${noticeText(defaults.noticeHours)}.`);
  }
  const buffer = input.bufferMinutes;
  if (buffer !== null && buffer !== undefined) {
    if (!Number.isInteger(buffer) || buffer < 0 || buffer > L.bufferMinutesMax || buffer % 5) out.push(`Give the buffer in minutes, in fives, up to ${L.bufferMinutesMax}.`);
    else if (buffer < defaults.bufferMinutes) out.push(`Your buffer can’t be shorter than the company’s ${defaults.bufferMinutes} minutes.`);
  }
  return [...new Set(out)];
}

/** What is wrong with the company's defaults, in words. */
export function interviewDefaultsProblems(input: Partial<InterviewDefaults>): string[] {
  const L = INTERVIEW_HOURS_LIMITS;
  const out: string[] = [];
  const n = input.noticeHours;
  if (!(typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= L.noticeHoursMax)) out.push(`Give the minimum notice in whole hours, from 0 to ${L.noticeHoursMax} (two weeks).`);
  const b = input.bufferMinutes;
  if (!(typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= L.bufferMinutesMax && b % 5 === 0)) out.push(`Give the buffer between interviews in minutes, in fives, from 0 to ${L.bufferMinutesMax}.`);
  return out;
}

/** Interview hours as kept: ranges in weekday and time order, the one-off changes from today on, by date. */
export function tidyHours(input: InterviewHours, today: string): InterviewHours {
  const byTime = (a: { from: string | null }, b: { from: string | null }) => minutesOfDay(a.from) - minutesOfDay(b.from);
  return {
    windows: [...input.windows].map((w) => ({ day: w.day, from: w.from, to: w.to })).sort((a, b) => a.day - b.day || byTime(a, b)),
    changes: input.changes
      .filter((c) => c.date >= today)
      .map((c) => ({ date: c.date, kind: c.kind, from: c.kind === 'extra' ? c.from : null, to: c.kind === 'extra' ? c.to : null }))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? byTime(a, b) : a.kind === 'off' ? -1 : 1)),
    effectiveFrom: input.effectiveFrom,
    noticeHours: input.noticeHours ?? null,
    bufferMinutes: input.bufferMinutes ?? null,
  };
}

/** Someone's notice and buffer in effect: their own when set (never below the company's), else the company's. */
export function effectiveRules(hours: Pick<InterviewHours, 'noticeHours' | 'bufferMinutes'> | null, defaults: InterviewDefaults): InterviewDefaults {
  return {
    noticeHours: Math.max(defaults.noticeHours, hours?.noticeHours ?? 0),
    bufferMinutes: Math.max(defaults.bufferMinutes, hours?.bufferMinutes ?? 0),
  };
}

/** "24 hours", "1 hour", "2 days". */
export function noticeText(hours: number): string {
  if (hours >= 48 && hours % 24 === 0) return `${hours / 24} days`;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** The week in words, for the lists: "Sun 12:00 PM–3:00 PM · Tue 10:00 AM–12:00 PM"; null with none. */
export function hoursSummary(hours: Pick<InterviewHours, 'windows'> | null): string | null {
  if (!hours?.windows.length) return null;
  return WEEKDAY_ORDER.flatMap((d) =>
    hours.windows
      .filter((w) => w.day === d)
      .sort((a, b) => minutesOfDay(a.from) - minutesOfDay(b.from))
      .map((w) => `${WEEKDAY_SHORT_LABELS[d]} ${windowText(w)}`),
  ).join(' · ');
}

/**
 * Someone's interview hours on a date, as ranges of minutes in Cairo: the weekday's ranges (none on a public holiday),
 * plus the extra hours that date; none on a day off. Null: they have no hours that day (none set, or before the day
 * they count from), so their hours don't narrow anything.
 */
export function hoursOn(hours: InterviewHours | null, date: string, holiday = false): [number, number][] | null {
  if (!hours || date < hours.effectiveFrom) return null;
  const changes = hours.changes.filter((c) => c.date === date);
  if (changes.some((c) => c.kind === 'off')) return [];
  const ranges: [number, number][] = [
    ...(holiday ? [] : hours.windows.filter((w) => w.day === weekdayOf(date)).map((w): [number, number] => [minutesOfDay(w.from), minutesOfDay(w.to)])),
    ...changes.filter((c) => c.kind === 'extra').map((c): [number, number] => [minutesOfDay(c.from), minutesOfDay(c.to)]),
  ].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
  return merge(ranges);
}

// ---------- intervals of moments ----------

/** A stretch of time, in milliseconds since 1970 (UTC): [start, end). */
export type Span = [number, number];

function merge<T extends [number, number]>(spans: T[]): T[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: T[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]] as T);
  }
  return out;
}

/** The parts of `a` also in `b`. */
export function intersectSpans(a: Span[], b: Span[]): Span[] {
  const out: Span[] = [];
  for (const x of a) for (const y of b) if (Math.max(x[0], y[0]) < Math.min(x[1], y[1])) out.push([Math.max(x[0], y[0]), Math.min(x[1], y[1])]);
  return merge(out);
}

/** The parts of `a` outside every one of `cut`. */
export function subtractSpans(a: Span[], cut: Span[]): Span[] {
  let out = merge(a);
  for (const c of merge(cut)) {
    const next: Span[] = [];
    for (const x of out) {
      if (c[1] <= x[0] || c[0] >= x[1]) next.push(x);
      else {
        if (c[0] > x[0]) next.push([x[0], c[0]]);
        if (c[1] < x[1]) next.push([c[1], x[1]]);
      }
    }
    out = next;
  }
  return out;
}

const overlaps = (s: Span, start: number, end: number) => s[0] < end && s[1] > start;

/** A date's hours (minutes in Cairo) as moments. */
export const spansOn = (date: string, ranges: [number, number][]): Span[] => ranges.map(([a, b]) => [zonedMoment(date, hhmmOf(a)), zonedMoment(date, hhmmOf(b))]);

/** A whole date in Cairo, as moments: from its midnight to the next. */
export const wholeDay = (date: string): Span => [zonedMoment(date, '00:00'), zonedMoment(addDaysYmd(date, 1), '00:00')];

// ---------- what takes time away ----------

/**
 * What takes someone's time away, as the API reads it:
 * - away: approved leave or official duty, "is unavailable" (never its type);
 * - away_maybe: leave or official duty waiting for a decision, or a half day's leave (which half isn't kept): kept, marked;
 * - wfh, wfh_maybe: a day working from home (approved, or waiting), given only for an in-person interview;
 * - interview: another interview of theirs (`at` its start; the buffer is added here);
 * - calendar, calendar_maybe: their calendar busy, or tentative;
 * - hidden: anything of a C-level person's, for those who don't see C-level people: "isn't free", nothing more.
 */
export const BUSY_KINDS = ['away', 'away_maybe', 'wfh', 'wfh_maybe', 'interview', 'calendar', 'calendar_maybe', 'hidden'] as const;
export type BusyKind = (typeof BUSY_KINDS)[number];

const MAYBE: ReadonlySet<BusyKind> = new Set(['away_maybe', 'wfh_maybe', 'calendar_maybe']);

export interface BusyBlock {
  start: number;
  end: number;
  kind: BusyKind;
  /** An interview's start, for "has another interview at 2:30 PM". */
  at?: number;
}

/** Whether someone's calendar was read: checked, couldn't be (failed: the times are offered, marked), or none to read. */
export type CalendarCheck = 'checked' | 'failed' | 'none';

/** Someone on the panel, as the slots and the warnings are worked out for them. */
export interface PanelPerson {
  id: string;
  name: string;
  hours: InterviewHours | null;
  /** Their notice and buffer in effect (effectiveRules). */
  rules: InterviewDefaults;
  blocks: BusyBlock[];
  calendar: CalendarCheck;
}

/** A public holiday (payroll's), by its date. */
export interface HolidayDay {
  date: string;
  name: string;
}

/** Whom a time suits: free; maybe (waiting leave, a half day, a tentative event, or their calendar couldn't be checked); no hours set. */
export const SLOT_STATUSES = ['free', 'maybe', 'no_hours'] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export interface Slot {
  start: number;
  people: { id: string; status: SlotStatus }[];
  /** Someone on it is "maybe", or has no hours: shown marked. */
  marked: boolean;
}

export interface SlotDay {
  date: string;
  holiday: string | null;
  slots: Slot[];
}

/** The blocks that take time away for good (the maybes are only marked), the buffer around each interview added. */
function hardSpans(p: PanelPerson): Span[] {
  const buffer = p.rules.bufferMinutes * 60_000;
  return p.blocks.filter((b) => !MAYBE.has(b.kind)).map((b): Span => (b.kind === 'interview' ? [b.start - buffer, b.end + buffer] : [b.start, b.end]));
}

/**
 * The times every one of `people` is free for an interview of `minutes`, from `from` to `to` (Cairo dates), grouped by
 * day: inside the hours of everyone who has hours that day (those without narrow nothing, but a holiday is theirs too),
 * minus everyone's leave, duty, days from home (given only for an in-person one), interviews with their buffer and busy
 * calendar, from the longest notice on, starting on the quarter hour. Each time says who is free and who "maybe"; nobody
 * with hours that day: no times. At most AVAILABILITY_SLOTS_MAX (then `truncated`).
 */
export function findSlots(
  people: readonly PanelPerson[],
  q: { from: string; to: string; minutes: number; now: number; holidays: readonly HolidayDay[] },
): { days: SlotDay[]; truncated: boolean; noHours: boolean } {
  const holidays = new Map(q.holidays.map((h) => [h.date, h.name]));
  const length = q.minutes * 60_000;
  const earliest = Math.max(q.now, ...people.map((p) => q.now + p.rules.noticeHours * 3_600_000));
  const hard = new Map(people.map((p) => [p.id, hardSpans(p)]));
  const days: SlotDay[] = [];
  let count = 0;
  let truncated = false;
  for (const date of datesFromTo(q.from, q.to)) {
    const holiday = holidays.get(date) ?? null;
    const day: SlotDay = { date, holiday, slots: [] };
    days.push(day);
    const hoursToday = new Map(people.map((p) => [p.id, hoursOn(p.hours, date, !!holiday)]));
    const withHours = people.filter((p) => hoursToday.get(p.id) !== null);
    if (!withHours.length || truncated) continue;
    let common: Span[] = [wholeDay(date)];
    for (const p of withHours) common = intersectSpans(common, spansOn(date, hoursToday.get(p.id)!));
    for (const p of people) {
      common = subtractSpans(common, hard.get(p.id)!);
      // a holiday is everyone's: those without hours have no extra hours to keep them
      if (holiday && hoursToday.get(p.id) === null) common = subtractSpans(common, [wholeDay(date)]);
    }
    common = subtractSpans(common, [[Number.MIN_SAFE_INTEGER, earliest]]);
    for (const [a, b] of common) {
      for (let t = Math.ceil(a / QUARTER_MS) * QUARTER_MS; t + length <= b; t += QUARTER_MS) {
        if (count >= AVAILABILITY_SLOTS_MAX) {
          truncated = true;
          break;
        }
        const who = people.map((p) => ({ id: p.id, status: statusAt(p, hoursToday.get(p.id) ?? null, t, t + length) }));
        day.slots.push({ start: t, people: who, marked: who.some((w) => w.status !== 'free') });
        count++;
      }
      if (truncated) break;
    }
  }
  return { days, truncated, noHours: !people.some((p) => p.hours) };
}

function statusAt(p: PanelPerson, hours: [number, number][] | null, start: number, end: number): SlotStatus {
  if (hours === null) return 'no_hours';
  if (p.calendar === 'failed') return 'maybe';
  return p.blocks.some((b) => MAYBE.has(b.kind) && overlaps([b.start, b.end], start, end)) ? 'maybe' : 'free';
}

// ---------- the warnings of a time typed by hand ----------

/** The names the warnings use: each first name, or the full name where two on the panel share one. */
export function panelNames(people: readonly { id: string; name: string }[]): Map<string, string> {
  const first = (n: string) => n.trim().split(/\s+/)[0] || n;
  const counts = new Map<string, number>();
  for (const p of people) counts.set(first(p.name), (counts.get(first(p.name)) ?? 0) + 1);
  return new Map(people.map((p) => [p.id, counts.get(first(p.name))! > 1 ? p.name.trim() : first(p.name)]));
}

/** "Omar's", "Ahmed Hassan's", "Youssef's" (an s at the end takes "’s" too, as the pages write). */
const their = (name: string) => `${name}’s`;

/**
 * What HR is warned of for a time typed by hand (never a refusal: "people without hours, urgent cases"), in words, each
 * once, in the panel's order: a public holiday; then for each person, unavailable (approved leave or duty), maybe
 * unavailable (waiting, a half day), working from home (an in-person one), another interview at its time (with the
 * buffer), outside their interview hours (only when they have hours that day), their calendar busy or maybe busy, a
 * calendar that couldn't be checked, and sooner than their notice. A C-level person hidden from the caller: "isn't free
 * then", nothing more.
 */
export function slotWarnings(
  people: readonly PanelPerson[],
  start: number,
  minutes: number,
  q: { now: number; holidays: readonly HolidayDay[] },
): string[] {
  const end = start + minutes * 60_000;
  const date = cairoDay(start);
  const holiday = q.holidays.find((h) => h.date === date) ?? null;
  const names = panelNames(people);
  const out: string[] = [];
  if (holiday) out.push(`That day is a public holiday (${holiday.name}).`);
  for (const p of people) {
    const n = names.get(p.id) ?? p.name;
    const hit = (kinds: BusyKind[]) => p.blocks.filter((b) => kinds.includes(b.kind) && overlaps([b.start, b.end], start, end));
    const buffer = p.rules.bufferMinutes * 60_000;
    if (hit(['hidden']).length) {
      out.push(`${n} isn’t free then.`);
      continue;
    }
    if (hit(['away']).length) out.push(`${n} is unavailable then.`);
    else if (hit(['away_maybe']).length) out.push(`${n} may be unavailable then.`);
    if (hit(['wfh']).length) out.push(`${n} works from home that day.`);
    else if (hit(['wfh_maybe']).length) out.push(`${n} may work from home that day.`);
    const other = p.blocks
      .filter((b) => b.kind === 'interview' && overlaps([b.start - buffer, b.end + buffer], start, end))
      .sort((a, b) => a.start - b.start)[0];
    if (other) out.push(`${n} has another interview at ${cairoClock(other.at ?? other.start)}.`);
    const hours = hoursOn(p.hours, date, !!holiday);
    if (hours !== null && !spansOn(date, hours).some((s) => s[0] <= start && s[1] >= end)) out.push(`Outside ${their(n)} interview hours.`);
    if (hit(['calendar']).length) out.push(`${their(n)} calendar is busy.`);
    else if (hit(['calendar_maybe']).length) out.push(`${their(n)} calendar may be busy.`);
    if (p.calendar === 'failed') out.push(`Couldn’t check ${their(n)} calendar.`);
    if (start < q.now + p.rules.noticeHours * 3_600_000) out.push(`Sooner than ${their(n)} notice of ${noticeText(p.rules.noticeHours)}.`);
  }
  return [...new Set(out)];
}

// ---------- the API's answers ----------

/** GET /interview-hours/settings: the company's defaults, the standard ones, and who changed them last. */
export interface InterviewDefaultsView {
  defaults: InterviewDefaults;
  standard: InterviewDefaults;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

/** Someone's interview hours (null: none set), with the company's defaults the form checks against. */
export interface InterviewHoursView {
  employeeId: string;
  name: string;
  hours: InterviewHours | null;
  defaults: InterviewDefaults;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

/** An interview of theirs still to come, on their own page. */
export interface MyUpcomingInterview {
  id: string;
  startsAt: string;
  minutes: number;
  kind: InterviewKind;
  applicationId: string;
  candidate: string;
  job: string;
}

/** GET /me/interview-hours: one's own hours, their interviews to come, and whether the dashboard asks for hours. */
export interface MyInterviewHoursView extends InterviewHoursView {
  upcoming: MyUpcomingInterview[];
  needsHours: boolean;
}

/** GET /me/interview-hours/reminder: the dashboard's banner. */
export interface InterviewHoursReminder {
  show: boolean;
}

/** Why someone is on HR's list of interviewers. */
export const INTERVIEWER_REASONS = ['hiring_manager', 'panel', 'hours'] as const;
export type InterviewerReason = (typeof INTERVIEWER_REASONS)[number];
export const INTERVIEWER_REASON_LABELS: Readonly<Record<InterviewerReason, string>> = {
  hiring_manager: 'Hiring manager',
  panel: 'On an upcoming panel',
  hours: 'Has interview hours',
};

export interface InterviewerRow {
  employeeId: string;
  name: string;
  reasons: InterviewerReason[];
  /** hoursSummary of theirs; null: none set. */
  summary: string | null;
  updatedAt: string | null;
}

/** GET /interview-hours: the company's defaults and HR's list of the people who interview. */
export interface InterviewersView {
  settings: InterviewDefaultsView;
  people: InterviewerRow[];
}

/** POST /recruitment/availability: whom, how long, how it is held, which days; on a move, the interview moved. */
export interface AvailabilityInput {
  interviewerIds: string[];
  minutes: number;
  kind: InterviewKind;
  from: string;
  to: string;
  interviewId?: string | null;
}

/** Someone on the panel as "Find a time" and the warnings say: whether they have hours, and how their calendar was read. */
export interface AvailabilityPerson {
  employeeId: string;
  name: string;
  hasHours: boolean;
  calendar: CalendarCheck;
  /** The calendars read ("Zoho Calendar"); empty with none. */
  sources: string[];
  /** Their Google connection doesn't share busy times yet: "Reconnect to share your busy times". */
  reconnect: boolean;
}

export interface AvailabilitySlotView {
  /** ISO. */
  start: string;
  /** HH:mm in Cairo, as the form takes it. */
  time: string;
  people: { employeeId: string; status: SlotStatus }[];
  marked: boolean;
}

export interface AvailabilityDayView {
  date: string;
  holiday: string | null;
  slots: AvailabilitySlotView[];
}

export interface AvailabilityView {
  from: string;
  to: string;
  minutes: number;
  kind: InterviewKind;
  people: AvailabilityPerson[];
  days: AvailabilityDayView[];
  truncated: boolean;
  /** What the list leaves out or can't say, in words. */
  notes: string[];
}

/** POST /recruitment/availability/check: a time typed by hand. */
export interface TimeCheckInput {
  interviewerIds: string[];
  date: string;
  time: string;
  minutes: number;
  kind: InterviewKind;
  interviewId?: string | null;
}

export interface TimeCheckView {
  warnings: string[];
  people: AvailabilityPerson[];
}

/** The notes of "Find a time" (availabilityNotes). */
export function availabilityNotes(people: readonly AvailabilityPerson[], noHours: boolean, truncated: boolean): string[] {
  const names = panelNames(people.map((p) => ({ id: p.employeeId, name: p.name })));
  const out: string[] = [];
  if (noHours) out.push('None of them has set interview hours yet: type a time by hand, or ask them to set theirs.');
  else {
    const without = people.filter((p) => !p.hasHours).map((p) => names.get(p.employeeId)!);
    if (without.length) out.push(`${namesText(without)} ${without.length === 1 ? 'hasn’t' : 'haven’t'} set interview hours: their leave, interviews and calendar are checked, not their hours.`);
  }
  for (const p of people) if (p.calendar === 'failed') out.push(`Couldn’t check ${their(names.get(p.employeeId)!)} calendar: the times are offered all the same, marked.`);
  if (truncated) out.push(`Only the first ${AVAILABILITY_SLOTS_MAX} times are listed: choose fewer days to see the rest.`);
  return out;
}

/** "Ahmed", "Ahmed and Sara", "Ahmed, Sara and Omar". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What is wrong with "Find a time"'s question, in words. */
export function availabilityProblems(input: Partial<AvailabilityInput>, today: string): string[] {
  const out: string[] = [];
  const ids = Array.isArray(input.interviewerIds) ? input.interviewerIds : [];
  if (!ids.length) out.push('Choose who interviews them first.');
  else if (ids.length > 6) out.push('Choose at most 6 interviewers.');
  else if (new Set(ids).size !== ids.length) out.push('An interviewer is chosen twice.');
  if (!(AVAILABILITY_LENGTHS as readonly number[]).includes(input.minutes as number)) out.push('Choose the length: 30, 45, 60 or 90 minutes.');
  if (!isDay(input.from) || !isDay(input.to)) out.push('Choose the days to look in.');
  else if (input.to < input.from) out.push('The last day comes after the first.');
  else if (input.to < today) out.push('Choose days from today on.');
  else if (datesFromTo(input.from < today ? today : input.from, input.to).length > AVAILABILITY_DAYS.max) out.push(`Look at most ${AVAILABILITY_DAYS.max} days at a time.`);
  return out;
}
