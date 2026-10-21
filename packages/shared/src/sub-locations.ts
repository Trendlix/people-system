// The main office and its sub-locations (owner, 20 October 2026, of Attendance → Check-in Setup's Check-in Locations:
// "for this part, it looks unarranged to me, it needs to be more handsome. main office location is the hero and other
// locations are like sub locations. shown with their name and linked users"). Asked of the sub-locations, the owner
// answered "own sublocation shows the sub location name", and "will check it and shows remote too / any checkin rather
// than the office location counts remote and named with the location name (Remote - Location name)". So:
// - One main office. A check-in within it is Office, for everyone, as before; the office networks still mean it.
// - Sub-locations, each a name, a point, a radius and the people linked to it (an employee may be linked to several).
//   A check-in within one is remote for every rule (the payroll's days, the work arrangement, the flags), kept as
//   'remote' with the sub-location's name (the punch's locationName) and shown as "Remote - Studio". For anyone, linked
//   or not: someone not linked to it is flagged "Not their location", for HR to check; a linked person isn't.
// - On an office day, a linked person at their own sub-location isn't flagged outside the office, since it is their
//   place; anyone else at a sub-location is, as any remote check-in (check-in.ts checkInFlags).
// - The office network's lock (Claude's default, 20 October 2026, which the owner can change): a locked Office person
//   linked to a sub-location may check in within it off the office network, since it is their place; it is kept as
//   "Remote - Studio". Anyone else is still refused there. A location the phone said is a mock one never waives it.
// - The order a press's place is read in: the main office, then the person's own sub-location, then any sub-location,
//   then their approved home ("Home", as before), then remote; without a reading, location unknown.
// Pure: the API decides with these and the web shows the same words.

import {
  CHECK_IN_PLACE_LABELS,
  distanceMetres,
  officeLocationSet,
  type CheckInPlace,
  type HomePoint,
  type LocationReading,
  type OfficeLocation,
  type SubLocationAt,
} from './check-in.js';
import { NETWORK_NEEDED_TEXT } from './office-network.js';

// ---------- the words ----------

/** What the main office is called on Check-in Setup. */
export const MAIN_OFFICE_LABEL = 'Main office';

/** What a check-in within a sub-location shows as: "Remote - Studio" (owner: "(Remote - Location name)"). */
export const subLocationLabel = (name: string): string => `${CHECK_IN_PLACE_LABELS.remote} - ${name.trim().replace(/\s+/g, ' ')}`;

/**
 * A press's place in words: "Remote - Studio" for a remote press within a sub-location (its locationName), else the
 * place's own word (Office, Home, Remote, Location unknown). An office press's location name isn't in its word: Office.
 */
export function pressPlaceLabel(place: string, locationName?: string | null): string {
  if (place === 'remote' && locationName?.trim()) return subLocationLabel(locationName);
  return CHECK_IN_PLACE_LABELS[place as CheckInPlace] ?? place;
}

/** A person's own sub-locations, as their profile says them: "Check-in places: Studio, Client X"; none: null. */
export function checkInPlacesText(names: readonly string[]): string | null {
  const shown = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  return shown.length ? `Check-in places: ${shown.join(', ')}` : null;
}

/** How many linked people a sub-location's card names before "+N more". */
export const LINKED_PEOPLE_SHOWN = 5;

/** The most people linked in one go. */
export const LINK_PEOPLE_MAX = 100;

/** Under this radius the main office's card hints a wider one: phones are often that far off. */
export const SMALL_RADIUS_METRES = 50;
export const SMALL_RADIUS_HINT = 'Phones are often 10–30 m off; 50–80 m is safer.';

/** Why the main office isn't removed: while there are sub-locations, another is made the main first. */
export const MAIN_OFFICE_REMOVE_REFUSED = 'Make another location the main office first: the main office can’t be removed while there are sub-locations.';

/** Why no one is linked to the main office: it is everyone's. */
export const MAIN_OFFICE_LINK_REFUSED = 'The main office is everyone’s: link people to a sub-location instead.';

/**
 * What the check-in panel says when the person's check-ins are locked to the office network: the network, and (for
 * someone linked to sub-locations) that at their own they may check in off it.
 */
export function networkNeededText(ownPlaces: readonly string[] = []): string {
  const names = [...new Set(ownPlaces.map((n) => n.trim()).filter(Boolean))];
  if (!names.length) return NETWORK_NEEDED_TEXT;
  return `${NETWORK_NEEDED_TEXT} At your own check-in place${names.length === 1 ? '' : 's'} (${names.join(', ')}) you can check in off it.`;
}

// ---------- where a press was ----------

/** A sub-location as a press is read against it: its point, radius and name, and whether the person pressing is linked to it. */
export interface SubLocationPoint extends OfficeLocation {
  name: string;
  linked: boolean;
}

/** The places a press is read against: the main office (none: not set yet) and the sub-locations. */
export interface CheckInPlaces {
  main: OfficeLocation | null;
  subLocations: readonly SubLocationPoint[];
}

/** Where a press was: the place, the reading's accuracy (whole metres), the location's name, and the sub-location it was within. */
export interface PlaceRead {
  place: CheckInPlace;
  accuracyMetres: number | null;
  /** The main office's name (Office), or the sub-location's (remote). */
  location?: string;
  /** Within a sub-location: its name and whether the person is linked to it. */
  subLocation?: SubLocationAt;
}

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The nearest of `places` the reading is within its radius of; none: outside them all. */
function nearestWithin<P extends OfficeLocation>(reading: LocationReading, places: readonly P[]): P | null {
  let best: { place: P; d: number } | null = null;
  for (const p of places) {
    if (!officeLocationSet(p)) continue;
    const d = distanceMetres(reading, { latitude: p.latitude!, longitude: p.longitude! });
    if (d <= p.radiusMetres && (!best || d < best.d)) best = { place: p, d };
  }
  return best?.place ?? null;
}

/**
 * Where a press was (owner, 20 October 2026: "main office location is the hero and other locations are like sub
 * locations"): within the main office, Office (its name kept); else within one of the person's own sub-locations, the
 * nearest of them, else within any sub-location, the nearest: remote, with its name and whether they're linked; else
 * within their approved home, Home; else remote, or location unknown while no location has its point set. No reading,
 * or one that isn't a point: location unknown.
 */
export function checkInPlaceAt(reading: LocationReading | null | undefined, places: CheckInPlaces, home: HomePoint | null = null): PlaceRead {
  if (!reading || !isNumber(reading.latitude) || !isNumber(reading.longitude) || Math.abs(reading.latitude) > 90 || Math.abs(reading.longitude) > 180) {
    return { place: 'unknown', accuracyMetres: null };
  }
  const accuracyMetres = isNumber(reading.accuracy) && reading.accuracy >= 0 ? Math.round(reading.accuracy) : null;
  const main = places.main && nearestWithin(reading, [places.main]);
  if (main) return main.name ? { place: 'office', accuracyMetres, location: main.name } : { place: 'office', accuracyMetres };
  const sub = nearestWithin(reading, places.subLocations.filter((s) => s.linked)) ?? nearestWithin(reading, places.subLocations);
  if (sub) return { place: 'remote', accuracyMetres, location: sub.name, subLocation: { name: sub.name, linked: sub.linked } };
  if (home && nearestWithin(reading, [home])) return { place: 'home', accuracyMetres };
  const anySet = (places.main !== null && officeLocationSet(places.main)) || places.subLocations.some(officeLocationSet);
  return { place: anySet ? 'remote' : 'unknown', accuracyMetres };
}

/**
 * Whether a press waives the office network's lock: within one of the person's own sub-locations (their place; Claude's
 * default, 20 October 2026, which the owner can change), on a location the phone didn't say is a mock one.
 */
export const waivesNetworkLock = (read: Pick<PlaceRead, 'place' | 'subLocation'>, mock: boolean): boolean =>
  read.place === 'remote' && read.subLocation?.linked === true && !mock;
