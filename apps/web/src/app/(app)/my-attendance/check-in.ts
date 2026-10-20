import {
  cairoClock,
  CHECK_IN_FLAG_LABELS,
  CHECK_IN_LOCATION_ERRORS,
  CHECK_IN_PLACE_LABELS,
  checkInRefusal,
  formatHours,
  isCheckInFlag,
  isPunchKind,
  PUNCH_KIND_LABELS,
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

/**
 * How long since the day's first check-in while not checked out yet, in hours (the phone pages' Home, owner, 20 October
 * 2026: the employee app, "check in and out"): the time on the clock, not the hours counted, which the shift's rule
 * counts once they check out; null when not checked in, or checked out.
 */
export function hoursSoFar(day: Pick<PunchedDayView, 'checkIn' | 'checkOut'> | null | undefined, nowMs: number): number | null {
  if (!day?.checkIn || day.checkOut) return null;
  const from = Date.parse(day.checkIn);
  if (!Number.isFinite(from) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, (nowMs - from) / 3_600_000);
}

/** The time since the first check-in, said: "3:25 since you checked in"; null as hoursSoFar. */
export function hoursSoFarText(day: Pick<PunchedDayView, 'checkIn' | 'checkOut'> | null | undefined, nowMs: number): string | null {
  const hours = hoursSoFar(day, nowMs);
  return hours === null ? null : `${formatHours(hours)} since you checked in`;
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
