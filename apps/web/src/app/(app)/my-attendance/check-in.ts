import {
  cairoClock,
  CHECK_IN_FLAG_LABELS,
  CHECK_IN_LOCATION_ERRORS,
  CHECK_IN_PLACE_LABELS,
  checkInRefusal,
  formatHours,
  isCheckInFlag,
  isPunchKind,
  mostHoursCountedADay,
  PUNCH_KIND_LABELS,
  shiftWindowOn,
  type CheckInLocationError,
  type CheckInPlace,
  type PunchKind,
} from '@trendlix/shared';
import type { CheckInTodayView, PunchedDayView, PunchView } from '../../../lib/attendance-types';
import { formatDate } from '../../../lib/format';
import { weekdayOf } from '../organization/holidays/holidays';

// Checking in on the system (owner, 19 October 2026, pasting the list and writing "Proceed with those": "Check-in through
// the system (phone or web with the office location check, or a device) to replace Zoho"). One big button, Check in or
// Check out as the day stands, on the employee's Dashboard, at the top of My Attendance, and on the home page of HR, the
// CEO and Finance with an employee profile. Each press asks the browser where the phone or computer is, fresh and as
// precise as it can within 10 seconds, and sends that point (or why there is none: refused, unavailable, too slow, a
// browser without it) with Check in or Check out; never a time: the server's is the punch's. The API reads the point
// against the office's and drops it: only office, remote or location unknown is kept. Pure code, tested: reading the
// location, the press as the API takes it, and the panel's words. Relative imports: the tests run without "@/".

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

/** A place in words: Office, Remote, Location unknown. */
export const placeLabel = (place: CheckInPlace | null | undefined): string => (place ? (CHECK_IN_PLACE_LABELS[place] ?? place) : '—');

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
}

/** Today's punches in the order pressed: "Check-in · 9:05 AM · Office · ±18 m", with their flags. */
export function punchRows(punches: readonly PunchView[]): PunchRow[] {
  return [...punches]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((p, i) => ({
      key: `${i}-${p.kind}-${p.at}`,
      label: PUNCH_KIND_LABELS[p.kind] ?? p.kind,
      time: cairoClock(p.at),
      place: placeLabel(p.place),
      accuracy: accuracyText(p.accuracyMetres),
      flags: flagLabels(p.flags),
    }));
}

/** The day so far: "9:05 AM → 5:10 PM", "9:05 AM → not checked out yet", "No check-in → 5:10 PM". */
export function dayTimesText(day: Pick<PunchedDayView, 'checkIn' | 'checkOut'>): string {
  return `${day.checkIn ? cairoClock(day.checkIn) : 'No check-in'} → ${day.checkOut ? cairoClock(day.checkOut) : 'not checked out yet'}`;
}

/** The day's hours: counted once they check out by the shift's rule, none without a check-in. */
export function dayHoursText(day: Pick<PunchedDayView, 'checkIn' | 'checkOut' | 'hoursCounted'>): string {
  if (day.checkIn && day.checkOut) return `${formatHours(day.hoursCounted)} counted`;
  if (day.checkIn) return 'Counted once you check out';
  return 'No hours counted without a check-in';
}

// ---------- the check-in counter ----------
// Owner, 20 October 2026: "employees need to see a checkin counter after their checkin." While checked in, the time
// worked so far ticks each second, counted the way attendance will count it once they check out (attendance.ts
// hoursCountedForDay, which dayFromPunches uses): from the check-in, or the shift window's start when later; until the
// window's end moved by the grace (owner, 19 October 2026: "if the employee checked in 10:15 he can check out till 7:15
// and the 9 hours are counted"); at most the hours to work. With them, when the hours will be done. Once checked out,
// the day's hours counted by the server. The counting rule is about to change (owner, 20 October 2026: "within the same
// month with no working hours to be counted after 8 PM even if the check out was 11 PM, record the checkout time but
// count till the checkout window limit"): so the arithmetic is one function, checkInCount, whose inputs are each given
// (CountRule), and today's shift makes them in one place (countRuleOf): the next rule changes those, not the panel.

/**
 * What the counter counts with (moments in milliseconds): from the check-in, or `windowStart` when later; until
 * `countUntil` (today the window's end with the grace; later the shift's check-out limit, 8:00 PM on MORNING); at
 * most `hoursToWork` unless `extraCounts` (today false; later true, the time past them making up the month's short
 * hours). Null: none (from the check-in, never stopped, no target): a plain clock since the check-in.
 */
export interface CountRule {
  windowStart: number | null;
  countUntil: number | null;
  hoursToWork: number | null;
  extraCounts: boolean;
}

/** No shift to count by: the time since the check-in, with no target (never a wrong one). */
export const PLAIN_COUNT: Readonly<CountRule> = Object.freeze({ windowStart: null, countUntil: null, hoursToWork: null, extraCounts: false });

/** The shift as GET /me/attendance/today sends it: its window (HH:MM), hours to work a day and grace minutes. */
type TodayShift = NonNullable<CheckInTodayView['shift']>;

/**
 * Today's rule from the shift (attendance.ts): its window on the working day `date` (YYYY-MM-DD, Cairo; a night
 * shift's runs into the next day), its end moved by the grace, and its hours to work (set on the shift, else its
 * whole window: a fixed shift's); time past them doesn't count. No shift, or one whose window can't be told: PLAIN_COUNT.
 */
export function countRuleOf(date: string, shift: TodayShift | null | undefined): CountRule {
  if (!shift || typeof shift.startTime !== 'string' || typeof shift.endTime !== 'string') return { ...PLAIN_COUNT };
  const window = shiftWindowOn(date, shift);
  if (!window) return { ...PLAIN_COUNT };
  return { windowStart: window.start, countUntil: window.end, hoursToWork: mostHoursCountedADay(shift), extraCounts: false };
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
  /** When counting starts: the check-in, or the window's start when later. */
  countsFrom: number;
  /** Checked in before the window's start: counting from it. */
  fromWindowStart: boolean;
  /** The hours to work are reached. */
  hoursDone: boolean;
  /** When the hours to work are done; null without them, or when that is after `countUntil`. */
  doneAt: number | null;
  countUntil: number | null;
  hoursToWork: number | null;
}

const moment = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/**
 * The time counted from a check-in to `now` by a rule (CountRule), as attendance would count a check-out at `now`
 * (there to the minute; here to the second): from the later of the check-in and the window's start, to the earlier of
 * now and `countUntil`, at most the hours to work unless extra time counts, never below 0. Null when the check-in or
 * now isn't a moment.
 */
export function checkInCount(input: CountRule & { checkIn: number; now: number }): CheckInCount | null {
  const checkIn = moment(input.checkIn);
  const now = moment(input.now);
  if (checkIn === null || now === null) return null;
  const windowStart = moment(input.windowStart);
  const countUntil = moment(input.countUntil);
  const hoursToWork = typeof input.hoursToWork === 'number' && input.hoursToWork > 0 && Number.isFinite(input.hoursToWork) ? input.hoursToWork : null;
  const target = hoursToWork === null ? null : Math.round(hoursToWork * 3_600_000);
  const countsFrom = windowStart === null ? checkIn : Math.max(checkIn, windowStart);
  const end = countUntil === null ? now : Math.min(now, countUntil);
  const span = Math.max(0, end - countsFrom);
  const hoursDone = target !== null && span >= target;
  const counted = hoursDone && !input.extraCounts ? target : span;
  const doneAt = target === null || (countUntil !== null && countsFrom + target > countUntil) ? null : countsFrom + target;
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
    fromWindowStart: windowStart !== null && checkIn < windowStart,
    hoursDone,
    doneAt,
    countUntil,
    hoursToWork,
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
  const note = c.fromWindowStart && c.phase !== 'after_limit' ? `Counting from ${cairoClock(c.countsFrom)}, when your shift starts` : null;
  return { value: durationClock(c.countedMs), note, status };
}

/** What the card shows of the day's time: the counter while checked in, the day's total once checked out, or nothing. */
export type CounterShows = ({ kind: 'live' } & CounterWords) | { kind: 'total'; text: string } | null;

/**
 * The counter for today's view at `now` (the server's clock, ms): while the day's last punch is a check-in, the time
 * counted from the day's first check-in (attendance counts from the first check-in to the last check-out, so a second
 * check-in after checking out goes on from the first) by today's shift (countRuleOf); once checked out, "Worked 8:52
 * today", the hours the server counted; nothing before a check-in (a day off, a holiday, leave), or for a check-out
 * without one.
 */
export function counterShows(view: Pick<CheckInTodayView, 'date' | 'next' | 'day' | 'shift'>, now: number): CounterShows {
  const day = view.day;
  if (!day?.checkIn) return null;
  if (view.next === 'in') return day.checkOut ? { kind: 'total', text: `Worked ${formatHours(day.hoursCounted)} today` } : null;
  const count = checkInCount({ ...countRuleOf(view.date, view.shift), checkIn: Date.parse(day.checkIn), now });
  return count ? { kind: 'live', ...counterWords(count) } : null;
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

/** What the panel says of where the location goes (it is asked each press, and never kept). */
export const LOCATION_NOTE =
  'Each press asks your browser for your location to tell the office from remote. Only office, remote or location unknown is kept, never where you are.';

/** The same inside the employee app, which reads the phone's own location and tells a made-up one (Phase 2, 20 October 2026). */
export const LOCATION_NOTE_IN_APP =
  'Each press asks your phone for your location to tell the office from remote. Only office, remote or location unknown is kept, never where you are; a location the phone says an app made up is flagged.';

/**
 * What to do when a press's location couldn't be read (the employee app's Phase 2, 20 October 2026: "a clear message
 * when refused"), said under what the API kept: inside the app, the phone's settings for TrendLIX People (the location
 * only while the app is in use); in a browser, the site's permission. Null when there is nothing to do.
 */
export function locationHelpText(error: CheckInLocationError, inApp: boolean): string | null {
  if (error === 'denied') {
    return inApp
      ? 'To check in with your location, allow TrendLIX People to use it: on the phone, Settings → Apps → TrendLIX People → Permissions → Location → Allow only while using the app, with precise location on. Then press again.'
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
