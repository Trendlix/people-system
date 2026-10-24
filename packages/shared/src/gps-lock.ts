// Locking Office staff's check-ins to the check-in locations by GPS (owner, 24 October 2026, on a profile with "Can check
// in from anywhere" and "Can check in without a location" unticked: "while these aare not checked, people can still check
// in and out from anywhere"). The office network's lock (office-network.ts) needs the key on the server and in Vercel and
// a fixed office address, which the owner will set up; until then a press outside every check-in location was only kept
// as remote. Asked, the owner chose "Yes, add a GPS lock too": a switch on Check-in Setup; Office staff inside a check-in
// location's circle, with an allowance for the GPS's accuracy, to check in or out; unless HR lets them check in from
// anywhere, or it is an approved work from home day, an approved official duty, or one of their approved places (their
// home, a remote site; a client location counts for everyone); best in the app, since a browser's location is rougher;
// no key or fixed address needed. With both locks on, a press passes when either does (on the office network, or inside
// a circle), so a rough reading on the office Wi-Fi isn't refused. HR's own recording of a day is never locked. A location
// the phone said is a mock one inside a circle passes (it is still flagged "Fake GPS suspected"): the lock trusts the
// point it is given. Pure: the API decides with these and the web shows the same words.

import { distanceMetres, officeLocationSet, type HomePoint, type LocationReading, type OfficeLocation } from './check-in.js';
import { NETWORK_LOCKED_ARRANGEMENTS, OFF_NETWORK_MESSAGE, type NetworkLockPerson } from './office-network.js';
import { NO_LOCATION_MESSAGE, type LocationRulePerson } from './punch-location.js';
import { networkNeededText, type CheckInPlaces } from './sub-locations.js';

// ---------- the setting ----------

/** The switch on Check-in Setup (owner, 24 October 2026: "Yes, add a GPS lock too"). */
export const GPS_LOCK_LABEL = 'Refuse Office staff’s check-ins and check-outs outside the check-in locations';

/** The most of a reading's accuracy taken off its distance: a reading counts as inside when distance − min(accuracy, 100 m) ≤ the radius. */
export const GPS_ACCURACY_ALLOWANCE_MAX = 100;

/** A reading less accurate than this is too rough to tell (200 m to start with; HR sets 50 to 500 m). */
export const GPS_ROUGH_DEFAULT = 200;
export const GPS_ROUGH_MIN = 50;
export const GPS_ROUGH_MAX = 500;

/** The lock as set on Check-in Setup: the switch, and the accuracy past which a reading is too rough. */
export interface GpsLockSetting {
  lock: boolean;
  roughMetres: number;
}

/** Why the "too rough" limit can't be saved (none: it can): whole metres from 50 to 500. */
export function gpsRoughProblems(metres: number): string[] {
  if (Number.isInteger(metres) && metres >= GPS_ROUGH_MIN && metres <= GPS_ROUGH_MAX) return [];
  return [`Enter the accuracy past which a reading is too rough in whole metres from ${GPS_ROUGH_MIN} to ${GPS_ROUGH_MAX}, e.g. ${GPS_ROUGH_DEFAULT}.`];
}

/** Why the lock can't be switched on: without the main office every Office check-in would be refused. */
export const GPS_LOCK_NEEDS_OFFICE = 'Add the main office (Check-in Locations, above) before switching the lock on: without it, every Office check-in would be refused.';

/** Whether the lock is in force: switched on, with the main office's point set. */
export const gpsLockInForce = (setting: GpsLockSetting, places: Pick<CheckInPlaces, 'main'>): boolean => setting.lock && places.main !== null && officeLocationSet(places.main);

/**
 * Whether someone's check-ins and check-outs need a check-in location (owner, 24 October 2026), as the office network's
 * lock reads them: the lock in force, their current employment Office, and HR hasn't let them check in from anywhere.
 * Hybrid, Outdoor, Indoor and outdoor and Work from home staff aren't locked. A work from home day or an official duty
 * waives it for the press (gpsLockVerdict's `waived`).
 */
export function lockedToCheckInLocations(setting: GpsLockSetting, places: Pick<CheckInPlaces, 'main'>, person: NetworkLockPerson): boolean {
  return gpsLockInForce(setting, places) && NETWORK_LOCKED_ARRANGEMENTS.includes(person.workArrangement) && !person.checkInAnywhere;
}

// ---------- inside a circle ----------

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** What of a reading's accuracy is allowed for: all of it up to 100 m; none when it isn't known. */
export const accuracyAllowance = (accuracy: number | null | undefined): number => (isNumber(accuracy) && accuracy > 0 ? Math.min(accuracy, GPS_ACCURACY_ALLOWANCE_MAX) : 0);

/** Whether a reading `distance` metres from a place's point counts as inside its radius: distance − min(accuracy, 100 m) ≤ radius. */
export const insideWithAllowance = (distance: number, accuracy: number | null | undefined, radiusMetres: number): boolean => distance - accuracyAllowance(accuracy) <= radiusMetres;

/** A place a reading is held to: its point and radius, and its name (none: the main office without one, or a home). */
type Circle = Pick<OfficeLocation, 'latitude' | 'longitude' | 'radiusMetres'> & { name?: string | null };

/** The person's own approved places besides the company's (home-locations.ts): their home, and their remote sites. */
export interface OwnPlaces {
  home: HomePoint | null;
  sites: readonly (HomePoint & { name: string })[];
}

const validPoint = (r: LocationReading | null | undefined): r is LocationReading =>
  !!r && isNumber(r.latitude) && isNumber(r.longitude) && Math.abs(r.latitude) <= 90 && Math.abs(r.longitude) <= 180;

const within = (reading: LocationReading, c: Circle): boolean =>
  officeLocationSet(c) && insideWithAllowance(distanceMetres(reading, { latitude: c.latitude!, longitude: c.longitude! }), reading.accuracy, c.radiusMetres);

// ---------- a press's verdict ----------

/** Why the lock refused a press: outside every circle, a reading too rough to tell, or no location at all. */
export const GPS_REFUSALS = ['outside', 'too_rough', 'no_location'] as const;
export type GpsRefusal = (typeof GPS_REFUSALS)[number];

/** The reason the audit log keeps for each (check_in_refused). */
export const GPS_REFUSAL_REASONS: Record<GpsRefusal, string> = { outside: 'outside_locations', too_rough: 'too_rough', no_location: 'no_location' };

/** What a press is held to by the lock. */
export interface GpsLockInput {
  setting: GpsLockSetting;
  person: NetworkLockPerson & LocationRulePerson;
  /** The main office, the sub-locations (with whether the person is linked) and the client locations in force. */
  places: CheckInPlaces;
  own?: OwnPlaces;
  reading: LocationReading | null | undefined;
  /** An approved work from home day, or an approved official duty now: the lock doesn't apply. */
  waived: boolean;
  /** The press comes from an office network the website signed and the server trusts: it is at the office. */
  officeNetwork: boolean;
}

/** The lock's verdict: whether it applies to the press, why it refused it (null: it passes), and (outside) the nearest company place. */
export interface GpsLockVerdict {
  locked: boolean;
  refused: GpsRefusal | null;
  nearest: { name: string; distanceMetres: number } | null;
}

/**
 * A press's verdict (owner, 24 October 2026). Not locked (the lock off, not Office staff, HR's "Can check in from
 * anywhere", a work from home day or an official duty): it passes. Locked, it passes from an office network (it is at the
 * office); without a reading, only with HR's "Can check in without a location"; a reading less accurate than the limit
 * is too rough; inside the main office, one of their own sub-locations, a client location, their approved home or one of
 * their remote sites (each with the accuracy allowance), it passes; else it is outside, with the nearest of the company's
 * places it may check in at (the main office, their own sub-locations, the client locations) and how far its point is.
 */
export function gpsLockVerdict(input: GpsLockInput): GpsLockVerdict {
  const pass = (locked: boolean): GpsLockVerdict => ({ locked, refused: null, nearest: null });
  if (input.waived || !lockedToCheckInLocations(input.setting, input.places, input.person)) return pass(false);
  if (input.officeNetwork) return pass(true);
  const reading = input.reading;
  if (!validPoint(reading)) return input.person.checkInWithoutLocation ? pass(true) : { locked: true, refused: 'no_location', nearest: null };
  if (isNumber(reading.accuracy) && reading.accuracy > input.setting.roughMetres) return { locked: true, refused: 'too_rough', nearest: null };
  const company: Circle[] = [
    ...(input.places.main ? [input.places.main] : []),
    ...input.places.subLocations.filter((s) => s.linked),
    ...(input.places.clients ?? []),
  ];
  const personal: Circle[] = [...(input.own?.home ? [input.own.home] : []), ...(input.own?.sites ?? [])];
  if ([...company, ...personal].some((c) => within(reading, c))) return pass(true);
  let nearest: { name: string; distanceMetres: number; edge: number } | null = null;
  for (const c of company) {
    if (!officeLocationSet(c)) continue;
    const d = distanceMetres(reading, { latitude: c.latitude!, longitude: c.longitude! });
    if (!nearest || d - c.radiusMetres < nearest.edge) nearest = { name: c.name?.trim() || 'the office', distanceMetres: Math.round(d), edge: d - c.radiusMetres };
  }
  return { locked: true, refused: 'outside', nearest: nearest && { name: nearest.name, distanceMetres: nearest.distanceMetres } };
}

// ---------- the two locks together ----------

/** A press refused by the locks: which lock said it, the reason kept in the audit log, and what the employee is told. */
export interface CheckInLockRefusal {
  lock: 'network' | 'locations';
  reason: string;
  /** Both locks applied and both failed: why the network did (none signed, or signed and off the networks). */
  network?: 'off_network' | 'not_signed';
  message: string;
}

/** "350 m", "1.2 km", "12 km": a distance as the refusal says it. */
export function distanceText(metres: number): string {
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10).toLocaleString('en-US')} m`;
  if (metres < 10_000) return `${(Math.round(metres / 100) / 10).toLocaleString('en-US')} km`;
  return `${Math.round(metres / 1000).toLocaleString('en-US')} km`;
}

/** What a press outside every check-in location is told (the website and the app). */
export function gpsOutsideMessage(nearest: { name: string; distanceMetres: number } | null, offNetworkToo = false): string {
  const where = nearest ? `You're about ${distanceText(nearest.distanceMetres)} from ${nearest.name}` : "You're not at the office";
  return `${where}${offNetworkToo ? ' and not on the office network' : ''}; check in at the office, or ask HR for an attendance correction.`;
}

/** What a reading too rough to tell is told. */
export const GPS_TOO_ROUGH_MESSAGE = "Your location is too rough to tell if you're at the office: use the app, or turn on precise location.";
const GPS_TOO_ROUGH_OFF_NETWORK = "Your location is too rough to tell if you're at the office: use the app, turn on precise location, or connect to the office Wi-Fi.";

/** The beginning every "outside" refusal has, for the panel to know it. */
const OUTSIDE_STARTS = ["You're about ", "You're not at the office"];

/** Whether a message is the GPS lock's refusal of a press outside the check-in locations. */
export const isGpsOutsideMessage = (m: string): boolean => OUTSIDE_STARTS.some((s) => m.startsWith(s)) && m.endsWith('ask HR for an attendance correction.');

/** Whether a message is the GPS lock's refusal of a reading too rough to tell. */
export const isGpsTooRoughMessage = (m: string): boolean => m === GPS_TOO_ROUGH_MESSAGE || m === GPS_TOO_ROUGH_OFF_NETWORK;

/**
 * The two locks together (owner, 24 October 2026: either passing is enough): with neither applying to the press, none;
 * with the office network's lock applying and passing (on the network, or waived at their own place), none; with the GPS
 * lock applying and passing, none. Else the press is refused: by the GPS lock's words when it applied (saying the network
 * too when both did), else the office network's. `network.locked`: the network's lock applies to the person
 * (lockedToOfficeNetwork; a work from home day or an official duty shows as not refused); `refused`: punchNetwork's.
 */
export function checkInLockRefusal(network: { locked: boolean; refused: boolean; signed: boolean }, gps: GpsLockVerdict): CheckInLockRefusal | null {
  if (!network.locked && !gps.locked) return null;
  if (network.locked && !network.refused) return null;
  if (gps.locked && gps.refused === null) return null;
  const why = network.signed ? 'off_network' : 'not_signed';
  if (gps.locked && gps.refused) {
    const both = network.locked;
    const message =
      gps.refused === 'outside'
        ? gpsOutsideMessage(gps.nearest, both)
        : gps.refused === 'too_rough'
          ? both
            ? GPS_TOO_ROUGH_OFF_NETWORK
            : GPS_TOO_ROUGH_MESSAGE
          : both
            ? OFF_NETWORK_MESSAGE
            : NO_LOCATION_MESSAGE;
    return { lock: 'locations', reason: GPS_REFUSAL_REASONS[gps.refused], ...(both && { network: why }), message };
  }
  return { lock: 'network', reason: why, message: OFF_NETWORK_MESSAGE };
}

// ---------- what the check-in panel says before a press ----------

/** What the panel tells someone held to the check-in locations, before they press. */
export const GPS_NEEDED_TEXT = 'Check-ins need you at the office: your location is checked when you check in or out, and the app reads it more precisely than a browser.';

/** What it tells someone held to both locks. */
export const BOTH_LOCKS_NEEDED_TEXT = 'Check-ins need you at the office: on the office Wi-Fi, or with your location inside the office’s area.';

/**
 * What the panel tells someone locked, before they press: the office network's words (with their own sub-locations),
 * the check-in locations', or both locks' (either passes).
 */
export function checkInLockText(locks: { network: boolean; gps: boolean }, ownPlaces: readonly string[] = []): string | null {
  if (!locks.gps) return locks.network ? networkNeededText(ownPlaces) : null;
  const names = [...new Set(ownPlaces.map((n) => n.trim()).filter(Boolean))];
  const own = names.length ? ` Your own check-in place${names.length === 1 ? '' : 's'} (${names.join(', ')}) count${names.length === 1 ? 's' : ''} too.` : '';
  return `${locks.network ? BOTH_LOCKS_NEEDED_TEXT : GPS_NEEDED_TEXT}${own}`;
}
