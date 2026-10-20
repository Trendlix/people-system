import { countUntilProblems, formatHours, isFlexibleShift, parseHours, shiftHours, shiftWorkHours, type ShiftTimes } from '@trendlix/shared';
import { formatTime, parseTime } from './format';

// A shift as the screens say it (owner, 16 October 2026, on the MORNING shift of 9:00 AM to 7:00 PM: "my company shift
// is to maintain 9 hours within the shift window, its like flexible shift"): its window (start to end) and its hours to
// work a day, which may be fewer than the window: then it is flexible, worked anywhere within it. The hours to work are
// also the most attendance counts a day (owner, 16 October 2026: "maximum working hours to be recorded per day is 9
// hours between checkin and check out"), counted until the window's end plus the grace minutes (owner, 19 October 2026).
// A shift's "Count hours until" (owner, 20 October 2026: "within the same month with no working hours to be counted
// after 8 PM even if the check out was 11 PM"): set, hours count until then, past the hours to work, a long day filling
// short hours on the month's other days; the form's hint says so. Pure code, tested; relative imports, as vitest
// doesn't know the @/ paths.

/** A time of day ("HH:mm") so many minutes after another, past midnight round the clock. */
function minutesAfter(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + Math.round(minutes)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "9:00 AM – 7:00 PM · 9:00 hours, flexible"; a fixed shift "9:00 AM – 6:00 PM · 9:00 hours"; the times alone when its hours can't be told. */
export function shiftTimesText(shift: ShiftTimes): string {
  const times = `${formatTime(shift.startTime)} – ${formatTime(shift.endTime)}`;
  const hours = shiftWorkHours(shift);
  if (hours === null) return times;
  return `${times} · ${formatHours(hours)} hours${isFlexibleShift(shift) ? ', flexible' : ''}`;
}

/** A shift's hours to work a day as the shifts list shows them: "9:00 a day"; "—" when they can't be told. */
export function hoursADayText(shift: ShiftTimes): string {
  const hours = shiftWorkHours(shift);
  return hours === null ? '—' : `${formatHours(hours)} a day`;
}

/** What "Hours to work a day" says to start with: as set (9 → "9:00"), else empty (the whole window). */
export const hoursToWorkShown = (hoursPerDay: number | null | undefined) => (typeof hoursPerDay === 'number' ? formatHours(hoursPerDay) : '');

export const HOURS_TO_WORK_ERROR = 'Enter the hours to work a day as hours, e.g. 9 or 9:00, in half hours (8:30), or leave it empty for the whole shift.';

/**
 * "Hours to work a day" as typed, for the API: hours as 9, 9:00, 8:30 or 8.5 (Arabic-Indic digits too), in half hours
 * from 0:30; "" → null (the whole window). NaN when it isn't that.
 */
export function hoursToWorkFrom(typed: string): number | null {
  const latin = typed.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.').trim();
  if (latin === '') return null;
  const hours = parseHours(latin);
  return hours !== null && hours >= 0.5 && hours <= 24 && Number.isInteger(hours * 2) ? hours : NaN;
}

/** What the shift form's hint says about a shift as typed. */
export interface ShiftHint {
  /** True when the hours to work are more than the window, or hours count until a time before the end: what the API will refuse. */
  problem: boolean;
  text: string;
}

/** "15-minute", "1-minute": the grace as the hint names it. */
const graceText = (minutes: number) => `${minutes}-minute`;

/**
 * The shift form's live hint. The grace minutes move the end of the hours counted a day (owner, 19 October 2026: "grace
 * period means that if the employee checked in 10:15 he can check out till 7:15 and the 9 hours are counted"). A fixed
 * shift (hours to work the whole window, or not set): "Check-in after 9:15 AM counts as late. With the 15-minute grace,
 * the hours count until 6:15 PM."; a flexible one (fewer hours than the window): "Flexible: 9:00 hours anywhere between
 * 9:00 AM and 7:00 PM; with the 15-minute grace, check in by 10:15 AM and the day ends by 7:15 PM." (the latest check-in
 * is the end less the hours, plus the grace; without grace, "check in by 10:00 AM to work them."). With "Count hours
 * until" (owner, 20 October 2026), hours count until then (never before the end and the grace), the latest check-in is
 * that time less the hours, and time past them fills the month's short hours; one before the end is the problem the API
 * refuses. Times "HH:mm"; the hours to work null for the whole window; the limit null or missing for none. The general
 * rule while the times can't be read.
 */
export function shiftHint(shift: {
  startTime: string | null;
  endTime: string | null;
  graceMinutes: number | null;
  hoursPerDay: number | null;
  countUntil?: string | null;
}): ShiftHint {
  const grace = shift.graceMinutes !== null && shift.graceMinutes >= 0 ? Math.round(shift.graceMinutes) : 0;
  const window = shift.startTime && shift.endTime ? shiftHours(shift.startTime, shift.endTime) : null;
  if (!shift.startTime || !shift.endTime || window === null) {
    return { problem: false, text: 'Check-in after the start time plus the grace minutes counts as late.' };
  }
  const hours = shift.hoursPerDay ?? window;
  if (hours > window) return { problem: true, text: `The hours to work can't be more than the shift's window, ${formatHours(window)}.` };
  const until = shift.countUntil || null;
  const refused = until ? countUntilProblems({ startTime: shift.startTime, endTime: shift.endTime, countUntil: until }) : [];
  if (refused.length) return { problem: true, text: refused[0] };
  const graced = minutesAfter(shift.endTime, grace);
  const ends = formatTime(graced);
  // the time hours count until: the limit, never before the end and the grace (past midnight with them: theirs)
  const countsUntil = until && !(graced < shift.endTime.slice(0, 5) || graced > until) ? until : graced;
  const makeUp = until ? `Hours count until ${formatTime(countsUntil)}: time past the ${formatHours(hours)} hours fills short hours on the month's other days.` : null;
  const late = `Check-in after ${formatTime(minutesAfter(shift.startTime, grace))} counts as late.`;
  if (hours === window) {
    if (makeUp) return { problem: false, text: `${late} ${makeUp}` };
    return { problem: false, text: grace > 0 ? `${late} With the ${graceText(grace)} grace, the hours count until ${ends}.` : late };
  }
  const latest = formatTime(minutesAfter(shift.endTime, -hours * 60 + grace));
  const flexible = `Flexible: ${formatHours(hours)} hours anywhere between ${formatTime(shift.startTime)} and ${formatTime(shift.endTime)}`;
  if (makeUp) return { problem: false, text: `${flexible}; check in by ${formatTime(minutesAfter(countsUntil, -hours * 60))} to work them. ${makeUp}` };
  return {
    problem: false,
    text: grace > 0 ? `${flexible}; with the ${graceText(grace)} grace, check in by ${latest} and the day ends by ${ends}.` : `${flexible}; check in by ${latest} to work them.`,
  };
}

/**
 * The shift form's fields as typed: the times on the 12-hour clock ("9:00 AM"), the grace minutes, the hours to work,
 * and the time hours count until ("8:00 PM"; empty or missing: none).
 */
export interface TypedShift {
  startTime: string;
  endTime: string;
  graceMinutes: string;
  hoursPerDay: string;
  countUntil?: string;
}

export const COUNT_UNTIL_TIME_ERROR = 'Choose the hour, minutes and AM or PM of the time hours count until.';

/**
 * The live hint for the shift form as typed: shiftHint once the times can be read, or what is wrong with the hours to
 * work a day.
 */
export function typedShiftHint(typed: TypedShift): ShiftHint {
  const hours = hoursToWorkFrom(typed.hoursPerDay);
  if (Number.isNaN(hours)) return { problem: true, text: HOURS_TO_WORK_ERROR };
  const grace = typed.graceMinutes.trim() === '' ? 0 : Number(typed.graceMinutes);
  const until = parseTime(typed.countUntil ?? '');
  if (until === null) return { problem: true, text: COUNT_UNTIL_TIME_ERROR };
  return shiftHint({
    startTime: parseTime(typed.startTime) || null,
    endTime: parseTime(typed.endTime) || null,
    graceMinutes: Number.isFinite(grace) ? grace : 0,
    hoursPerDay: hours,
    countUntil: until || null,
  });
}

