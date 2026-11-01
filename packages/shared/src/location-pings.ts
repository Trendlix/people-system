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
