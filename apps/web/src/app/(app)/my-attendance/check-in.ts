import {
  breakText,
  cairoClock,
  CHECK_IN_FLAG_LABELS,
  CHECK_IN_LOCATION_ERRORS,
  CHECK_IN_PLACE_LABELS,
  checkInLockText,
  EXEMPT_BADGE,
  EXEMPT_CHECK_IN_TEXT,
  EXEMPTION_LABEL,
  exemptionWhenText,
  checkInRefusal,
  formatHours,
  isCheckInFlag,
  isPunchKind,
  makesUpHours,
  networkNeededText,
  pairsText,
  pressPlaceLabel,
  PUNCH_KIND_LABELS,
  shiftWindowOn,
  shiftWorkHours,
  SPOT_KEPT_TEXT,
  timeOfDayText,
  type CheckInLocationError,
  type CheckInPlace,
  type PunchKind,
} from '@trendlix/shared';
import type { CheckInTodayView, PunchedDayView, PunchView } from '../../../lib/attendance-types';
import { formatDate } from '../../../lib/format';
import { punchMap } from '../attendance/attendance';
import { weekdayOf } from '../organization/holidays/holidays';

// Checking in on the system (owner, 19 October 2026, pasting the list and writing "Proceed with those": "Check-in through
// the system (phone or web with the office location check, or a device) to replace Zoho"). One big button, Check in or
// Check out as the day stands, on the employee's Dashboard, at the top of My Attendance, and on the home page of HR, the
// CEO and Finance with an employee profile. Each press asks the browser where the phone or computer is, fresh and as
// precise as it can within 10 seconds, and sends that point (or why there is none: refused, unavailable, too slow, a
// browser without it) with Check in or Check out; never a time: the server's is the punch's. The API reads the point
// against the office's, and keeps it with the press (owner, 20 October 2026: "Yes, keep the spot"), read only then and
// never tracked; the panel says so, and today's list opens each press's own spot on a map. Pure code, tested: reading
// the location, the press as the API takes it, and the panel's words. Relative imports: the tests run without "@/". A
// day as the sum of its pairs (owner, 25 October 2026: "the working hours to be calculated between the checkin and out
// only, not the first and last"): the panel lists today's pairs so far and their hours, and the counter counts them
// with the time since the last check-in, never the break between them. A new employee's first day (owner, 27 October
// 2026: "a new employee when checked in in his first day move the checkin to 9am automatically to prevent delay in
// instructions"; "Counted from the shift start"): the API says the day is their first (`firstDay`), the panel tells them
// it counts from the shift's start whatever time they check in (firstDayNote), and the counter counts from it (CountRule
// `fromStart`), as the day will be counted.

// ---------- the browser's location ----------

/** What the browser is asked for, each press: a fresh reading (none kept from before), as precise as it can, within 10 s. */
export const LOCATION_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 };

/**
 * Some browsers never answer while their "allow your location?" prompt is left open (the timeout above counts only once
 * it is allowed): after this long the press goes on as "took too long", so the button is never stuck.
 */
export const LOCATION_GIVE_UP_MS = 30_000;

/**
 * What the browser gave: its point and how accurate it is in metres, or why there is none. `mock`: whether the phone
 * said the point is a mock one (fake GPS), known only inside the employee app on Android (lib/native.ts, Phase 2, 20
 * October 2026); left out when not known (a browser can't tell).
 */
export type LocationResult = { latitude: number; longitude: number; accuracy: number | null; mock?: boolean } | { locationError: CheckInLocationError };

/** A GeolocationPositionError's code in the API's words: 1 refused, 2 unavailable, 3 too slow; anything else unavailable. */
export function locationErrorOf(code: number | null | undefined): CheckInLocationError {
  if (code === 1) return 'denied';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * A reading's coordinates as sent: a point on the earth, its accuracy when the browser gives one, and whether it is a
 * mock one when the app's own location says so (true or false only); else unavailable.
 */
export function readingOf(coords: { latitude: number; longitude: number; accuracy?: number | null; mock?: unknown } | null | undefined): LocationResult {
  if (!coords || !finite(coords.latitude) || !finite(coords.longitude) || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) {
    return { locationError: 'unavailable' };
  }
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: finite(coords.accuracy) && coords.accuracy >= 0 ? coords.accuracy : null,
    ...(typeof coords.mock === 'boolean' && { mock: coords.mock }),
  };
}

/**
 * Where the device is, read once with LOCATION_OPTIONS (`geo`: the browser's navigator.geolocation; none: a browser
 * without it, "unsupported"). Never fails: a refusal, an error or no answer at all within `giveUpMs` is its reason.
 */
export function readLocation(geo: Pick<Geolocation, 'getCurrentPosition'> | null | undefined, giveUpMs = LOCATION_GIVE_UP_MS): Promise<LocationResult> {
  if (!geo || typeof geo.getCurrentPosition !== 'function') return Promise.resolve({ locationError: 'unsupported' });
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish({ locationError: 'timeout' }), giveUpMs);
    function finish(result: LocationResult) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    }
    try {
      geo.getCurrentPosition(
        (position) => finish(readingOf(position?.coords)),
        (error) => finish({ locationError: locationErrorOf(error?.code) }),
        LOCATION_OPTIONS,
      );
    } catch {
      finish({ locationError: 'unavailable' });
    }
  });
}

// ---------- the press, as the API takes it ----------

/**
 * POST /me/attendance/punches: in or out, and the point read (with whether it is a mock one, when that is known) or why
 * there is none. Never a time.
 */
export type PunchBody =
  | { kind: PunchKind; latitude: number; longitude: number; accuracy?: number; mock?: boolean }
  | { kind: PunchKind; locationError: CheckInLocationError };

/** The press with what the browser gave: `mock` only when the app's location said it (a browser never sends it). */
export function punchBody(kind: PunchKind, location: LocationResult): PunchBody {
  if ('locationError' in location) return { kind, locationError: location.locationError };
  return {
    kind,
    latitude: location.latitude,
    longitude: location.longitude,
    ...(location.accuracy !== null && { accuracy: location.accuracy }),
    ...(typeof location.mock === 'boolean' && { mock: location.mock }),
  };
}

/**
 * Whether the API refused the press only for its `mock` (an API from before the employee app's Phase 2, which refuses a
 * word it doesn't know): then it goes again without it (withoutMock), so a check-in is never lost to the order the web
 * and the API are deployed in.
 */
export function mockRefused(body: PunchBody, status: number, messages: readonly string[]): boolean {
  return status === 400 && 'mock' in body && messages.length > 0 && messages.every((m) => /^property mock should not exist$/.test(m));
}

/** The press without whether its point is a mock one. */
export function withoutMock(body: PunchBody): PunchBody {
  if (!('mock' in body)) return body;
  const { kind, latitude, longitude, accuracy } = body;
  return { kind, latitude, longitude, ...(accuracy !== undefined && { accuracy }) };
}

const isLocationError = (v: unknown): v is CheckInLocationError => (CHECK_IN_LOCATION_ERRORS as readonly unknown[]).includes(v);

/**
 * A press as the server action passes it on, read again (anything can call a server action): its kind, and either a
 * point on the earth (with its accuracy when it is one, and whether it is a mock one when that is true or false) or a
 * reason; null when it isn't a press. Nothing else, a time least of all, is passed on.
 */
export function punchBodyFrom(input: unknown): PunchBody | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as Record<string, unknown>;
  if (!isPunchKind(v.kind)) return null;
  if (finite(v.latitude) && finite(v.longitude)) {
    const reading = readingOf({ latitude: v.latitude, longitude: v.longitude, accuracy: finite(v.accuracy) ? v.accuracy : null, mock: v.mock });
    return punchBody(v.kind, reading);
  }
  return { kind: v.kind, locationError: isLocationError(v.locationError) ? v.locationError : 'unavailable' };
}

// ---------- what the panel shows ----------

/** Where the button is: waiting, reading the location, or sending the press. */
export type PunchPhase = 'idle' | 'locating' | 'sending';

/** The button: Check in or Check out, then "Getting your location…", then "Checking in…" or "Checking out…". */
export function buttonLabel(next: PunchKind, phase: PunchPhase): string {
  if (phase === 'locating') return 'Getting your location…';
  if (phase === 'sending') return next === 'in' ? 'Checking in…' : 'Checking out…';
  return next === 'in' ? 'Check in' : 'Check out';
}

/**
 * Whether the panel shows: the button (they check in), their reason quietly (a freelancer, no shift yet), or nothing at
 * all (no employee profile, no current employment: there is nothing to check in to).
 */
export function checkInShows(view: Pick<CheckInTodayView, 'refusal'>): 'panel' | 'refusal' | 'hidden' {
  if (!view.refusal) return 'panel';
  const nothingToCheckInTo = view.refusal === checkInRefusal(false, null) || view.refusal === checkInRefusal(true, null) || /no employee profile|no current employment/i.test(view.refusal);
  return nothingToCheckInTo ? 'hidden' : 'refusal';
}

/** Today's view the panel shows: the newer of the page's and the last press's (by the server's time), the press's on a tie. */
export function latestView<T extends Pick<CheckInTodayView, 'now'>, U extends Pick<CheckInTodayView, 'now'>>(page: T, pressed: U | null): T | U {
  if (!pressed) return page;
  return Date.parse(page.now) > Date.parse(pressed.now) ? page : pressed;
}

/** How accurate a reading was: "±18 m", "±1,200 m"; null when not known. */
export function accuracyText(metres: number | null | undefined): string | null {
  if (!finite(metres) || metres < 0) return null;
  return `±${Math.round(metres).toLocaleString('en-US')} m`;
}

/**
 * A place in words: Office, Home, Remote, Location unknown; within a sub-location (its name with the press; owner, 20
 * October 2026: "(Remote - Location name)"), "Remote - Studio"; within a client location or their remote site (24 October
 * 2026), "Client · Acme", "Remote site · Flat".
 */
export const placeLabel = (place: CheckInPlace | null | undefined, locationName?: string | null, locationKind?: string | null): string =>
  place ? (place === 'remote' && locationName?.trim() ? pressPlaceLabel(place, locationName, locationKind) : (CHECK_IN_PLACE_LABELS[place] ?? place)) : '—';

/** The day's place in words: its first check-in's (else its last check-out's), with the sub-location's name it was within. */
export function dayPlaceLabel(day: Pick<PunchedDayView, 'place'>, punches: readonly Pick<PunchView, 'kind' | 'at' | 'place' | 'locationName' | 'locationKind'>[]): string {
  const sorted = [...punches].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const shown = sorted.find((p) => p.kind === 'in') ?? sorted.filter((p) => p.kind === 'out').at(-1);
  return shown && shown.place === day.place ? placeLabel(shown.place, shown.locationName, shown.locationKind) : placeLabel(day.place);
}

/**
 * What the panel says when their check-ins are locked to the office network: the network, and (for someone linked to
 * sub-locations) that at their own check-in places they may check in off it (20 October 2026).
 */
export const networkNote = (view: Pick<CheckInTodayView, 'ownPlaces'>): string => networkNeededText(view.ownPlaces ?? []);

/**
 * What the panel says before a press when they are locked (the office network, 20 October 2026; the check-in locations by
 * GPS, 24 October 2026: "Yes, add a GPS lock too"; either passing is enough); null when neither holds them today, and
 * never for someone exempt from check-in today (owner, 25 October 2026: "Optional check-in": no lock refuses them).
 */
export const lockNote = (view: Pick<CheckInTodayView, 'ownPlaces' | 'network' | 'gps' | 'exemption'>): string | null =>
  view.exemption ? null : checkInLockText({ network: !!view.network?.locked, gps: !!view.gps?.locked }, view.ownPlaces ?? []);

/**
 * Exempt from check-in today (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
 * checkins and outs, trat them as if they achived their full working hours"; "Optional check-in"): the badge, its title
 * and the period, "From 01/11/2026 until 30/11/2026"; null when not exempt (or an API from before it).
 */
export function exemptToday(view: Pick<CheckInTodayView, 'exemption'>): { label: string; title: string; when: string } | null {
  return view.exemption ? { label: EXEMPT_BADGE, title: EXEMPTION_LABEL, when: exemptionWhenText(view.exemption) } : null;
}

/** What the panel says of where they are expected: exempt today, that checking in is optional; else the API's words. */
export const expectedTextOf = (view: Pick<CheckInTodayView, 'expectedText' | 'exemption'>): string | null => (view.exemption ? EXEMPT_CHECK_IN_TEXT : view.expectedText);

/** The flags' words, the known ones once each ("Checked in outside the office on an office day"). */
export const flagLabels = (flags: readonly string[] | null | undefined): string[] => [...new Set((flags ?? []).filter(isCheckInFlag))].map((f) => CHECK_IN_FLAG_LABELS[f]);

/** A punch as a row of today's list. */
export interface PunchRow {
  key: string;
  label: string;
  time: string;
  place: string;
  accuracy: string | null;
  flags: string[];
  /** Where it was pressed, on a map (20 October 2026: "location link"); none without a point. */
  map: { href: string; title: string } | null;
}

/** Today's punches in the order pressed: "Check-in · 9:05 AM · Office · ±18 m", with their flags and their Map. */
export function punchRows(punches: readonly PunchView[]): PunchRow[] {
  return [...punches]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((p, i) => ({
      key: `${i}-${p.kind}-${p.at}`,
      label: PUNCH_KIND_LABELS[p.kind] ?? p.kind,
      time: cairoClock(p.at),
      place: placeLabel(p.place, p.locationName, p.locationKind),
      accuracy: accuracyText(p.accuracyMetres),
      flags: flagLabels(p.flags),
      map: punchMap(p),
    }));
}

/** Whether a day lists its pairs (25 October 2026): several of them, or one with a check-in after it not checked out. */
const listsPairs = (day: Pick<PunchedDayView, 'pairs' | 'openAt'>): boolean => (day.pairs?.length ?? 0) > 1 || ((day.pairs?.length ?? 0) > 0 && !!day.openAt);

/**
 * The day so far: "9:05 AM → 5:10 PM", "9:05 AM → not checked out yet", "No check-in → 5:10 PM"; a day of several pairs
 * (owner, 25 October 2026: "the working hours to be calculated between the checkin and out only, not the first and
 * last") each of them, "9:02 AM–1:10 PM · 2:00 PM–6:05 PM", and a check-in since, "· 2:00 PM → not checked out yet".
 */
export function dayTimesText(day: Pick<PunchedDayView, 'checkIn' | 'checkOut'> & Partial<Pick<PunchedDayView, 'pairs' | 'openAt'>>): string {
  if (listsPairs(day)) return [pairsText(day.pairs ?? []), ...(day.openAt ? [`${cairoClock(day.openAt)} → not checked out yet`] : [])].join(' · ');
  return `${day.checkIn ? cairoClock(day.checkIn) : 'No check-in'} → ${day.checkOut ? cairoClock(day.checkOut) : 'not checked out yet'}`;
}

/**
 * The day's hours: counted once they check out by the shift's rule, none without a check-in; checked in again after
 * their pairs (25 October 2026), the pairs' hours so far.
 */
export function dayHoursText(day: Pick<PunchedDayView, 'checkIn' | 'checkOut' | 'hoursCounted'> & Partial<Pick<PunchedDayView, 'pairs' | 'openAt'>>): string {
  if (day.checkIn && day.checkOut && day.openAt) return `${formatHours(day.hoursCounted)} counted so far`;
  if (day.checkIn && day.checkOut) return `${formatHours(day.hoursCounted)} counted`;
  if (day.checkIn) return 'Counted once you check out';
  return 'No hours counted without a check-in';
}

/** The day's break between its pairs (25 October 2026): "Break 50 min"; null with none. */
export const dayBreakText = (day: Partial<Pick<PunchedDayView, 'breakMinutes'>>): string | null => breakText(day.breakMinutes);

// ---------- the check-in counter ----------
// Owner, 20 October 2026: "employees need to see a checkin counter after their checkin." While checked in, the time
// worked so far ticks each second, counted the way attendance will count it once they check out (attendance.ts
// hoursCountedForDay, which dayFromPunches uses): from the check-in, or the shift window's start when later; until the
// window's end moved by the grace (owner, 19 October 2026: "if the employee checked in 10:15 he can check out till 7:15
// and the 9 hours are counted"); at most the hours to work. With them, when the hours will be done. Once checked out,
// the day's hours counted by the server. The arithmetic is one function, checkInCount, whose inputs are each given
// (CountRule), and today's shift makes them in one place (countRuleOf). On a shift that counts hours until a time (owner,
// 20 October 2026: "within the same month with no working hours to be counted after 8 PM even if the check out was 11
// PM, record the checkout time but count till the checkout window limit"; its "Count hours until", 8:00 PM on MORNING)
// the counter goes on past the hours to work until then, the extra time filling the month's short hours.

/**
 * What the counter counts with (moments in milliseconds): from the check-in, or `windowStart` when later; until
 * `countUntil` (the window's end with the grace, or the shift's "Count hours until", 8:00 PM on MORNING, since 20
 * October 2026); at most `hoursToWork` unless `extraCounts` (true on a shift with "Count hours until": the time past
 * them makes up the month's short hours). Null: none (from the check-in, never stopped, no target): a plain clock since
 * the check-in.
 */
export interface CountRule {
  windowStart: number | null;
  countUntil: number | null;
  hoursToWork: number | null;
  extraCounts: boolean;
  /**
   * A new employee's first day (owner, 27 October 2026: "Counted from the shift start"): counting from `windowStart` even
   * when the check-in came after it (before `countUntil`), as the day is counted. Missing: from the check-in, as any day.
   */
  fromStart?: boolean;
}

/** No shift to count by: the time since the check-in, with no target (never a wrong one). */
export const PLAIN_COUNT: Readonly<CountRule> = Object.freeze({ windowStart: null, countUntil: null, hoursToWork: null, extraCounts: false });

/**
 * The shift as GET /me/attendance/today sends it: its window (HH:MM), hours to work a day, grace minutes and the time it
 * counts hours until (HH:MM; null or missing, from an API from before 20 October 2026: none).
 */
type TodayShift = NonNullable<CheckInTodayView['shift']>;

/**
 * Today's rule from the shift (attendance.ts): its window on the working day `date` (YYYY-MM-DD, Cairo; a night
 * shift's runs into the next day), its end moved by the grace, and its hours to work (set on the shift, else its
 * whole window: a fixed shift's); time past them doesn't count. With "Count hours until" (owner, 20 October 2026:
 * makesUpHours) the window ends then instead (shiftWindowOn) and the time past the hours to work counts. No shift, or
 * one whose window can't be told: PLAIN_COUNT. On the first working day of their employment (`firstDay`, the API's;
 * owner, 27 October 2026) the count is from the window's start whatever time they checked in (`fromStart`).
 */
export function countRuleOf(date: string, shift: TodayShift | null | undefined, firstDay = false): CountRule {
  if (!shift || typeof shift.startTime !== 'string' || typeof shift.endTime !== 'string') return { ...PLAIN_COUNT };
  const window = shiftWindowOn(date, shift);
  if (!window) return { ...PLAIN_COUNT };
  return { windowStart: window.start, countUntil: window.end, hoursToWork: shiftWorkHours(shift), extraCounts: makesUpHours(shift), ...(firstDay && { fromStart: true }) };
}

/**
 * Where the counter is: waiting for the window's start (checked in early), counting, the hours to work done (stopped
 * there), past them while extra time counts, stopped at `countUntil`, or checked in after it (nothing counts).
 */
export type CountPhase = 'before_start' | 'counting' | 'done' | 'extra' | 'stopped' | 'after_limit';

/** The counter at a moment. */
export interface CheckInCount {
  /** The time counted so far, in whole seconds' milliseconds. */
  countedMs: number;
  phase: CountPhase;
  /** When counting starts: the check-in, or the window's start when later (or on a first day, 27 October 2026). */
  countsFrom: number;
  /** Checked in before the window's start, or on a first day after it: counting from the window's start. */
  fromWindowStart: boolean;
  /** A first day counted from the window's start though the check-in came after it (owner, 27 October 2026). */
  firstDay?: boolean;
  /** The hours to work are reached. */
  hoursDone: boolean;
  /** When the hours to work are done; null without them, or when that is after `countUntil`. */
  doneAt: number | null;
  countUntil: number | null;
  hoursToWork: number | null;
  /** The time today's closed pairs counted before this check-in (25 October 2026), ms; 0 with none. */
  before?: number;
}

const moment = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/**
 * The time counted from a check-in to `now` by a rule (CountRule), as attendance would count a check-out at `now`
 * (there to the minute; here to the second): from the later of the check-in and the window's start, to the earlier of
 * now and `countUntil`, at most the hours to work unless extra time counts, never below 0. Null when the check-in or
 * now isn't a moment. `before` (owner, 25 October 2026: "the working hours to be calculated between the checkin and out
 * only, not the first and last"): the time today's closed pairs counted already (ms), the check-in being the one since
 * the last check-out, so the break between them never counts; together at most the hours to work as before. `fromStart`
 * (a new employee's first day, owner, 27 October 2026: "Counted from the shift start"): a check-in after the window's
 * start and before `countUntil` counts from the window's start, as the day will (packages/shared dayFromPunches); one
 * after `countUntil` counts nothing, as any day's.
 */
export function checkInCount(input: CountRule & { checkIn: number; now: number; before?: number }): CheckInCount | null {
  const checkIn = moment(input.checkIn);
  const now = moment(input.now);
  if (checkIn === null || now === null) return null;
  const windowStart = moment(input.windowStart);
  const countUntil = moment(input.countUntil);
  const hoursToWork = typeof input.hoursToWork === 'number' && input.hoursToWork > 0 && Number.isFinite(input.hoursToWork) ? input.hoursToWork : null;
  const target = hoursToWork === null ? null : Math.round(hoursToWork * 3_600_000);
  const before = Math.max(0, moment(input.before) ?? 0);
  // a first day's check-in after the start, before the limit: from the start (27 October 2026)
  const firstDay = !!input.fromStart && windowStart !== null && checkIn > windowStart && (countUntil === null || checkIn < countUntil);
  const countsFrom = windowStart === null ? checkIn : firstDay ? windowStart : Math.max(checkIn, windowStart);
  const end = countUntil === null ? now : Math.min(now, countUntil);
  const span = before + Math.max(0, end - countsFrom);
  const hoursDone = target !== null && span >= target;
  const counted = hoursDone && !input.extraCounts ? target : span;
  // the hours still to work since this check-in
  const left = target === null ? null : Math.max(0, target - before);
  const doneAt = left === null || (countUntil !== null && countsFrom + left > countUntil) ? null : countsFrom + left;
  const passed = countUntil !== null && now >= countUntil;
  const phase: CountPhase =
    countUntil !== null && countsFrom >= countUntil
      ? 'after_limit'
      : now < countsFrom
        ? 'before_start'
        : hoursDone && !input.extraCounts
          ? 'done'
          : passed
            ? 'stopped'
            : hoursDone
              ? 'extra'
              : 'counting';
  return {
    countedMs: Math.floor(counted / 1000) * 1000,
    phase,
    countsFrom,
    fromWindowStart: (windowStart !== null && checkIn < windowStart) || firstDay,
    hoursDone,
    doneAt,
    countUntil,
    hoursToWork,
    before,
    ...(firstDay && { firstDay }),
  };
}

/** A time counted, as the counter ticks: "3:12:45" (hours, minutes, seconds; never below 0). */
export function durationClock(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** The hours to work, said: "9 hours", "1 hour", "8:30 hours". */
export const hoursToWorkText = (hours: number): string => (Number.isInteger(hours) ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${formatHours(hours)} hours`);

/** What the counter says at a moment: the time counted, a note on where it counts from, and what is next (said politely). */
export interface CounterWords {
  /** "3:12:45". */
  value: string;
  /** "Counting from 9:00 AM, when your shift starts"; null when counting from the check-in. */
  note: string | null;
  /** "Your 9 hours are done at 6:15 PM", "Hours count until 7:15 PM", "Your 9 hours are done"; null with no target. */
  status: string | null;
}

/** The counter's words (times in Cairo, 12 hours). */
export function counterWords(c: CheckInCount): CounterWords {
  const until = c.countUntil === null ? null : cairoClock(c.countUntil);
  const yours = c.hoursToWork === null ? null : `Your ${hoursToWorkText(c.hoursToWork)} ${c.hoursToWork === 1 ? 'is' : 'are'} done`;
  const extra = `${yours}. Extra time${until ? ` until ${until}` : ''} fills short hours this month`;
  let status: string | null = null;
  if (c.phase === 'after_limit') status = `Hours count only until ${until}, so none are counted after it`;
  else if (c.phase === 'done') status = yours;
  else if (c.phase === 'extra' || (c.phase === 'stopped' && c.hoursDone)) status = extra;
  else if (c.phase === 'stopped') status = `Hours counted until ${until}`;
  else if (c.doneAt !== null && yours) status = `${yours} at ${cairoClock(c.doneAt)}`;
  else if (until) status = `Hours count until ${until}`;
  // checked in again after a check-out (25 October 2026): counting since then, with the pairs before it
  const earlier = (c.before ?? 0) > 0 ? `${formatHours(Math.floor((c.before ?? 0) / 60_000) / 60)} from earlier today` : null;
  const note =
    c.fromWindowStart && c.phase !== 'after_limit'
      ? // a first day (27 October 2026): counted from the shift's start though they checked in after it
        `Counting from ${cairoClock(c.countsFrom)}, when your shift starts${c.firstDay ? ' (your first day)' : ''}${earlier ? `, with ${earlier}` : ''}`
      : earlier
        ? `Counting since ${cairoClock(c.countsFrom)}, with ${earlier}; the break isn’t counted`
        : null;
  return { value: durationClock(c.countedMs), note, status };
}

/** What the card shows of the day's time: the counter while checked in, the day's total once checked out, or nothing. */
export type CounterShows = ({ kind: 'live' } & CounterWords) | { kind: 'total'; text: string } | null;

/**
 * The counter for today's view at `now` (the server's clock, ms): while the day's last punch is a check-in, the time
 * counted by today's shift (countRuleOf): since 25 October 2026 (owner: "the working hours to be calculated between the
 * checkin and out only, not the first and last") the closed pairs' hours the server counted and the time since the open
 * check-in (`openAt`), the break between them not counted; from an API from before the pairs, from the day's first
 * check-in, as then. Once checked out, "Worked 8:52 today", the hours the server counted; nothing before a check-in (a
 * day off, a holiday, leave), or for a check-out without one.
 */
export function counterShows(view: Pick<CheckInTodayView, 'date' | 'next' | 'day' | 'shift' | 'firstDay'>, now: number): CounterShows {
  const day = view.day;
  if (!day?.checkIn) return null;
  if (view.next === 'in') return day.checkOut ? { kind: 'total', text: `Worked ${formatHours(day.hoursCounted)} today` } : null;
  const count = liveCount(view, now);
  return count ? { kind: 'live', ...counterWords(count) } : null;
}

/** While checked in, the count at `now` (counterShows' "live"); null otherwise. */
function liveCount(view: Pick<CheckInTodayView, 'date' | 'next' | 'day' | 'shift' | 'firstDay'>, now: number): CheckInCount | null {
  const day = view.day;
  if (!day?.checkIn || view.next !== 'out') return null;
  const paired = Array.isArray(day.pairs);
  const since = paired && day.openAt ? Date.parse(day.openAt) : Date.parse(day.checkIn);
  const before = paired && day.openAt && day.pairs!.length ? Math.round(day.hoursCounted * 3_600_000) : 0;
  // a first day (27 October 2026): the first check-in counts from the shift's start; a check-in after a pair doesn't
  return checkInCount({ ...countRuleOf(view.date, view.shift, !!view.firstDay && before === 0), checkIn: since, now, before });
}

/**
 * What the panel tells a new employee on their first working day (owner, 27 October 2026: "a new employee when checked in
 * in his first day move the checkin to 9am automatically to prevent delay in instructions"): "Your first day: it is
 * counted from your shift’s start, 8:00 AM, whatever time you check in." Null on any other day, and from an API from
 * before it.
 */
export function firstDayNote(view: Pick<CheckInTodayView, 'firstDay' | 'shift'>): string | null {
  if (!view.firstDay) return null;
  const start = view.shift?.startTime ? `, ${timeOfDayText(view.shift.startTime)}` : '';
  return `Your first day: it is counted from your shift’s start${start}, whatever time you check in.`;
}

/** The server's clock as the counter keeps it: the newest server time seen, and how far it is ahead of this device's. */
export interface ServerClock {
  newest: number;
  skew: number;
}

/**
 * The clock after a view's server time is seen on this device (`deviceMs`, the device's clock then): the skew is
 * measured again only from a newer server time, so a page shown again from before (Next.js keeps pages hidden, not
 * unmounted) doesn't set the clock back.
 */
export function noteServerTime(clock: ServerClock, serverMs: number, deviceMs: number): ServerClock {
  if (!Number.isFinite(serverMs) || !Number.isFinite(deviceMs) || !(serverMs > clock.newest)) return clock;
  return { newest: serverMs, skew: serverMs - deviceMs };
}

/** The working day the panel is for: "Monday 19/10/2026". */
export const dayTitle = (date: string): string => `${weekdayOf(date)} ${formatDate(date)}`.trim();

/** Said quietly when HR hasn't set the office's point yet. */
export const OFFICE_NOT_SET_TEXT = "HR hasn't set the office's location on the system yet, so check-ins are kept as location unknown for now.";

/**
 * What the panel says of where the location goes: it is asked each press, and the spot is kept with it (owner, 20
 * October 2026: "Yes, keep the spot"; HR, the CEO and the Super Admin see it).
 */
export const LOCATION_NOTE = `Each press asks your browser for your location to tell the office from remote. ${SPOT_KEPT_TEXT}`;

/**
 * The same inside the employee app, which reads the phone's own location and tells a made-up one (Phase 2, 20 October
 * 2026), and needs it for a press (owner, 20 October 2026: "Refuse without location", "App only").
 */
export const LOCATION_NOTE_IN_APP = `Each press needs your phone’s location to tell the office from remote. ${SPOT_KEPT_TEXT} A location the phone says an app made up is flagged.`;

/**
 * What to do when a press's location couldn't be read (the employee app's Phase 2, 20 October 2026: "a clear message
 * when refused"), said under what the API kept: inside the app, the phone's settings for Trendlix People (the location
 * only while the app is in use); in a browser, the site's permission. Null when there is nothing to do.
 */
export function locationHelpText(error: CheckInLocationError, inApp: boolean): string | null {
  if (error === 'denied') {
    return inApp
      ? 'To check in with your location, allow Trendlix People to use it: on the phone, Settings → Apps → Trendlix People → Permissions → Location → Allow only while using the app, with precise location on. Then press again.'
      : 'To check in with your location, allow this site to use it in your browser’s settings, then press again.';
  }
  if (error === 'unavailable') return inApp ? 'Turn on the phone’s location (Settings → Location), then press again.' : 'Turn on your device’s location, then press again.';
  if (error === 'timeout') return 'Your location took too long to read: move nearer a window or outside, then press again.';
  return null;
}

/** What a press that couldn't be sent says, from the API's answer (a 404 from an API from before it: not there yet). */
export function punchErrors(status: number, messages: readonly string[]): string[] {
  if (status === 404 && messages.some((m) => /^Cannot (GET|POST) /.test(m))) return ['Checking in isn’t available yet: the server doesn’t have it yet. Please try again after its next update.'];
  return messages.length ? [...messages] : ['The check-in couldn’t be sent. Please try again.'];
}

// ---------- the design's Today card (owner, 30 October 2026: the Figma "PeopleTrendlix", desktop) ----------
// The Dashboard's Today card: "TODAY" over the day, a badge ("Not checked in", "In office"), the work time in a ring "of
// 8 hours", the work location, the privacy line and Check in now / Check out. My Attendance's: "TODAY · TUESDAY
// 27/10/2026" over "Ready to start?", the time now (or the time worked) and the location, the Check in button. Words from
// the view only: the place of today's check-in, else where the work arrangement expects them.

/** The day as the Dashboard's card titles it: "Tuesday, 27 October". */
export function longDayTitle(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return dayTitle(date);
  return `${weekdayOf(date)}, ${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1] ?? ''}`.trim();
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Today's punches in the order pressed. */
const inOrder = <P extends Pick<PunchView, 'at'>>(punches: readonly P[]): P[] => [...punches].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

/** The check-in they are checked in on now (the day's last punch, a check-in); none when checked out or not checked in. */
const openCheckIn = (view: Pick<CheckInTodayView, 'next' | 'punches'>): PunchView | null => {
  const last = inOrder(view.punches).at(-1);
  return view.next === 'out' && last?.kind === 'in' ? last : null;
};

/** The badge by the card's title: checked in (strong: "In office", "At home", "Remote"), "Checked out", "Not checked in". */
export function todayBadge(view: Pick<CheckInTodayView, 'next' | 'punches' | 'day'>): { label: string; strong: boolean } {
  const open = openCheckIn(view);
  if (view.next === 'out') {
    const place = open?.place ?? view.day?.place ?? null;
    const label = place === 'office' ? 'In office' : place === 'home' ? 'At home' : place === 'remote' ? 'Remote' : 'Checked in';
    return { label, strong: true };
  }
  return view.day?.checkOut ? { label: 'Checked out', strong: false } : { label: 'Not checked in', strong: false };
}

/** My Attendance's title over today: "Ready to start?", "Checked in at 9:05 AM", "Checked out at 5:10 PM". */
export function todayHeadline(view: Pick<CheckInTodayView, 'next' | 'punches' | 'day'>): string {
  const open = openCheckIn(view);
  const since = open?.at ?? view.day?.openAt ?? view.day?.checkIn ?? null;
  if (view.next === 'out' && since) return `Checked in at ${cairoClock(since)}`;
  if (view.day?.checkOut) return `Checked out at ${cairoClock(view.day.checkOut)}`;
  return 'Ready to start?';
}

/**
 * Where they work today, under "Work location": once checked in, where the check-in was (the office by its check-in
 * location's name when it has one, "Office · Head office"; "Remote - Studio"; "Home"); before, where their arrangement
 * expects them: on official duty now, "Official duty"; on an approved work from home day, "Home"; else "Office" or
 * "Anywhere". Null: nothing known (an API from before it).
 */
export function workLocationText(view: Pick<CheckInTodayView, 'next' | 'punches' | 'day' | 'expected' | 'workingFromHome' | 'officialDuty'>): string | null {
  const ins = inOrder(view.punches).filter((p) => p.kind === 'in');
  const shown = openCheckIn(view) ?? ins[0] ?? null;
  if (shown) return shown.place === 'office' && shown.locationName?.trim() ? `Office · ${shown.locationName.trim()}` : placeLabel(shown.place, shown.locationName, shown.locationKind);
  if (view.day?.checkIn && view.day.place) return placeLabel(view.day.place);
  if (view.officialDuty?.now) return 'Official duty';
  if (view.workingFromHome) return CHECK_IN_PLACE_LABELS.home;
  if (view.expected === 'office') return CHECK_IN_PLACE_LABELS.office;
  if (view.expected === 'anywhere') return 'Anywhere';
  return null;
}

/** The work time in the Dashboard card's ring: "2:35" and its seconds (":12") while checked in, the share of the hours to work, "of 8 hours". */
export interface WorkTime {
  value: string;
  /** The ticking seconds while checked in (":12"); null otherwise. */
  seconds: string | null;
  /** The share of the hours to work, 0 to 1 (0 with none to work by). */
  share: number;
  /** "of 8 hours"; null without a shift to count by. */
  of: string | null;
  /** All of it in words, for a screen reader: "Work time 2:35:12 of 8 hours". */
  label: string;
}

/**
 * The work time at `now` (the server's clock, ms), counted as the counter counts it (counterShows): while checked in, the
 * time so far, ticking; once checked out, the hours the server counted; before a check-in, none ("0:00"). Against the
 * hours today's shift asks (countRuleOf), never past a full ring.
 */
export function workTime(view: Pick<CheckInTodayView, 'date' | 'next' | 'day' | 'shift' | 'firstDay'>, now: number): WorkTime {
  const hoursToWork = countRuleOf(view.date, view.shift).hoursToWork;
  const of = hoursToWork ? `of ${hoursToWorkText(hoursToWork)}` : null;
  const share = (ms: number) => (hoursToWork ? Math.max(0, Math.min(1, ms / (hoursToWork * 3_600_000))) : 0);
  const done = (value: string, seconds: string | null, ms: number): WorkTime => ({ value, seconds, share: share(ms), of, label: ['Work time', `${value}${seconds ?? ''}`, of].filter(Boolean).join(' ') });
  const count = liveCount(view, now);
  if (count) {
    const clock = durationClock(count.countedMs);
    const cut = clock.lastIndexOf(':');
    return done(clock.slice(0, cut), clock.slice(cut), count.countedMs);
  }
  const day = view.day;
  if (view.next === 'in' && day?.checkIn && day.checkOut) return done(formatHours(day.hoursCounted), null, day.hoursCounted * 3_600_000);
  return done(formatHours(0), null, 0);
}
