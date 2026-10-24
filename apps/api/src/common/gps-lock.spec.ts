import {
  accuracyAllowance,
  BOTH_LOCKS_NEEDED_TEXT,
  checkInLockRefusal,
  checkInLockText,
  checkInPlaceAt,
  distanceText,
  GPS_NEEDED_TEXT,
  GPS_TOO_ROUGH_MESSAGE,
  gpsLockInForce,
  gpsLockVerdict,
  gpsOutsideMessage,
  gpsRoughProblems,
  insideWithAllowance,
  isGpsOutsideMessage,
  isGpsTooRoughMessage,
  lockedToCheckInLocations,
  NETWORK_NEEDED_TEXT,
  NO_LOCATION_MESSAGE,
  OFF_NETWORK_MESSAGE,
  pressPlaceLabel,
  waivesNetworkLock,
  type CheckInPlaces,
  type GpsLockInput,
} from '@trendlix/shared';

// Office staff's check-ins locked to the check-in locations by GPS (owner, 24 October 2026: "while these aare not checked,
// people can still check in and out from anywhere"; asked, "Yes, add a GPS lock too"; packages/shared gps-lock.ts): the
// inside rule with the accuracy allowed for (up to 100 m), the "too rough" limit, no location, every exemption (HR's
// "Can check in from anywhere", not Office staff, a work from home day or an official duty, an office network, the
// person's own places), the two locks together (either passing is enough), and the words. Every point is invented.

const MAIN = { name: 'Trendlix Al Mahrouki', latitude: 30.0596, longitude: 31.3462, radiusMetres: 150 };
const STUDIO = { name: 'Studio', latitude: 30.0444, longitude: 31.2357, radiusMetres: 100, linked: true };
const OTHERS = { name: 'Other studio', latitude: 30.1, longitude: 31.3, radiusMetres: 100, linked: false };
const CLIENT = { name: 'Acme', latitude: 30.02, longitude: 31.4, radiusMetres: 120 };
const HOME = { latitude: 29.99, longitude: 31.25, radiusMetres: 100 };
const SITE = { name: 'Flat', latitude: 29.97, longitude: 31.28, radiusMetres: 80 };

/** A point `metres` north of another (a degree of latitude is about 111,195 m). */
const north = (p: { latitude: number; longitude: number }, metres: number, accuracy: number | null = 10) => ({ latitude: p.latitude + metres / 111_195, longitude: p.longitude, accuracy });

const PLACES: CheckInPlaces = { main: MAIN, subLocations: [STUDIO, OTHERS], clients: [CLIENT] };
const OFFICE = { workArrangement: 'office', checkInAnywhere: false, checkInWithoutLocation: false };
const ON = { lock: true, roughMetres: 200 };

const verdict = (more: Partial<GpsLockInput>) => gpsLockVerdict({ setting: ON, person: OFFICE, places: PLACES, own: { home: HOME, sites: [SITE] }, reading: null, waived: false, officeNetwork: false, ...more });

describe('the GPS lock’s setting', () => {
  it('is in force switched on with the main office set; never without it', () => {
    expect(gpsLockInForce(ON, PLACES)).toBe(true);
    expect(gpsLockInForce({ ...ON, lock: false }, PLACES)).toBe(false);
    expect(gpsLockInForce(ON, { main: null })).toBe(false);
  });

  it('holds Office staff only, unless HR lets them check in from anywhere', () => {
    expect(lockedToCheckInLocations(ON, PLACES, OFFICE)).toBe(true);
    expect(lockedToCheckInLocations(ON, PLACES, { ...OFFICE, checkInAnywhere: true })).toBe(false);
    for (const workArrangement of ['hybrid', 'outdoor', 'indoor_outdoor', 'wfh']) expect(lockedToCheckInLocations(ON, PLACES, { workArrangement })).toBe(false);
  });

  it('takes the "too rough" limit in whole metres from 50 to 500', () => {
    for (const ok of [50, 200, 500]) expect(gpsRoughProblems(ok)).toEqual([]);
    for (const bad of [49, 501, 120.5, Number.NaN]) expect(gpsRoughProblems(bad)[0]).toContain('from 50 to 500');
  });
});

describe('inside a circle, the accuracy allowed for', () => {
  it('counts a reading as inside when distance − min(accuracy, 100 m) ≤ the radius', () => {
    expect(insideWithAllowance(200, 60, 150)).toBe(true);
    expect(insideWithAllowance(200, 40, 150)).toBe(false);
    // never more than 100 m off, however rough
    expect(accuracyAllowance(180)).toBe(100);
    expect(insideWithAllowance(260, 180, 150)).toBe(false);
    expect(insideWithAllowance(250, 180, 150)).toBe(true);
    // no accuracy known: none allowed
    expect(accuracyAllowance(null)).toBe(0);
    expect(insideWithAllowance(151, null, 150)).toBe(false);
  });

  it('lets a reading 200 m from the main office through with ±60 m, and refuses it with ±40 m', () => {
    expect(verdict({ reading: north(MAIN, 200, 60) })).toEqual({ locked: true, refused: null, nearest: null });
    const out = verdict({ reading: north(MAIN, 200, 40) });
    expect(out).toMatchObject({ locked: true, refused: 'outside', nearest: { name: MAIN.name } });
    expect(out.nearest!.distanceMetres).toBeGreaterThan(195);
  });

  it('refuses a reading less accurate than the limit as too rough, wherever it says', () => {
    expect(verdict({ reading: north(MAIN, 0, 201) }).refused).toBe('too_rough');
    expect(verdict({ reading: north(MAIN, 0, 200) }).refused).toBeNull();
    expect(verdict({ setting: { lock: true, roughMetres: 50 }, reading: north(MAIN, 0, 60) }).refused).toBe('too_rough');
  });

  it('refuses a press without a location, unless HR lets them check in without one', () => {
    expect(verdict({ reading: null }).refused).toBe('no_location');
    expect(verdict({ reading: { latitude: 120, longitude: 31 } }).refused).toBe('no_location');
    expect(verdict({ reading: null, person: { ...OFFICE, checkInWithoutLocation: true } })).toMatchObject({ locked: true, refused: null });
  });

  it('says the nearest of the company’s places and how far its point is', () => {
    const far = verdict({ reading: north(MAIN, 1200, 10) });
    expect(far.nearest).toEqual({ name: MAIN.name, distanceMetres: 1200 });
    expect(gpsOutsideMessage(far.nearest)).toBe("You're about 1.2 km from Trendlix Al Mahrouki; check in at the office, or ask HR for an attendance correction.");
  });
});

describe('who and when the GPS lock lets through', () => {
  const FAR = north(MAIN, 5000, 10);

  it('anyone not held to it: the lock off, not Office staff, HR’s exception', () => {
    expect(verdict({ setting: { ...ON, lock: false }, reading: FAR })).toEqual({ locked: false, refused: null, nearest: null });
    expect(verdict({ person: { ...OFFICE, workArrangement: 'hybrid' }, reading: FAR }).locked).toBe(false);
    expect(verdict({ person: { ...OFFICE, checkInAnywhere: true }, reading: FAR }).locked).toBe(false);
  });

  it('an approved work from home day or official duty', () => {
    expect(verdict({ waived: true, reading: FAR })).toEqual({ locked: false, refused: null, nearest: null });
  });

  it('a press from an office network, whatever the location says, or none', () => {
    expect(verdict({ officeNetwork: true, reading: FAR })).toMatchObject({ locked: true, refused: null });
    expect(verdict({ officeNetwork: true, reading: null }).refused).toBeNull();
    expect(verdict({ officeNetwork: true, reading: north(MAIN, 0, 400) }).refused).toBeNull();
  });

  it('their own sub-location, a client location, their approved home and their remote sites; not someone else’s sub-location', () => {
    expect(verdict({ reading: north(STUDIO, 50) }).refused).toBeNull();
    expect(verdict({ reading: north(CLIENT, 50) }).refused).toBeNull();
    expect(verdict({ reading: north(HOME, 50) }).refused).toBeNull();
    expect(verdict({ reading: north(SITE, 50) }).refused).toBeNull();
    expect(verdict({ reading: north(OTHERS, 0) }).refused).toBe('outside');
    // without their places, their home and sites are just outside
    expect(verdict({ own: { home: null, sites: [] }, reading: north(HOME, 50) }).refused).toBe('outside');
  });
});

describe('the two locks together: either passing is enough', () => {
  const outside = { locked: true, refused: 'outside' as const, nearest: { name: MAIN.name, distanceMetres: 1200 } };
  const inside = { locked: true, refused: null, nearest: null };
  const notLocked = { locked: false, refused: null, nearest: null };

  it('refuses nothing when neither applies', () => {
    expect(checkInLockRefusal({ locked: false, refused: false, signed: false }, notLocked)).toBeNull();
  });

  it('lets a press on the office network through though its reading is outside or too rough', () => {
    expect(checkInLockRefusal({ locked: true, refused: false, signed: true }, outside)).toBeNull();
    expect(checkInLockRefusal({ locked: true, refused: false, signed: true }, { locked: true, refused: 'too_rough', nearest: null })).toBeNull();
  });

  it('lets a press inside a circle through though it is off the network', () => {
    expect(checkInLockRefusal({ locked: true, refused: true, signed: true }, inside)).toBeNull();
  });

  it('refuses when both fail, by the GPS lock’s words saying the network too', () => {
    expect(checkInLockRefusal({ locked: true, refused: true, signed: true }, outside)).toEqual({
      lock: 'locations',
      reason: 'outside_locations',
      network: 'off_network',
      message: "You're about 1.2 km from Trendlix Al Mahrouki and not on the office network; check in at the office, or ask HR for an attendance correction.",
    });
    expect(checkInLockRefusal({ locked: true, refused: true, signed: false }, { locked: true, refused: 'no_location', nearest: null })).toMatchObject({
      reason: 'no_location',
      network: 'not_signed',
      message: OFF_NETWORK_MESSAGE,
    });
    expect(isGpsTooRoughMessage(checkInLockRefusal({ locked: true, refused: true, signed: true }, { locked: true, refused: 'too_rough', nearest: null })!.message)).toBe(true);
  });

  it('refuses by one lock alone as it says', () => {
    expect(checkInLockRefusal({ locked: false, refused: false, signed: false }, outside)).toMatchObject({ lock: 'locations', reason: 'outside_locations' });
    expect(checkInLockRefusal({ locked: false, refused: false, signed: false }, { locked: true, refused: 'too_rough', nearest: null })).toMatchObject({ message: GPS_TOO_ROUGH_MESSAGE });
    expect(checkInLockRefusal({ locked: false, refused: false, signed: false }, { locked: true, refused: 'no_location', nearest: null })).toMatchObject({ message: NO_LOCATION_MESSAGE });
    expect(checkInLockRefusal({ locked: true, refused: true, signed: false }, notLocked)).toEqual({ lock: 'network', reason: 'not_signed', message: OFF_NETWORK_MESSAGE });
  });
});

describe('the words', () => {
  it('says distances plainly', () => {
    expect(distanceText(3)).toBe('10 m');
    expect(distanceText(347)).toBe('350 m');
    expect(distanceText(1234)).toBe('1.2 km');
    expect(distanceText(12_600)).toBe('13 km');
  });

  it('knows its own refusals', () => {
    expect(isGpsOutsideMessage(gpsOutsideMessage({ name: 'Head', distanceMetres: 500 }))).toBe(true);
    expect(isGpsOutsideMessage(gpsOutsideMessage(null, true))).toBe(true);
    expect(isGpsOutsideMessage(OFF_NETWORK_MESSAGE)).toBe(false);
    expect(isGpsTooRoughMessage(GPS_TOO_ROUGH_MESSAGE)).toBe(true);
  });

  it('tells a locked person before they press', () => {
    expect(checkInLockText({ network: false, gps: false })).toBeNull();
    expect(checkInLockText({ network: true, gps: false })).toBe(NETWORK_NEEDED_TEXT);
    expect(checkInLockText({ network: false, gps: true })).toBe(GPS_NEEDED_TEXT);
    expect(checkInLockText({ network: true, gps: true }, ['Studio'])).toBe(`${BOTH_LOCKS_NEEDED_TEXT} Your own check-in place (Studio) counts too.`);
  });
});

describe('a press within a client location or a remote site (24 October 2026)', () => {
  it('is remote with its name and kind, their place: after the sub-locations, around their home', () => {
    expect(checkInPlaceAt(north(CLIENT, 20), PLACES, HOME, [SITE])).toMatchObject({ place: 'remote', location: 'Acme', locationKind: 'client', subLocation: { name: 'Acme', linked: true } });
    expect(checkInPlaceAt(north(SITE, 20), PLACES, HOME, [SITE])).toMatchObject({ place: 'remote', location: 'Flat', locationKind: 'remote_site', subLocation: { linked: true } });
    expect(checkInPlaceAt(north(HOME, 20), PLACES, HOME, [SITE])).toMatchObject({ place: 'home' });
    expect(checkInPlaceAt(north(STUDIO, 20), PLACES, HOME, [SITE])).not.toHaveProperty('locationKind');
  });

  it('waives the office network’s lock, as their own sub-location, never on a mock location; their home doesn’t', () => {
    expect(waivesNetworkLock(checkInPlaceAt(north(CLIENT, 20), PLACES), false)).toBe(true);
    expect(waivesNetworkLock(checkInPlaceAt(north(SITE, 20), PLACES, null, [SITE]), false)).toBe(true);
    expect(waivesNetworkLock(checkInPlaceAt(north(SITE, 20), PLACES, null, [SITE]), true)).toBe(false);
    expect(waivesNetworkLock(checkInPlaceAt(north(HOME, 20), PLACES, HOME), false)).toBe(false);
  });

  it('is shown as "Client · Acme" and "Remote site · Flat"; a sub-location as before', () => {
    expect(pressPlaceLabel('remote', 'Acme', 'client')).toBe('Client · Acme');
    expect(pressPlaceLabel('remote', 'Flat', 'remote_site')).toBe('Remote site · Flat');
    expect(pressPlaceLabel('remote', 'Studio')).toBe('Remote - Studio');
    expect(pressPlaceLabel('home', null, null)).toBe('Home');
  });
});
