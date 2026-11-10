// Hourly location pings while checked in (owner, 1 November 2026: "can the devices ping every 1 hour their location?
// and flag if someone is not in the checked in location?"; asked, chose "Silent automatic ping": the app reads the
// location by itself every hour, no tap, with "Allow all the time" and the employee told first). Only in the app (a
// website can't run in the background), only while checked in, only while the company has it switched on. Each ping
// is read against where they checked in: the office, their approved home, the named place (a sub-location, a client
// location, their remote site), or, for a check-in elsewhere, within PING_NEAR_METRES of its own spot. Outside: "away",
// flagged for HR. Pure: the API decides with it, the web and the app show it.

import { distanceMetres, insideWithAllowance, type CheckInPlace } from './check-in.js';

/** How often the app reads the location while checked in. */
export const PING_EVERY_MINUTES = 60;
/** A ping sooner than this after the last one isn't kept (a retried task, two phones). */
export const PING_MIN_GAP_MINUTES = 20;
/** A check-in at no named place: a ping within this of its spot (accuracy allowed for) is still there. */
export const PING_NEAR_METRES = 300;

export const PING_STATUSES = ['at_place', 'away', 'unknown', 'off'] as const;
export type PingStatus = (typeof PING_STATUSES)[number];

export const PING_STATUS_LABELS: Record<PingStatus, string> = {
  at_place: 'At the check-in place',
  away: 'Away from the check-in place',
  unknown: 'Can’t tell',
  off: 'Location off',
};

/** Why the app sent no point: the app isn't allowed the location all the time, or the phone's location is switched off. */
export const PING_OFF_REASONS = ['permission', 'service'] as const;
export type PingOffReason = (typeof PING_OFF_REASONS)[number];

export const PING_OFF_LABELS: Record<PingOffReason, string> = {
  permission: 'Location not allowed all the time',
  service: 'Phone location switched off',
};

/** Statuses HR is shown as flags: away, or the location off. */
export const flaggedPing = (status: PingStatus | string): boolean => status === 'away' || status === 'off';

/** The check-in a ping is read against: where it was, by place and name, and its spot when kept. */
export interface PingCheckIn {
  place: CheckInPlace;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** A ping as read: the place its point is in (as a check-in's would be), the named place, its point and accuracy. */
export interface PingRead {
  place: CheckInPlace;
  location: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

/** Whether a ping is at the place they checked in, away from it, or can't tell; and how far from the check-in's spot. */
export function pingStatus(checkIn: PingCheckIn, ping: PingRead): { status: PingStatus; distanceMetres: number | null } {
  const spot = checkIn.latitude !== null && checkIn.longitude !== null ? { latitude: checkIn.latitude, longitude: checkIn.longitude } : null;
  const distance = spot ? Math.round(distanceMetres(spot, ping)) : null;
  const at = (inside: boolean) => ({ status: (inside ? 'at_place' : 'away') as PingStatus, distanceMetres: distance });
  if (checkIn.place === 'office') return at(ping.place === 'office');
  if (checkIn.place === 'home') return at(ping.place === 'home');
  if (checkIn.locationName) return at(ping.location === checkIn.locationName);
  if (distance === null) return { status: 'unknown', distanceMetres: null };
  return at(insideWithAllowance(distance, ping.accuracy, PING_NEAR_METRES));
}

/** A ping kept, as HR and the employee see it. */
export interface PingView {
  at: string;
  status: PingStatus;
  /** Where it was read: Office, Home, a place's name, Remote. */
  placeText: string;
  distanceMetres: number | null;
  accuracyMetres: number | null;
  latitude: number | null;
  longitude: number | null;
}

// ---------- a day's hourly location for everyone, on Daily Attendance ----------
// (owner, 10 November 2026: "the hourly ping is not working too, i cant find it in the system", then "can it be embeded
// in the attendance page?"): everyone checked in on the system that day, with their pings (the flagged first), and for
// someone with none, why: iPhones don't send it yet (the location only at check-in and check-out, docs/app-store.md),
// the website can't, an hour hasn't passed, or none came from their Android phone.

/** Why someone checked in that day has no pings. */
export const NO_PING_REASONS = ['iphone', 'no_app', 'too_soon', 'none_received'] as const;
export type NoPingReason = (typeof NO_PING_REASONS)[number];

export const NO_PING_REASON_LABELS: Record<NoPingReason, string> = {
  iphone: 'iPhone: hourly location not on iPhones yet',
  no_app: 'Doesn’t use the app: the website can’t send it',
  too_soon: 'Checked in for less than an hour',
  none_received: 'None received from their Android phone',
};

/** The phone of someone's app from its sign-in's user agent ("Trendlix People/0.6.52 (iOS) TrendLIXPeople"): other when it says neither. */
export function appPhoneOf(userAgent: string | null | undefined): 'ios' | 'android' | 'other' {
  const ua = userAgent ?? '';
  if (/\(ios\)|iPhone|iPad/i.test(ua)) return 'ios';
  if (/\(android\)|Android/i.test(ua)) return 'android';
  return 'other';
}

/**
 * Why someone checked in has no pings: the first ping comes an hour after the check-in, so a check-in (or a stay) of
 * less than an hour has none yet; else their phone (null: no sign-in in the app by then): an iPhone's app doesn't send
 * it, without the app the website can't, any other phone's should have.
 */
export function noPingReason(p: { phone: 'ios' | 'android' | 'other' | null; checkIn: string | null; checkOut: string | null }, now: Date): NoPingReason {
  const start = p.checkIn ? Date.parse(p.checkIn) : NaN;
  const end = p.checkOut ? Date.parse(p.checkOut) : now.getTime();
  if (Number.isFinite(start) && end - start < PING_EVERY_MINUTES * 60_000) return 'too_soon';
  if (p.phone === 'ios') return 'iphone';
  if (p.phone === null) return 'no_app';
  return 'none_received';
}

/** Someone's day: their check-in and check-out, where they checked in, their pings and, with none, why. */
export interface DayPingsPerson {
  employee: { id: string; fullNameEn: string; employeeCode: string; department: string | null };
  /** The day's first check-in, and its last check-out when it came after it (null: still checked in). */
  checkIn: string | null;
  checkOut: string | null;
  /** Where they checked in: Office, Home, a place's name, Remote, Location unknown. */
  checkInPlace: string | null;
  pings: PingView[];
  /** Away, or the location off. */
  flagged: number;
  noPings: NoPingReason | null;
}

/** GET /attendance/pings?date=: the day, whether the company has it switched on, and everyone's. */
export interface DayPingsView {
  date: string;
  enabled: boolean;
  people: DayPingsPerson[];
}

/** The order shown: the flagged first (most first), then those with pings, then those without; by name within each. */
export function dayPingsOrder<P extends Pick<DayPingsPerson, 'flagged' | 'pings'> & { employee: { fullNameEn: string } }>(people: readonly P[]): P[] {
  const rank = (p: P) => (p.flagged > 0 ? 0 : p.pings.length > 0 ? 1 : 2);
  return [...people].sort((a, b) => rank(a) - rank(b) || b.flagged - a.flagged || a.employee.fullNameEn.localeCompare(b.employee.fullNameEn, 'en'));
}
