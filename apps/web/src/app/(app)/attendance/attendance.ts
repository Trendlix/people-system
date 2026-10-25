import {
  ATTENDANCE_SOURCE_LABELS,
  attendancePeriod,
  breakText,
  cairoClock,
  CHECK_IN_FLAG_LABELS,
  CHECK_IN_FLAG_SHORT_LABELS,
  CHECK_IN_PLACE_LABELS,
  correctedFromText,
  EXEMPT_BADGE,
  EXEMPTION_LABEL,
  exemptionWhenText,
  formatHours,
  isAttendanceFilter,
  isCheckInFlag,
  openPressText,
  pairsText,
  PAYROLL_STATUS_LABELS,
  pressPlaceLabel,
  type AttendanceFigures,
  type AttendanceFilter,
  type AttendanceSource as DaySource,
  type CheckInFlag,
  type CheckInPlace,
  type CorrectedFrom,
  type ExemptionPeriod,
  type PayrollStatus,
  type PressPair,
  type Role,
} from '@trendlix/shared';
import type { AttendanceImportRow, AttendancePunchRow, AttendanceRunRef, AttendanceSource } from '../../../lib/attendance-types';
import { formatDateTime } from '../../../lib/format';
import { googleMapsHref } from '../../../lib/map-point';
import { hasRole } from '../../../lib/roles';
import { cairoTime } from '../payroll/[id]/attendance/attendance';
import { addMonths, monthName, monthOf, runHref } from '../payroll/list';
import { ATTENDANCE_IMPORT_PATH, ATTENDANCE_IMPORTS_PATH, ATTENDANCE_PATH, ATTENDANCE_SUMMARY_PATH } from './sections';

// The Attendance section (owner, 19 October 2026: "is the attendance module active?", then "the attendance is not active
// in the side menu"): the days kept from Zoho People's imports, for HR, the CEO and Finance (Daily Attendance, a
// person's month, Import, Import History, the Summary with Excel), a manager's team (My Team) and an employee's own (My
// Attendance). Plain helpers for the pages (no server-only, so they are unit tested): who sees what, the month, filters
// and period in the address and the links that keep them, the Import page's months (owner, the same day: "where am i
// going to import the sheets?"), and each figure in words. The API decides who sees whom; hiding is a convenience.
// Relative imports: the tests run without the "@/" alias. Checking in on the system (owner, 19 October 2026: "Check-in
// through the system (phone or web with the office location check, or a device) to replace Zoho"): a day comes from the
// system's check-ins too (or a correction, a device later), with where it came from, its flags and a check-out without a
// check-in; a month's missing check-ins and flagged days. Make-up hours (owner, 20 October 2026: "within the same month
// with no working hours to be counted after 8 PM even if the check out was 11 PM"): on a shift that counts hours until a
// time a day may count past the shift's hours a day, said "+1:30 extra", and the month says the short hours its extra
// time filled. Simpler rows (owner, 20 October 2026, of a row listing a dozen presses: "simplify this, i want to view if
// it is remote or office, and location link"): a day's check-in and check-out each with its place as a badge and a small
// Map link where it was pressed (for those the API gives the spot: HR, the CEO, the Super Admin, the employee), the
// flags in a word or two, and every press of the day in a collapsed "All presses (14)". A day as the sum of its pairs
// (owner, 25 October 2026: "the working hours to be calculated between the checkin and out only, not the first and
// last"; "Count the closed pairs, flag the open one"; "Not short until corrected"): a day of several check-in → check-out
// pairs lists them with its break, and an open last check-in says "Checked in 6:30 PM · not checked out" (dayPairs).
// People exempt from check-in (owner, 25 October 2026: "trat them as if they achived their full working hours"): an
// exempt day, a person's month with exempt days and its periods carry an "Exempt" badge (exemptBadge, exemptionsText).

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

/** Who sees the Attendance section: HR, the CEO and Finance (Finance read only). */
export const canSeeAttendance = (user: WithRoles) => hasRole(user, 'hr', 'ceo', 'finance');

/** Who imports attendance from Zoho People: HR (the API's upload is HR's). */
export const importsAttendance = (user: WithRoles) => hasRole(user, 'hr');

/** Who opens an import's review on its payroll run: HR and the CEO (the CEO applies the C-level people's lines). */
export const reviewsImports = (user: WithRoles) => hasRole(user, 'hr', 'ceo');

// ---------- the month, the filters and the period in the address ----------

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Whether this is a month as the address and the API take it: "2026-10", from 2000 to 2100. */
export function isAttendanceMonth(value: string): boolean {
  const m = MONTH.exec(value);
  return !!m && Number(m[1]) >= 2000 && Number(m[1]) <= 2100;
}

/** The month in the address (?month=YYYY-MM): this month (Cairo) unless it is one. */
export const readAttendanceMonth = (query: Query, today: string): string => (isAttendanceMonth(one(query.month)) ? one(query.month) : monthOf(today));

/** Daily Attendance's filters: a department or team, a person, "only with …". */
export interface AttendanceFilters {
  departmentId: string | null;
  employeeId: string | null;
  only: AttendanceFilter | null;
}

/** The filters in the address (?department=&employee=&only=); one it can't read is left out. */
export function readFilters(query: Query): AttendanceFilters {
  const department = one(query.department);
  const employee = one(query.employee);
  const only = one(query.only);
  return { departmentId: UUID.test(department) ? department : null, employeeId: UUID.test(employee) ? employee : null, only: isAttendanceFilter(only) ? only : null };
}

/** Whether any filter is chosen. */
export const filtered = (f: AttendanceFilters) => !!(f.departmentId || f.employeeId || f.only);

function withParams(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** Daily Attendance for a month and filters. */
export const dailyHref = (month: string, f: Partial<AttendanceFilters> = {}) =>
  withParams(ATTENDANCE_PATH, { month, department: f.departmentId, employee: f.employeeId, only: f.only });

/** A person's month (HR, the CEO, Finance). */
export const personHref = (employeeId: string, month: string) => withParams(`${ATTENDANCE_PATH}/${encodeURIComponent(employeeId)}`, { month });

/** Team Attendance, from My Team (a manager's or a lead's team). */
export const TEAM_ATTENDANCE_PATH = '/my-team/attendance';

/** The employee's own (My Attendance), and a manager's team's (My Team → Team Attendance). */
export const myAttendanceHref = (month: string) => withParams('/my-attendance', { month });
export const teamAttendanceHref = (month: string) => withParams(TEAM_ATTENDANCE_PATH, { month });

/** The Import page, with a month chosen. */
export const importHref = (month?: string | null) => withParams(ATTENDANCE_IMPORT_PATH, { month });

/** The API's reads. */
export const apiMonthPath = (month: string, f: Partial<AttendanceFilters> = {}) =>
  withParams('/attendance', { month, departmentId: f.departmentId, employeeId: f.employeeId, only: f.only });
export const apiPersonPath = (employeeId: string, month: string) => withParams(`/attendance/employees/${encodeURIComponent(employeeId)}`, { month });
export const apiMinePath = (month: string) => withParams('/attendance/me', { month });
export const apiImportsPath = (month?: string | null) => withParams('/attendance/imports', { month });

/** The Summary's period (?month=, or ?from=&to=): this month without one. */
export const readSummaryPeriod = (query: Query, today: string) => attendancePeriod({ month: one(query.month), from: one(query.from), to: one(query.to) }, today);

const periodParams = (p: { from: string; to: string }) => (p.from === p.to ? { month: p.from } : { from: p.from, to: p.to });

/** The Summary's address for a period: a month alone as ?month=. */
export const summaryHref = (p: { from: string; to: string }) => withParams(ATTENDANCE_SUMMARY_PATH, periodParams(p));
export const summaryExcelHref = (p: { from: string; to: string }) => withParams(`${ATTENDANCE_SUMMARY_PATH}/excel`, periodParams(p));
export const apiSummaryPath = (p: { from: string; to: string }) => withParams('/attendance/summary', periodParams(p));
export const apiSummaryExcelPath = (p: { from: string; to: string }) => withParams('/attendance/summary.xlsx', periodParams(p));

/** "October 2026", "January to June 2026", "November 2025 to October 2026". */
export function attendancePeriodTitle(p: { from: string; to: string }): string {
  if (p.from === p.to) return monthName(p.from);
  if (p.from.slice(0, 4) === p.to.slice(0, 4)) return `${monthName(p.from).split(' ')[0]} to ${monthName(p.to)}`;
  return `${monthName(p.from)} to ${monthName(p.to)}`;
}

/** The months the pickers offer, newest first: this month back two years, and the one chosen when it is outside them. */
export function attendanceMonthChoices(today: string, ...chosen: string[]): { value: string; label: string }[] {
  const now = monthOf(today);
  const months: string[] = [];
  for (let n = 0; n < 25; n++) months.push(addMonths(now, -n));
  for (const m of chosen) if (isAttendanceMonth(m) && !months.includes(m)) months.push(m);
  return months.sort((a, b) => b.localeCompare(a)).map((value) => ({ value, label: monthName(value) }));
}

/** The Summary's periods a click away: this month, last month, the last 3 months, this year so far. */
export function quickSummaryPeriods(today: string): { key: string; label: string; period: { from: string; to: string } }[] {
  const now = monthOf(today);
  return [
    { key: 'this-month', label: 'This month', period: { from: now, to: now } },
    { key: 'last-month', label: 'Last month', period: { from: addMonths(now, -1), to: addMonths(now, -1) } },
    { key: 'last-3', label: 'Last 3 months', period: { from: addMonths(now, -2), to: now } },
    { key: 'this-year', label: 'This year', period: { from: `${now.slice(0, 4)}-01`, to: now } },
  ];
}

// ---------- the figures in words ----------

/** Hours as the screens show them: "8:30"; a dash for none when `dashForNone`. */
export const hoursText = (hours: number | null | undefined, dashForNone = false) =>
  hours === null || hours === undefined || (dashForNone && hours === 0) ? '—' : formatHours(hours);

/** "1 day", "3 days". */
export const daysText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * A day's extra time (owner, 20 October 2026: counted past the shift's hours a day on a shift that counts hours until
 * a time): "+1:30 extra"; null without any, and from an API from before it.
 */
export const extraHoursText = (day: { extraHours?: number | null }): string | null =>
  typeof day.extraHours === 'number' && day.extraHours > 0 ? `+${formatHours(day.extraHours)} extra` : null;

/** The short hours a month's extra time filled (20 October 2026): "1:30 filled by extra time"; null without any. */
export const filledText = (f: { shortHoursFilled?: number | null }): string | null =>
  typeof f.shortHoursFilled === 'number' && f.shortHoursFilled > 0 ? `${formatHours(f.shortHoursFilled)} filled by extra time` : null;

/** A tile of a month's figures. */
export interface FigureTile {
  key: string;
  label: string;
  value: string;
  note: string | null;
  tone: 'danger' | 'warn' | null;
}

/**
 * A person's (or a list's) month at the top of its page: what they worked, were absent, short, on permission, on leave,
 * the missing check-outs; for someone who checks in on the system (`checksIn`; a list: anyone in it), or a month with
 * any, the check-outs without a check-in and the days whose check-in was flagged (19 October 2026).
 */
export function figureTiles(
  f: AttendanceFigures,
  o: { averageHours: number | null; hoursADay?: number | null; permissionFrom?: 'system' | 'zoho' | null; checksIn?: boolean },
): FigureTile[] {
  const permissionNote = o.permissionFrom === 'system' ? 'Approved in the system' : o.permissionFrom === 'zoho' ? "Zoho's, within the month's allowance" : null;
  return [
    { key: 'worked', label: 'Days worked', value: String(f.daysWorked), note: `${f.officeDays} at the office · ${f.remoteDays} remote`, tone: null },
    { key: 'hours', label: 'Hours counted', value: hoursText(f.hoursCounted), note: o.averageHours === null ? null : `${hoursText(o.averageHours)} a day on average`, tone: null },
    { key: 'absent', label: 'Absent days', value: String(f.absentDays), note: "The payroll's no-show days", tone: f.absentDays > 0 ? 'danger' : null },
    {
      key: 'short',
      label: 'Short hours',
      value: hoursText(f.shortHours),
      note: typeof o.hoursADay === 'number' ? `Against the shift's ${hoursText(o.hoursADay)} a day` : "Against the shift's hours a day",
      tone: f.shortHours > 0 ? 'warn' : null,
    },
    // make-up hours (owner, 20 October 2026: "within the same month"): only with extra time
    ...madeUpTiles(f),
    { key: 'permission', label: 'Permission hours', value: hoursText(f.permissionHours), note: permissionNote, tone: null },
    {
      key: 'leave',
      label: 'Leave days',
      value: String(f.leaveDays),
      note: f.zohoLeaveDays > 0 ? `And ${daysText(f.zohoLeaveDays)} of leave in Zoho only, to record` : 'On leave in the system',
      tone: f.zohoLeaveDays > 0 ? 'warn' : null,
    },
    // a last check-in without a check-out is never short until corrected (owner, 25 October 2026: "Not short until corrected")
    { key: 'checkouts', label: 'Missing check-outs', value: String(f.missingCheckOuts), note: 'A check-in without a check-out: not short until corrected', tone: f.missingCheckOuts > 0 ? 'warn' : null },
    // checking in on the system (19 October 2026); an API from before it has neither
    ...checkInTiles(f, o.checksIn === true),
    // exempt from check-in (25 October 2026): only with exempt days
    ...exemptTiles(f),
  ];
}

/** The month's exempt days (owner, 25 October 2026), once there is any (an API from before them has none). */
function exemptTiles(f: Partial<Pick<AttendanceFigures, 'exemptDays'>>): FigureTile[] {
  const n = typeof f.exemptDays === 'number' ? f.exemptDays : 0;
  if (!(n > 0)) return [];
  return [{ key: 'exempt', label: 'Exempt days', value: String(n), note: `${EXEMPTION_LABEL}: counted as full hours`, tone: null }];
}

/** The month's extra time and the short hours it filled, once there is any (an API from before 20 October 2026 has none). */
function madeUpTiles(f: Partial<Pick<AttendanceFigures, 'extraHours' | 'shortHoursFilled'>>): FigureTile[] {
  const extra = typeof f.extraHours === 'number' ? f.extraHours : 0;
  if (!(extra > 0)) return [];
  return [
    {
      key: 'filled',
      label: 'Short hours filled by extra time',
      value: hoursText(typeof f.shortHoursFilled === 'number' ? f.shortHoursFilled : 0),
      note: `${hoursText(extra)} of extra time this month, past the shift's hours a day`,
      tone: null,
    },
  ];
}

function checkInTiles(f: AttendanceFigures, checksIn: boolean): FigureTile[] {
  const missing = f.missingCheckIns ?? 0;
  const flagged = f.flaggedDays ?? 0;
  const tiles: FigureTile[] = [];
  if (checksIn || missing > 0) {
    tiles.push({ key: 'checkins', label: 'Missing check-ins', value: String(missing), note: 'A check-out without a check-in: no hours', tone: missing > 0 ? 'warn' : null });
  }
  if (checksIn || flagged > 0) {
    tiles.push({ key: 'flagged', label: 'Flagged days', value: String(flagged), note: "A check-in outside the work arrangement's rule, or on a fake GPS", tone: flagged > 0 ? 'warn' : null });
  }
  return tiles;
}

// ---------- a day's source and flags (checking in on the system, 19 October 2026) ----------

/**
 * Where a day came from, in words: "Zoho People", "Checked in on the system" (a working day gone by without a check-in
 * too: the system's), "Attendance device", "Corrected". A day without one (an API from before it) is Zoho's.
 */
export function daySourceText(day: { source?: string | null }): string {
  const source = (day.source ?? 'zoho') as DaySource;
  return ATTENDANCE_SOURCE_LABELS[source] ?? day.source ?? '';
}

/** A day's flags in words, the known ones once each: "Checked in outside the office on an office day". */
export const dayFlagTexts = (day: { flags?: readonly string[] | null }): string[] => [...new Set((day.flags ?? []).filter(isCheckInFlag))].map((f) => CHECK_IN_FLAG_LABELS[f]);

/** A day's check-in cell: its time, "Missing" (a check-out without a check-in, in amber), or none. */
export function checkInCell(day: { checkIn: string | null; missingCheckIn?: boolean }): 'time' | 'missing' | 'none' {
  if (day.checkIn) return 'time';
  return day.missingCheckIn ? 'missing' : 'none';
}

/**
 * A corrected day's note (owner, 19 October 2026: "Attendance corrections with approval": the original times kept and
 * shown as "corrected from …"): "Corrected from 9:30 AM – no check-out"; null for a day not corrected.
 */
export function correctedNote(day: { source?: string | null; correctedFrom?: CorrectedFrom | null }): string | null {
  return day.source === 'correction' ? correctedFromText(day.correctedFrom ?? null) : null;
}

// ---------- a day's presses (owner, 20 October 2026: "simplify this, i want to view if it is remote or office, and
// location link") ----------

/** A press of Check in or Check out as the Attendance pages list it (lib/attendance-types.ts AttendancePunchRow). */
export type PunchRow = AttendancePunchRow;

const moment = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** A day's presses (owner's brief, 19 October 2026: "Several presses a day are kept as punches"), in the order pressed. */
export const dayPunches = (punches: readonly PunchRow[], date: string): PunchRow[] =>
  punches.filter((p) => p.date === date).sort((a, b) => moment(a.at) - moment(b.at));

/** The presses a day's check-in and check-out are: the check-in at its moment, the check-out at its; none for a time no press made (Zoho's, a correction's). */
export function dayEnds(day: { checkIn: string | null; checkOut: string | null }, presses: readonly PunchRow[]): { checkIn: PunchRow | null; checkOut: PunchRow | null } {
  const at = (kind: string, iso: string | null) => (iso ? (presses.find((p) => p.kind === kind && moment(p.at) === moment(iso)) ?? null) : null);
  return { checkIn: at('in', day.checkIn), checkOut: at('out', day.checkOut) };
}

/** Whether a day's row lists "All presses (N)": when it has presses besides the check-in and check-out it shows. */
export const morePresses = (presses: readonly PunchRow[], ends: { checkIn: PunchRow | null; checkOut: PunchRow | null }): boolean =>
  presses.length > (ends.checkIn ? 1 : 0) + (ends.checkOut ? 1 : 0);

/** The disclosure's summary: "All presses (14)". */
export const allPressesLabel = (count: number): string => `All presses (${count})`;

/** A press in the list: "In 4:58 PM", "Out 7:35 PM". */
export const pressLabel = (p: Pick<PunchRow, 'kind' | 'at'>): string => `${p.kind === 'out' ? 'Out' : 'In'} ${cairoClock(p.at)}`;

/** A press for a screen reader: "the check-in at 4:58 PM". */
export const pressName = (p: Pick<PunchRow, 'kind' | 'at'>): string => `the ${p.kind === 'out' ? 'check-out' : 'check-in'} at ${cairoClock(p.at)}`;

/** A place as a badge: its word, its colour, and (at the office) the location or network it was matched to. */
export interface PlaceBadge {
  label: string;
  tone: 'ok' | 'accent' | 'muted';
  title: string | null;
}

/**
 * Where a press (or, without one, a day: Zoho's, a correction's) was, as a badge: Office, Home, Remote, Location
 * unknown; at the office, the location's or the office network's name as its title. Within a sub-location (a remote
 * press with its location's name; owner, 20 October 2026: "named with the location name (Remote - Location name)"),
 * "Remote - Studio". None without a place.
 */
export function placeBadge(place: string | null | undefined, press?: Pick<PunchRow, 'locationName' | 'officeNetwork' | 'locationKind'> | null): PlaceBadge | null {
  if (!place) return null;
  const sub = place === 'remote' ? press?.locationName?.trim() || null : null;
  // within a client location or their remote site (24 October 2026): "Client · Acme", "Remote site · Flat"
  const kind = sub ? (press?.locationKind ?? null) : null;
  const label = sub ? pressPlaceLabel(place, sub, kind) : (CHECK_IN_PLACE_LABELS[place as CheckInPlace] ?? place);
  const tone = place === 'office' ? 'ok' : place === 'unknown' ? 'muted' : 'accent';
  const title =
    place === 'office'
      ? (press?.locationName ?? (press?.officeNetwork ? `On the office network: ${press.officeNetwork}` : null))
      : sub
        ? kind === 'client'
          ? `Remote, at the client location ${sub}`
          : kind === 'remote_site'
            ? `Remote, at their remote site ${sub}`
            : `Remote, at the sub-location ${sub}`
        : null;
  return { label, tone, title };
}

/**
 * The Map link of a press, where the API gives its spot (HR, the CEO, the Super Admin, the employee): Google Maps at its
 * point, its title the reading's accuracy ("Within 12 m"); an old office press's location point says so. None without
 * a point (a press without a location, or the spot not given to the caller).
 */
export function punchMap(p: Pick<PunchRow, 'latitude' | 'longitude' | 'accuracyMetres' | 'pointFrom' | 'locationName'>): { href: string; title: string } | null {
  if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number' || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null;
  const href = googleMapsHref({ latitude: p.latitude, longitude: p.longitude });
  if (p.pointFrom === 'location') return { href, title: `${p.locationName ?? 'The check-in location'}’s point: the spot itself wasn’t kept then` };
  const metres = typeof p.accuracyMetres === 'number' && p.accuracyMetres >= 0 ? Math.round(p.accuracyMetres) : null;
  return { href, title: metres === null ? 'Accuracy not known' : `Within ${metres.toLocaleString('en-US')} m` };
}

/** A flag as a compact badge: a word or two, the full words as its title (owner, 20 October 2026: "simplify this"). */
export interface FlagBadge {
  key: CheckInFlag;
  label: string;
  title: string;
}

const knownFlags = (flags: readonly string[] | null | undefined): CheckInFlag[] => [...new Set((flags ?? []).filter(isCheckInFlag))];

/** Flags as compact badges, the known ones once each: "No location", titled "Location unknown on an office day". */
export const flagBadges = (flags: readonly string[] | null | undefined): FlagBadge[] =>
  knownFlags(flags).map((f) => ({ key: f, label: CHECK_IN_FLAG_SHORT_LABELS[f], title: CHECK_IN_FLAG_LABELS[f] }));

/**
 * Which of a day's flags go by its check-in and which by its check-out: by the check-out those of its own press (fake
 * GPS suspected, the one a check-out has), by the check-in all the others (its own, and a later check-in's).
 */
export function endFlags(day: { flags?: readonly string[] | null }, ends: { checkIn: PunchRow | null; checkOut: PunchRow | null }): { checkIn: CheckInFlag[]; checkOut: CheckInFlag[] } {
  const all = knownFlags(day.flags);
  const own = knownFlags(ends.checkIn?.flags);
  const checkOut = knownFlags(ends.checkOut?.flags).filter((f) => all.includes(f));
  return { checkIn: all.filter((f) => !checkOut.includes(f) || own.includes(f)), checkOut };
}

/** What a day's check-in or check-out cell shows. */
export interface DayEnd {
  /** Its time ("4:58 PM"), "Missing" (a check-in without a check-out, or the other way), or none. */
  shown: 'time' | 'missing' | 'none';
  time: string;
  /** The press it is, when one made it (none for Zoho's day or a correction's time). */
  press: PunchRow | null;
  badge: PlaceBadge | null;
  flags: CheckInFlag[];
}

/**
 * A day's row from its presses: the check-in's time, place and flags (the day's own place on a day no press made: Zoho's,
 * a correction's), the check-out's time, place and flags; the day's presses, and whether there are more than these two.
 */
export function dayRow(
  day: { date: string; checkIn: string | null; checkOut: string | null; place?: string | null; flags?: readonly string[] | null; missingCheckIn?: boolean; missingCheckOut?: boolean },
  punches: readonly PunchRow[],
): { checkIn: DayEnd; checkOut: DayEnd; presses: PunchRow[]; more: boolean } {
  const presses = dayPunches(punches, day.date);
  const ends = dayEnds(day, presses);
  const flags = endFlags(day, ends);
  return {
    checkIn: {
      shown: day.checkIn ? 'time' : day.missingCheckIn ? 'missing' : 'none',
      time: cairoTime(day.checkIn),
      press: ends.checkIn,
      badge: day.checkIn ? placeBadge(ends.checkIn?.place ?? day.place, ends.checkIn) : null,
      flags: flags.checkIn,
    },
    checkOut: {
      shown: day.checkOut ? 'time' : day.missingCheckOut ? 'missing' : 'none',
      time: cairoTime(day.checkOut),
      press: ends.checkOut,
      badge: ends.checkOut ? placeBadge(ends.checkOut.place, ends.checkOut) : null,
      flags: flags.checkOut,
    },
    presses,
    more: morePresses(presses, ends),
  };
}

// ---------- a day's pairs (owner, 25 October 2026: "the working hours to be calculated between the checkin and out
// only, not the first and last") ----------

/** A day's pairs as its row shows them: the pairs, the break between them, and an open last check-in. */
export interface DayPairs {
  /** "9:02 AM–1:10 PM · 2:00 PM–6:05 PM". */
  pairs: string;
  /** "Break 50 min"; null with none. */
  break: string | null;
  /** "Checked in 6:30 PM · not checked out" (owner, 25 October 2026: "flag the open one"); null without one. */
  open: string | null;
}

/**
 * What a day's row adds for its pairs: a day of several pairs, or one with a last check-in after them and no check-out,
 * lists the pairs, the break and the open check-in; a day of one pair, a day with only a check-in (its check-out shows
 * Missing, as before) and a day not kept by pairs (Zoho's, an API from before them) add nothing.
 */
export function dayPairs(day: { pairs?: readonly PressPair[] | null; openAt?: string | null; breakMinutes?: number | null }): DayPairs | null {
  const pairs = day.pairs ?? [];
  const open = pairs.length > 0 && !!day.openAt;
  if (pairs.length < 2 && !open) return null;
  return { pairs: pairsText(pairs), break: breakText(day.breakMinutes), open: open ? openPressText(day.openAt!) : null };
}

// ---------- exempt from check-in (owner, 25 October 2026: "trat them as if they achived their full working hours") ----------

/** The badge, and what it says on hover and to a screen reader. */
export const EXEMPT_DAY_TITLE = `${EXEMPTION_LABEL}: counted as full hours; any presses are kept for reference only`;

/** The "Exempt" badge of a day, or of a person's month with exempt days; null for anything else. */
export function exemptBadge(of: { exempt?: boolean | null; exemptDays?: number | null }): { label: string; title: string } | null {
  const on = !!of.exempt || (typeof of.exemptDays === 'number' && of.exemptDays > 0);
  return on ? { label: EXEMPT_BADGE, title: EXEMPT_DAY_TITLE } : null;
}

/** "3 exempt days", "1 exempt day"; null with none (an API from before them has none). */
export function exemptDaysText(f: { exemptDays?: number | null }): string | null {
  const n = typeof f.exemptDays === 'number' ? f.exemptDays : 0;
  return n > 0 ? `${n} exempt ${n === 1 ? 'day' : 'days'}` : null;
}

/**
 * A person's month's periods exempt from check-in, said once at its top: "Exempt from check-in: from 01/11/2026 until
 * 30/11/2026"; null with none (an API from before them has none).
 */
export function exemptionsText(periods: readonly ExemptionPeriod[] | null | undefined): string | null {
  if (!periods?.length) return null;
  return `${EXEMPTION_LABEL}: ${periods.map((p) => exemptionWhenText(p).replace(/^From/, 'from')).join('; ')}`;
}

// ---------- where the days came from ----------

/** "Read 19/10/2026, 5:42 PM by Hazem Magdy · applied 19/10/2026, 6:00 PM by Hazem Magdy · everyone.xlsx". */
export function sourceText(s: AttendanceSource): string {
  const read = `Read ${formatDateTime(s.createdAt)}${s.createdBy ? ` by ${s.createdBy}` : ''}`;
  const applied = s.appliedAt ? `applied ${formatDateTime(s.appliedAt)}${s.appliedBy ? ` by ${s.appliedBy}` : ''}` : 'not applied since';
  const files = s.files.length ? (s.files.length <= 3 ? s.files.join(', ') : `${s.files.length} files`) : null;
  return [read, applied, files].filter(Boolean).join(' · ');
}

/** What a month without days says: no one checked in on the system, nor is Zoho People's attendance imported. */
export const noAttendanceText = (month: string) =>
  `No attendance for ${monthName(month)} yet: no one has checked in on the system, and Zoho People's attendance isn't imported — import it on the month's payroll run.`;

/** What a month without days says to someone who doesn't import it: an employee, a manager. */
export const notImportedYetText = (month: string) =>
  `No attendance for ${monthName(month)} yet. Check-ins on the system show here as they are made, and HR imports Zoho People's attendance with the month's payroll.`;

/** The month's payroll run, or Payroll when it has none. */
export const runWay = (month: string, run: AttendanceRunRef | null): { href: string; label: string } =>
  run ? { href: runHref(run.id), label: `Open the ${monthName(month)} payroll` } : { href: '/payroll', label: 'Payroll' };

/**
 * Where a month without days points: HR to the Import page with the month chosen (it uses the month's draft run, or
 * makes one); the CEO and Finance to the month's run, or Payroll when there is none (runWay, HR's second way too).
 */
export function importWay(user: WithRoles, month: string, run: AttendanceRunRef | null): { href: string; label: string } {
  if (importsAttendance(user)) return { href: importHref(month), label: `Import ${monthName(month)}'s attendance` };
  return runWay(month, run);
}

// ---------- the Import page ----------

/** A run as GET /payroll/runs lists it: enough to know what a month's import does. */
export interface RunOfMonth {
  id: string;
  month: string;
  status: PayrollStatus;
}

/** What importing a month does: upload into its draft run, make the run first, or nothing (locked). */
export type ImportTarget = { kind: 'upload'; runId: string } | { kind: 'create' } | { kind: 'locked'; runId: string; status: PayrollStatus };

/** The month's run decides it: a draft takes the files; no run yet, one is made first; any other is locked. */
export function importTarget(month: string, runs: readonly RunOfMonth[]): ImportTarget {
  const run = runs.find((r) => r.month === month);
  if (!run) return { kind: 'create' };
  return run.status === 'draft' ? { kind: 'upload', runId: run.id } : { kind: 'locked', runId: run.id, status: run.status };
}

/** A locked run's status as the Import page says it. */
const LOCKED_WORDS: Partial<Record<PayrollStatus, string>> = { pending_ceo: 'with the CEO', approved: 'approved', paid: 'paid' };

/**
 * Why a month can't take an import (owner, 19 October 2026: "say plainly that the month is locked"): "September 2026 is
 * locked: its payroll is with the CEO, so it can't take an import."
 */
export function lockedText(month: string, status: PayrollStatus): string {
  const where = `is ${LOCKED_WORDS[status] ?? PAYROLL_STATUS_LABELS[status]?.toLowerCase() ?? status}`;
  return `${monthName(month)} is locked: its payroll ${where}, so it can't take an import.`;
}

/** A month the Import page offers. */
export interface ImportMonthChoice {
  month: string;
  label: string;
  /** A locked month is shown, not chosen. */
  locked: boolean;
  /** What happens with it, in words. */
  note: string;
}

/**
 * The months the Import page offers, newest first: this month back 12 months, as a payroll run can be made for them
 * (the API's range); each saying what its run is: a draft takes the files, no run yet gets one first, any other is
 * locked.
 */
export function importMonthChoices(today: string, runs: readonly RunOfMonth[]): ImportMonthChoice[] {
  const now = monthOf(today);
  const out: ImportMonthChoice[] = [];
  for (let n = 0; n <= 12; n++) {
    const month = addMonths(now, -n);
    const target = importTarget(month, runs);
    const note =
      target.kind === 'upload'
        ? 'draft payroll'
        : target.kind === 'create'
          ? 'no payroll yet: a draft is made'
          : `locked: ${LOCKED_WORDS[target.status] ?? target.status}`;
    out.push({ month, label: `${monthName(month)} (${note})`, locked: target.kind === 'locked', note });
  }
  return out;
}

/** The month offered first: the one asked for when it can take an import, else last month, else this month, else the newest open one. */
export function suggestedImportMonth(choices: readonly ImportMonthChoice[], today: string, asked?: string | null): string | null {
  const open = (m: string | null | undefined) => !!m && choices.some((c) => c.month === m && !c.locked);
  const now = monthOf(today);
  return [asked, addMonths(now, -1), now].find(open) ?? choices.find((c) => !c.locked)?.month ?? null;
}

// ---------- Import History ----------

/** Where an import stands: applied (when, by whom), undone, or not applied yet. */
export function importStateText(row: Pick<AttendanceImportRow, 'appliedAt' | 'appliedBy' | 'undoneAt'>): string {
  if (row.appliedAt) return `Applied ${formatDateTime(row.appliedAt)}${row.appliedBy ? ` by ${row.appliedBy}` : ''}`;
  if (row.undoneAt) return `Undone ${formatDateTime(row.undoneAt)}`;
  return 'Not applied yet';
}

/** "3 people: 1 matched, 1 to confirm, 1 not found, 1 skipped", the counts of none left out. */
export function importCountsText(row: Pick<AttendanceImportRow, 'people' | 'counts'>): string {
  const c = row.counts;
  const parts = [
    `${c.matched} matched`,
    c.toConfirm ? `${c.toConfirm} to confirm` : null,
    c.notFound ? `${c.notFound} not found` : null,
    c.skipped ? `${c.skipped} skipped` : null,
  ].filter(Boolean);
  return `${row.people} ${row.people === 1 ? 'person' : 'people'}: ${parts.join(', ')}`;
}

/**
 * Where a Super Admin's Delete brings the browser back to (asked, 21 October 2026: "how to delete previous imports"):
 * Import History, saying which month's import went and whether it was undone first.
 */
export const deletedImportHref = (month: string, undone: boolean) => withParams(ATTENDANCE_IMPORTS_PATH, { deleted: month, undone: undone ? '1' : null });

/** What Import History says after an import was deleted (?deleted=YYYY-MM, &undone=1); null otherwise. */
export function deletedImportNotice(query: Query): string | null {
  const month = one(query.deleted);
  if (!isAttendanceMonth(month)) return null;
  return one(query.undone) === '1'
    ? `Undid and deleted the ${monthName(month)} import: the lines it filled are back to the figures typed before it, and its days are removed.`
    : `Deleted the ${monthName(month)} import.`;
}
