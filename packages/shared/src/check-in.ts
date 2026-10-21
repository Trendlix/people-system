// Checking in on the system (owner, 19 October 2026, pasting the list and writing "Proceed with those": "Check-in through
// the system (phone or web with the office location check, or a device) to replace Zoho"). An employee with a current
// employment under a shift (not a freelancer) presses Check in and Check out on their Dashboard or My Attendance: the
// time is the server's (Cairo), never the device's; the place is the browser's location, asked each time, against the
// office's point and radius HR sets in Payroll Setup → Your Rules (150 metres to start with): within it the office,
// outside it remote, refused or unavailable "location unknown". At first only office, remote or unknown and the
// reading's accuracy in metres were kept, never the coordinates; since 20 October 2026 (owner: "Yes, keep the spot") the
// point where each press was made is kept too, read only then, and seen by HR, the CEO, the Super Admin and the
// employee (punch-location.ts). The work
// arrangement says where they are expected (an office employee at the office, a hybrid one at the office on its office
// days, anyone else anywhere): a check-in elsewhere is kept but flagged for the manager and HR on Daily Attendance, never
// refused (no one is locked out). Several presses a day are kept as punches; the day's check-in is the first in and its
// check-out the last out, as Zoho People has them, its hours counted by the shift's rule with the grace minutes
// (attendance.ts). A fingerprint or face device isn't here yet (no device details yet): its days would come as the
// source 'device' (ATTENDANCE_SOURCES). Pure: the API decides with these and the web shows the same words. Home
// locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from home",
// then "Label Home, flag elsewhere"): within a person's approved home a check-in is Home (remote for every other rule),
// and a remote one elsewhere is flagged for them; the home's own point is never kept on a punch.

import { hoursCountedForDay, mostHoursCountedADay, shiftWindowOn, type ShiftWindowTimes } from './attendance.js';
import type { WorkPlace } from './attendance-import.js';
import type { ShiftTimes } from './payroll.js';

// ---------- where a day's attendance came from ----------

/**
 * Where a kept day came from: Zoho People's import, a check-in on the system, an attendance device (the seam for a
 * fingerprint or face device, owner, 19 October 2026: "or a device"; nothing writes it yet), or a correction approved
 * (attendance-corrections.ts). One a person, day and source; the day shown is the first of SOURCE_PRECEDENCE there is.
 */
export const ATTENDANCE_SOURCES = ['zoho', 'system', 'device', 'correction'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const ATTENDANCE_SOURCE_LABELS: Record<AttendanceSource, string> = {
  zoho: 'Zoho People',
  system: 'Checked in on the system',
  device: 'Attendance device',
  correction: 'Corrected',
};

/**
 * Which source a day is taken from when it has several: a correction first (it was approved over the day), then the
 * system's check-ins, then a device's, then Zoho's import (owner's brief, 19 October 2026: "source 'system' first; for a
 * person with none, the Zoho days if imported").
 */
export const SOURCE_PRECEDENCE: readonly AttendanceSource[] = ['correction', 'system', 'device', 'zoho'];

const rank = (source: string) => {
  const i = SOURCE_PRECEDENCE.indexOf(source as AttendanceSource);
  return i < 0 ? SOURCE_PRECEDENCE.length : i;
};

/** The day each date is taken from, by SOURCE_PRECEDENCE: one row a date, in date order. */
export function daysByPrecedence<D extends { date: string; source: string }>(rows: readonly D[]): D[] {
  const best = new Map<string, D>();
  for (const r of rows) {
    const was = best.get(r.date);
    if (!was || rank(r.source) < rank(was.source)) best.set(r.date, r);
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The sources whose days are the system's own attendance: a person with any of them in a month is filled from their days. */
export const OWN_SOURCES: readonly AttendanceSource[] = ['system', 'device', 'correction'];

/** The sources of check-ins, from whose first day on a working day without one is absent: the system's and a device's. */
export const CHECK_IN_SOURCES: readonly AttendanceSource[] = ['system', 'device'];

// ---------- where a check-in was ----------

/**
 * Where a check-in was: within an office location's radius, within the person's approved home's (owner, 20 October
 * 2026: "allow other users to request to add their home locations when working from home", then "Label Home, flag
 * elsewhere"; home-locations.ts), outside them all, or the location refused or unavailable.
 */
export const CHECK_IN_PLACES = ['office', 'home', 'remote', 'unknown'] as const;
export type CheckInPlace = (typeof CHECK_IN_PLACES)[number];

export const CHECK_IN_PLACE_LABELS: Record<CheckInPlace, string> = { office: 'Office', home: 'Home', remote: 'Remote', unknown: 'Location unknown' };

/** Where a day was worked as the pages show it: the office, home, remote, or (a check-in on the system) location unknown. */
export type DayPlace = WorkPlace | 'home' | 'unknown';

/**
 * Whether a place counts as remote work: remote, and home (owner, 20 October 2026: "Label Home, flag elsewhere"), which
 * is labelled Home but is remote for every other rule: the work arrangement's checks, the month's remote days and Daily
 * Attendance's "Only with remote days" (the payroll counts hours, not places; the office network's lock is the address's).
 */
export const countsAsRemote = (place: string | null | undefined): boolean => place === 'remote' || place === 'home';

/**
 * A place check-ins count as the office at: its point and radius, and its name. Several since 20 October 2026 (owner:
 * "i cant find in the system where to add the eligable check in locations", then "Own page, several locations"):
 * Attendance → Check-in Setup; the one office point of Payroll Setup → Your Rules before. No point: not set.
 */
export interface OfficeLocation {
  latitude: number | null;
  longitude: number | null;
  /** Whole metres: within it is the office. */
  radiusMetres: number;
  /** The location's name, e.g. Head office; none for the one office point there was before. */
  name?: string;
}

/** The office's radius to start with (owner's brief, 19 October 2026: "default 150 m"), and the least and most HR sets. */
export const OFFICE_RADIUS_DEFAULT = 150;
export const OFFICE_RADIUS_MIN = 20;
export const OFFICE_RADIUS_MAX = 5000;

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Whether the office's point is set: both its latitude and longitude. */
export const officeLocationSet = (o: Pick<OfficeLocation, 'latitude' | 'longitude'>): boolean => isNumber(o.latitude) && isNumber(o.longitude);

/** Whether any of the check-in locations has its point set: without one, every check-in's place is unknown. */
export const checkInLocationsSet = (locations: readonly Pick<OfficeLocation, 'latitude' | 'longitude'>[]): boolean => locations.some(officeLocationSet);

/** The longest name a check-in location takes. */
export const CHECK_IN_LOCATION_NAME_MAX = 80;

/** The most check-in locations Check-in Setup keeps. */
export const CHECK_IN_LOCATIONS_MAX = 50;

/**
 * Why a check-in location can't be saved (none: it can; Attendance → Check-in Setup, owner, 20 October 2026: "Own page,
 * several locations"): a name of up to 80 characters, both its latitude and longitude, and its radius, as the office's
 * point and radius are checked (officeLocationProblems).
 */
export function checkInLocationProblems(l: { name: string; latitude: number | null; longitude: number | null; radiusMetres: number }): string[] {
  const problems: string[] = [];
  const name = l.name.trim();
  if (!name) problems.push('Name the location, e.g. Head office.');
  else if (name.length > CHECK_IN_LOCATION_NAME_MAX) problems.push(`Keep the location's name to ${CHECK_IN_LOCATION_NAME_MAX} characters or fewer.`);
  if (l.latitude === null || l.longitude === null) problems.push("Enter the location's latitude and longitude, e.g. 30.0596 and 31.3462, or use your current location.");
  return [...problems, ...officeLocationProblems(l).filter((p) => !p.startsWith('Enter both')).map((p) => p.replace("the office's", "the location's"))];
}

/**
 * Why the office's location can't be saved (none: it can): the latitude from −90 to 90 and the longitude from −180 to
 * 180, both or neither (neither: not set), and the radius whole metres from 20 to 5,000.
 */
export function officeLocationProblems(o: OfficeLocation): string[] {
  const problems: string[] = [];
  const lat = o.latitude;
  const lng = o.longitude;
  if (lat !== null && (!isNumber(lat) || lat < -90 || lat > 90)) problems.push("Enter the office's latitude from -90 to 90, e.g. 30.0596.");
  if (lng !== null && (!isNumber(lng) || lng < -180 || lng > 180)) problems.push("Enter the office's longitude from -180 to 180, e.g. 31.3462.");
  if ((lat === null) !== (lng === null)) problems.push("Enter both the office's latitude and longitude, or neither.");
  if (!Number.isInteger(o.radiusMetres) || o.radiusMetres < OFFICE_RADIUS_MIN || o.radiusMetres > OFFICE_RADIUS_MAX) {
    problems.push(`Enter the office's radius in whole metres from ${OFFICE_RADIUS_MIN} to ${OFFICE_RADIUS_MAX.toLocaleString('en-US')}, e.g. ${OFFICE_RADIUS_DEFAULT}.`);
  }
  return problems;
}

/** The distance between two points on the earth, in metres (the haversine formula, the earth a sphere of 6,371 km). */
export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** What the browser read of where the phone or computer is: its point and how accurate it is, in metres. */
export interface LocationReading {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

/** Why the browser gave no location: refused, unavailable, too slow, or a browser without it. */
export const CHECK_IN_LOCATION_ERRORS = ['denied', 'unavailable', 'timeout', 'unsupported'] as const;
export type CheckInLocationError = (typeof CHECK_IN_LOCATION_ERRORS)[number];

/**
 * Inside the employee app a press needs a location (owner, 20 October 2026: "the device location should be active for
 * the application for location tracking services", "dont allow checkins without location is always active"; asked,
 * "Refuse without location" and "App only"): read at the moment of the press, never tracked. The API refuses an app
 * press without one (409) with this; on the website a press without one is kept, location unknown, as before, unless
 * the company refuses it (punch-location.ts, owner, 20 October 2026: "Company switch + exceptions").
 */
export const APP_LOCATION_NEEDED_MESSAGE = "Turn on your phone's location and allow Trendlix People to use it, then try again.";

export const CHECK_IN_LOCATION_ERROR_LABELS: Record<CheckInLocationError, string> = {
  denied: 'You didn’t allow the location',
  unavailable: 'The location isn’t available on this device now',
  timeout: 'The location took too long to read',
  unsupported: 'This browser can’t give a location',
};

/** A person's approved home as a check-in is read against it: its point and radius (home-locations.ts). */
export type HomePoint = Pick<OfficeLocation, 'latitude' | 'longitude' | 'radiusMetres'>;

/**
 * The sub-location a check-in was within (owner, 20 October 2026: "main office location is the hero and other
 * locations are like sub locations"; sub-locations.ts): its name, and whether the person checking in is linked to it.
 */
export interface SubLocationAt {
  name: string;
  linked: boolean;
}

/**
 * Where a check-in was (owner's brief, 19 October 2026): within an office location's radius the office, outside them all
 * remote; no reading (refused or unavailable), a reading that isn't a point, or no location with its point set: unknown.
 * Several locations since 20 October 2026 (owner: "Own page, several locations"): within ANY of them is the office, and
 * `location` names the nearest one it is within (when it has a name). The accuracy kept is the reading's, in whole
 * metres (none: null); the point itself is kept apart with the press (punch-location.ts, since 20 October 2026). A person's approved home (owner, 20 October 2026: "Label Home,
 * flag elsewhere"): the place order is the office first, else within the home's radius home, else remote, else unknown;
 * with no office location set a reading at home is still home, anywhere else unknown as before.
 */
export function checkInPlace(
  reading: LocationReading | null | undefined,
  offices: OfficeLocation | readonly OfficeLocation[],
  home: HomePoint | null = null,
): { place: CheckInPlace; accuracyMetres: number | null; location?: string } {
  const accuracyMetres = reading && isNumber(reading.accuracy) && reading.accuracy >= 0 ? Math.round(reading.accuracy) : null;
  if (!reading || !isNumber(reading.latitude) || !isNumber(reading.longitude) || Math.abs(reading.latitude) > 90 || Math.abs(reading.longitude) > 180) {
    return { place: 'unknown', accuracyMetres: null };
  }
  const set = (Array.isArray(offices) ? offices : [offices]).filter(officeLocationSet) as readonly OfficeLocation[];
  let within: { office: OfficeLocation; d: number } | null = null;
  for (const office of set) {
    const d = distanceMetres(reading, { latitude: office.latitude!, longitude: office.longitude! });
    if (d <= office.radiusMetres && (!within || d < within.d)) within = { office, d };
  }
  if (within) return within.office.name ? { place: 'office', accuracyMetres, location: within.office.name } : { place: 'office', accuracyMetres };
  if (home && officeLocationSet(home) && distanceMetres(reading, { latitude: home.latitude!, longitude: home.longitude! }) <= home.radiusMetres) {
    return { place: 'home', accuracyMetres };
  }
  return { place: set.length ? 'remote' : 'unknown', accuracyMetres };
}

// ---------- the rules by work arrangement ----------

/** Where someone is expected a day: at the office, or anywhere. */
export type ExpectedPlace = 'office' | 'anywhere';

/**
 * Where an employment's work arrangement expects them on a weekday (0 = Sunday … 6 = Saturday; owner's brief, 19 October
 * 2026): office at the office every day; hybrid at the office on its office days; work from home, outdoor and indoor
 * and outdoor anywhere. On a work from home day approved for them (`workingFromHome`; owner, 21 October 2026: "think
 * about how should we handle the working from home in out erp", wfh.ts): anywhere, whatever the arrangement.
 */
export function expectedPlace(arrangement: string, officeDays: readonly number[], weekday: number, workingFromHome = false): ExpectedPlace {
  if (workingFromHome) return 'anywhere';
  if (arrangement === 'office') return 'office';
  if (arrangement === 'hybrid') return officeDays.includes(weekday) ? 'office' : 'anywhere';
  return 'anywhere';
}

/**
 * What a check-in is flagged as, allowed and shown to the manager and HR: one that breaks its arrangement's rule, or
 * one whose location the phone itself said is made up (fake GPS: the employee app on Android tells a mock location,
 * apps/mobile/README.md Phase 2, owner, 20 October 2026: "Android mock location → mock: true on the punch → flagged
 * ("Fake GPS suspected") on Daily Attendance"). And a remote check-in by someone with an approved home, outside every
 * office location and their home (owner, 20 October 2026: "Label Home, flag elsewhere"): "Not at home or the office".
 * And a check-in within a sub-location the person isn't linked to (owner, 20 October 2026: "will check it and shows
 * remote too"; sub-locations.ts): "Not their location", for HR to check.
 */
export const CHECK_IN_FLAGS = ['outside_office', 'location_unknown', 'fake_gps', 'not_home_or_office', 'not_their_location'] as const;
export type CheckInFlag = (typeof CHECK_IN_FLAGS)[number];

export const CHECK_IN_FLAG_LABELS: Record<CheckInFlag, string> = {
  outside_office: 'Checked in outside the office on an office day',
  location_unknown: 'Location unknown on an office day',
  fake_gps: 'Fake GPS suspected',
  not_home_or_office: 'Not at home or the office',
  not_their_location: 'Checked in at a sub-location they aren’t linked to',
};

/**
 * The flags in a word or two, for the compact badges of a day's row (owner, 20 October 2026: "simplify this"); the
 * full words above stay as each badge's title and in Daily Attendance's filter.
 */
export const CHECK_IN_FLAG_SHORT_LABELS: Record<CheckInFlag, string> = {
  outside_office: 'Outside the office',
  location_unknown: 'No location',
  fake_gps: 'Fake GPS suspected',
  not_home_or_office: 'Not at home or the office',
  not_their_location: 'Not their location',
};

export const isCheckInFlag = (v: unknown): v is CheckInFlag => (CHECK_IN_FLAGS as readonly unknown[]).includes(v);

/**
 * The flags of a check-in: on an office day, remote (home too: it counts as remote) is outside the office and unknown
 * can't be told; anywhere, none for the place. A location the phone said is a mock one (`mock`, known only inside the
 * employee app on Android) is fake GPS suspected, whatever the arrangement; the place is still read from it as from any
 * other. Someone with an approved home (`hasHome`; owner, 20 October 2026: "Label Home, flag elsewhere") checking in
 * remote, outside every office location and their home, is not at home or the office, whatever the arrangement; nothing
 * is refused for it. Within a sub-location (`subLocation`, a remote check-in; owner, 20 October 2026: "own sublocation
 * shows the sub location name", "will check it and shows remote too"; sub-locations.ts): at their own (linked) one, it
 * is their place, so it isn't outside the office on an office day, nor away from home and the office; at one they
 * aren't linked to, it is outside the office on an office day as any remote check-in, and not their location, for HR
 * to check (one flag for it: not "not at home or the office" too).
 */
export function checkInFlags(expected: ExpectedPlace, place: CheckInPlace, mock = false, hasHome = false, subLocation: SubLocationAt | null = null): CheckInFlag[] {
  const flags: CheckInFlag[] = [];
  const at = place === 'remote' ? subLocation : null;
  if (expected === 'office' && countsAsRemote(place) && !at?.linked) flags.push('outside_office');
  if (expected === 'office' && place === 'unknown') flags.push('location_unknown');
  if (mock) flags.push('fake_gps');
  if (hasHome && place === 'remote' && !at) flags.push('not_home_or_office');
  if (at && !at.linked) flags.push('not_their_location');
  return flags;
}

/**
 * The flags of a press: a check-in's as checkInFlags; a check-out's place breaks no rule (only check-ins are held to the
 * arrangement, to the home and to the sub-location's people), but a mock location on it is fake GPS suspected all the
 * same.
 */
export function punchFlags(
  kind: PunchKind,
  expected: ExpectedPlace,
  place: CheckInPlace,
  mock = false,
  hasHome = false,
  subLocation: SubLocationAt | null = null,
): CheckInFlag[] {
  return kind === 'in' ? checkInFlags(expected, place, mock, hasHome, subLocation) : mock ? ['fake_gps'] : [];
}

/** What the employee is told of where today's check-in is expected; on an approved work from home day (wfh.ts), so. */
export function expectedPlaceText(arrangement: string, expected: ExpectedPlace, workingFromHome = false): string {
  if (workingFromHome) return 'Today is your approved work from home day: check in from home.';
  if (expected === 'office') return arrangement === 'hybrid' ? 'Today is one of your office days: check in at the office.' : 'You work at the office: check in there.';
  if (arrangement === 'hybrid') return 'Today is a home day: check in wherever you work from.';
  return 'You may check in wherever you work today.';
}

// ---------- punches and the day ----------

/** A press of Check in or Check out. */
export const PUNCH_KINDS = ['in', 'out'] as const;
export type PunchKind = (typeof PUNCH_KINDS)[number];

export const PUNCH_KIND_LABELS: Record<PunchKind, string> = { in: 'Check-in', out: 'Check-out' };

export const isPunchKind = (v: unknown): v is PunchKind => (PUNCH_KINDS as readonly unknown[]).includes(v);

/** A punch as kept: its kind, the server's moment (ISO), where it was and its flags. */
export interface PunchLike {
  kind: PunchKind;
  at: string;
  place: CheckInPlace;
  flags?: readonly string[];
}

/** A day of check-ins as kept (source 'system'): what the punches make it. */
export interface PunchedDay {
  checkIn: string | null;
  checkOut: string | null;
  /** The first check-in's place, else (only check-outs) the last check-out's. */
  place: CheckInPlace | null;
  /** Every check-in's flags, and fake GPS suspected on a check-out too, once each. */
  flags: CheckInFlag[];
  hoursCounted: number;
}

/** A shift as a day's hours are counted with it: its window, hours to work and grace minutes. */
export type CountingShift = ShiftWindowTimes & Pick<ShiftTimes, 'hoursPerDay'>;

/**
 * A day from its punches (owner's brief, 19 October 2026: "the day's check-in is the first in, check-out the last out
 * (the Zoho meaning)"): the first check-in, the last check-out after it (none after it: none; no check-in at all: the
 * last check-out, a check-out without a check-in), the place and flags, and the hours counted by the shift's rule
 * (attendance.ts hoursCountedForDay, within the window on `date` moved by the grace; no shift: from check-in to
 * check-out), to the minute.
 */
export function dayFromPunches(date: string, punches: readonly PunchLike[], shift: CountingShift | null): PunchedDay {
  const sorted = [...punches].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const ins = sorted.filter((p) => p.kind === 'in');
  const outs = sorted.filter((p) => p.kind === 'out');
  const firstIn = ins[0] ?? null;
  const lastOut = (firstIn ? outs.filter((p) => Date.parse(p.at) > Date.parse(firstIn.at)) : outs).at(-1) ?? null;
  // the check-ins' flags; of a check-out's, only fake GPS (its place breaks no rule), in the order pressed
  const flags = [...new Set(sorted.flatMap((p) => (p.flags ?? []).filter(isCheckInFlag).filter((f) => p.kind === 'in' || f === 'fake_gps')))];
  const hours =
    firstIn && lastOut ? hoursCountedForDay(firstIn.at, lastOut.at, shift ? mostHoursCountedADay(shift) : null, shift ? shiftWindowOn(date, shift) : null) : 0;
  return {
    checkIn: firstIn?.at ?? null,
    checkOut: lastOut?.at ?? null,
    place: firstIn?.place ?? lastOut?.place ?? null,
    flags,
    hoursCounted: Math.round(hours * 60) / 60,
  };
}

/** What the next press is: Check out while the last punch of the day is a check-in, else Check in. */
export const nextPunch = (punches: readonly Pick<PunchLike, 'kind' | 'at'>[]): PunchKind =>
  [...punches].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1)?.kind === 'in' ? 'out' : 'in';

const CAIRO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
const CAIRO_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true });

/** The day a moment is in Cairo, YYYY-MM-DD. */
export const cairoDay = (moment: Date | string | number): string => CAIRO_DAY.format(new Date(moment));

/** A moment as the screens and messages show its time in Cairo: 12-hour, "9:05 AM". */
export const cairoClock = (moment: Date | string | number): string => CAIRO_CLOCK.format(new Date(moment)).replace(/ /g, ' ');

const nextDate = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The working day a punch at `moment` is counted on: its day in Cairo, except on a shift that runs past midnight (22:00
 * to 06:00), where it is the day whose window it is nearer (a check-out at 05:30 is the night before's); no shift, or a
 * shift within a day: its day in Cairo.
 */
export function shiftDayOf(moment: Date | string | number, shift: ShiftWindowTimes | null): string {
  const at = new Date(moment).getTime();
  const day = cairoDay(at);
  if (!shift || shift.endTime.slice(0, 5) > shift.startTime.slice(0, 5)) return day;
  const before = nextDate(day, -1);
  const gap = (d: string) => {
    const w = shiftWindowOn(d, shift);
    if (!w) return Number.POSITIVE_INFINITY;
    return at < w.start ? w.start - at : at > w.end ? at - w.end : 0;
  };
  return gap(before) < gap(day) ? before : day;
}

/**
 * What the employee is told once a punch is kept (owner's brief, 19 October 2026: "Checking out without checking in, or
 * a second check-in, is handled plainly"), from the day's punches before it (`earlier`) and the punch itself: the time
 * and the place, a check-out without a check-in (to ask for a correction), a second check-in (the day still starting at
 * the first), and a flag (kept, and shown to the manager and HR). Within a sub-location (a remote punch with its
 * `locationName`; owner, 20 October 2026: "named with the location name"), "remote at Studio".
 */
export function punchMessages(
  punch: PunchLike & { flags: readonly CheckInFlag[]; locationName?: string | null },
  earlier: readonly PunchLike[],
  why: { locationError?: CheckInLocationError | null; officeSet?: boolean } = {},
): string[] {
  const time = cairoClock(punch.at);
  const sub = punch.place === 'remote' ? punch.locationName?.trim() || null : null;
  const where =
    punch.place === 'unknown' ? 'location unknown' : punch.place === 'office' ? 'at the office' : punch.place === 'home' ? 'at home' : sub ? `remote at ${sub}` : 'remote';
  const ins = earlier.filter((p) => p.kind === 'in').sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const messages: string[] = [];
  if (punch.kind === 'in') {
    messages.push(`Checked in at ${time}, ${where}.`);
    if (ins.length) {
      const stillIn = nextPunch(earlier) === 'out';
      messages.push(
        stillIn
          ? `You were checked in already since ${cairoClock(ins[0].at)}: this check-in is kept too, and your day still starts at ${cairoClock(ins[0].at)}.`
          : `Checked in again: your day still starts at ${cairoClock(ins[0].at)} and ends at your last check-out.`,
      );
    }
  } else {
    messages.push(`Checked out at ${time}, ${where}.`);
    if (!ins.length) messages.push('You had not checked in today: the check-out is kept, with no hours counted. Ask for a correction to add the time you came in.');
  }
  if (punch.place === 'unknown') {
    const reason = why.officeSet === false ? 'The office’s location isn’t set on the system yet' : why.locationError ? CHECK_IN_LOCATION_ERROR_LABELS[why.locationError] : 'Your location couldn’t be read';
    messages.push(`${reason}: the ${punch.kind === 'in' ? 'check-in' : 'check-out'} is kept as location unknown.`);
  }
  for (const f of punch.flags) {
    messages.push(
      f === 'outside_office'
        ? `${CHECK_IN_FLAG_LABELS[f]}: it is kept, and your manager and HR see it flagged.`
        : f === 'fake_gps'
          ? `${CHECK_IN_FLAG_LABELS[f]}: your phone said this location comes from an app that sets a made-up one. The ${punch.kind === 'in' ? 'check-in' : 'check-out'} is kept, and your manager and HR see it flagged. Turn such an app off before you check in.`
          : f === 'not_home_or_office'
            ? `${CHECK_IN_FLAG_LABELS[f]}: you checked in away from the office and from your approved home. It is kept, and your manager and HR see it flagged.`
            : f === 'not_their_location'
              ? `${CHECK_IN_FLAG_SHORT_LABELS[f]}: you checked in at ${sub ?? 'a sub-location'}, which isn’t one of your check-in places. It is kept, and your manager and HR see it flagged.`
              : `${CHECK_IN_FLAG_LABELS[f]}: it is kept, and your manager and HR see it flagged. Allow the location next time.`,
    );
  }
  return messages;
}

// ---------- who checks in ----------

/** What an employment needs to check in: its type and whether it has a shift. */
export interface CheckInEmployment {
  employmentType: string;
  shiftId: string | null;
}

/**
 * Why someone can't check in on the system (null: they can; owner's brief, 19 October 2026: "Employees (with an employee
 * profile and a current employment under a shift; not freelancers)"): no profile, no current employment, a freelancer,
 * or no shift.
 */
export function checkInRefusal(profile: boolean, employment: CheckInEmployment | null): string | null {
  if (!profile) return 'Your sign-in has no employee profile, so there is nothing to check in to. Ask HR to add your work email to your profile.';
  if (!employment) return 'You have no current employment, so there is nothing to check in to.';
  if (employment.employmentType === 'freelance') return 'A freelancer doesn’t check in: freelance work is outside the labour law and its working hours.';
  if (!employment.shiftId) return 'Your employment has no shift yet, so checking in isn’t on for you. Ask HR to set your shift.';
  return null;
}
